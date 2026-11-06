import Foundation
import Security

public enum DriveLeaseError: Error, Equatable {
  case unavailable, invalidConfiguration, invalidResponse, leaseLost, staleRevision, remoteFailure
}
public protocol DriveLeaseTransport: Sendable {
  func execute(_ request: JSONValue) async throws -> JSONValue
}
/// Direct, OAuth-authenticated Apps Script Execution API transport.
/// The access-token provider is injected; no Google token enters a release document.
public struct GoogleScriptLeaseTransport: DriveLeaseTransport {
  private let deploymentID: String
  private let token: @Sendable () async throws -> String
  private let transport: any JiraTransport
  public init(
    deploymentID: String, accessToken: @escaping @Sendable () async throws -> String,
    transport: any JiraTransport = JiraURLTransport()
  ) throws {
    guard deploymentID.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
      throw DriveLeaseError.invalidConfiguration
    }
    self.deploymentID = deploymentID
    self.token = accessToken
    self.transport = transport
  }
  public func execute(_ request: JSONValue) async throws -> JSONValue {
    let url = URL(string: "https://script.googleapis.com/v1/scripts/" + deploymentID + ":run")!
    var message = URLRequest(url: url)
    message.httpMethod = "POST"
    message.setValue("Bearer " + (try await token()), forHTTPHeaderField: "Authorization")
    message.setValue("application/json", forHTTPHeaderField: "Content-Type")
    message.httpBody = try JSONEncoder().encode(
      JSONValue.object([
        "function": .string("releaseOperation"), "parameters": .array([request]),
        "devMode": .bool(false),
      ]))
    let (data, response) = try await transport.send(message)
    guard response.statusCode == 200, response.url?.host == "script.googleapis.com" else {
      throw DriveLeaseError.remoteFailure
    }
    let result = try JSONDecoder().decode(JSONValue.self, from: data)
    guard result["error"] == .null, result["done"].boolean, result["response"]["result"] != .null
    else { throw DriveLeaseError.remoteFailure }
    return result["response"]["result"]
  }
}
/// Client half of the lease protocol; shared writes are always fenced again on the server.
/// Not wired to the production UI until the live two-account acceptance test passes.
public actor DriveLeaseSession {
  private struct Lease {
    let secret: String
    let generation: Int
    let revision: Int
    var deadline: ContinuousClock.Instant
  }
  private var lease: Lease?
  private var mutationInFlight = false
  private let transport: any DriveLeaseTransport
  public init(transport: any DriveLeaseTransport) { self.transport = transport }
  public var canEdit: Bool { lease.map { ContinuousClock.now < $0.deadline } ?? false }
  public func read() async throws -> JSONValue {
    try await transport.execute(
      .object(["action": .string("read"), "requestID": .string(UUID().uuidString)]))
  }
  public func acquire() async throws -> JSONValue {
    guard !mutationInFlight else { throw DriveLeaseError.unavailable }
    mutationInFlight = true
    defer { mutationInFlight = false }
    let requestStarted = ContinuousClock.now
    guard lease == nil else { throw DriveLeaseError.leaseLost }
    var bytes = Data(count: 32)
    let status = bytes.withUnsafeMutableBytes {
      SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!)
    }
    guard status == errSecSuccess else { throw DriveLeaseError.unavailable }
    let secret = bytes.base64EncodedString()
    let response = try await transport.execute(
      .object([
        "action": .string("acquire"), "requestID": .string(UUID().uuidString),
        "token": .string(secret),
      ]))
    guard let generation = response["generation"].number,
      let revision = response["revision"].number, generation.isFinite, revision.isFinite,
      generation >= 0, revision >= 0, generation < Double(Int.max), revision < Double(Int.max),
      generation.rounded() == generation, revision.rounded() == revision
    else { throw DriveLeaseError.invalidResponse }
    let deadline = try Self.deadline(response, requestStarted: requestStarted)
    // Set the lease only after the shared snapshot has been read successfully.
    let snapshot = try await read()
    guard snapshot["revision"].number == revision else { throw DriveLeaseError.staleRevision }
    try Task.checkCancellation()
    lease = Lease(
      secret: secret, generation: Int(generation), revision: Int(revision), deadline: deadline)
    return snapshot["document"]
  }
  /// Call from actual edits or foreground commands. Polling must call read(), never this method.
  public func userActivity() async throws {
    guard !mutationInFlight else { throw DriveLeaseError.unavailable }
    mutationInFlight = true
    defer { mutationInFlight = false }
    let requestStarted = ContinuousClock.now
    guard var lease, canEdit else {
      self.lease = nil
      throw DriveLeaseError.leaseLost
    }
    do {
      let response = try await transport.execute(
        .object([
          "action": .string("activity"), "requestID": .string(UUID().uuidString),
          "token": .string(lease.secret),
        ]))
      guard response["generation"].number == Double(lease.generation) else {
        throw DriveLeaseError.leaseLost
      }
      lease.deadline = try Self.deadline(response, requestStarted: requestStarted)
      self.lease = lease
    } catch {
      self.lease = nil
      throw error
    }
  }
  /// Persist a private draft before calling this. An uncertain network response revokes local edit rights.
  public func saveAndRelease(_ document: JSONValue) async throws -> Int {
    guard !mutationInFlight else { throw DriveLeaseError.unavailable }
    mutationInFlight = true
    defer { mutationInFlight = false }
    guard let lease, canEdit else {
      self.lease = nil
      throw DriveLeaseError.leaseLost
    }
    self.lease = nil
    let response = try await transport.execute(
      .object([
        "action": .string("saveAndRelease"), "requestID": .string(UUID().uuidString),
        "token": .string(lease.secret), "revision": .number(Double(lease.revision)),
        "document": document,
      ]))
    guard let revision = response["revision"].number, revision == Double(lease.revision + 1) else {
      throw DriveLeaseError.invalidResponse
    }
    return Int(revision)
  }
  public func release() async throws {
    guard !mutationInFlight else { throw DriveLeaseError.unavailable }
    mutationInFlight = true
    defer { mutationInFlight = false }
    guard let lease else { return }
    self.lease = nil
    _ = try await transport.execute(
      .object([
        "action": .string("release"), "requestID": .string(UUID().uuidString),
        "token": .string(lease.secret),
      ]))
  }
  private static func deadline(_ response: JSONValue, requestStarted: ContinuousClock.Instant)
    throws -> ContinuousClock.Instant
  {
    guard let expires = response["expires"].number, let now = response["serverTime"].number,
      expires > now,
      expires - now <= 1_800_000
    else { throw DriveLeaseError.invalidResponse }
    // Conservative margin for network transit. Local clock changes cannot extend the lease.
    let seconds = max(0, (expires - now) / 1000 - 5)
    return requestStarted.advanced(by: .milliseconds(Int64(seconds * 1000)))
  }
}
