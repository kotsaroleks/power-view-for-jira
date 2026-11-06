import Foundation
import Testing

@testable import PowerViewCore

private actor LeaseTransportFixture: DriveLeaseTransport {
  var actions: [String] = []
  let failSave: Bool
  init(failSave: Bool = false) { self.failSave = failSave }
  func execute(_ request: JSONValue) async throws -> JSONValue {
    let action = request["action"].string ?? ""
    actions.append(action)
    switch action {
    case "acquire", "activity":
      return .object([
        "generation": .number(1), "revision": .number(0), "expires": .number(1_801_000),
        "serverTime": .number(1000),
      ])
    case "read":
      return .object([
        "revision": .number(0), "document": .object(["name": .string("Shared release")]),
      ])
    case "saveAndRelease":
      if failSave { throw URLError(.timedOut) }
      return .object(["revision": .number(1)])
    case "release": return .object([:])
    default: throw DriveLeaseError.remoteFailure
    }
  }
}
@Test func leaseNeedsServerGrantAndPollingDoesNotRenewIt() async throws {
  let transport = LeaseTransportFixture()
  let lease = DriveLeaseSession(transport: transport)
  #expect(await !lease.canEdit)
  _ = try await lease.acquire()
  #expect(await lease.canEdit)
  _ = try await lease.read()
  #expect(await transport.actions == ["acquire", "read", "read"])
  try await lease.userActivity()
  #expect(await transport.actions.last == "activity")
  #expect(try await lease.saveAndRelease(.object(["name": .string("Saved")])) == 1)
  #expect(await !lease.canEdit)
  await #expect(throws: DriveLeaseError.leaseLost) { try await lease.saveAndRelease(.object([:])) }
}
@Test func uncertainDriveWriteImmediatelyRevokesLocalEditing() async throws {
  let transport = LeaseTransportFixture(failSave: true)
  let lease = DriveLeaseSession(transport: transport)
  _ = try await lease.acquire()
  await #expect(throws: (any Error).self) {
    try await lease.saveAndRelease(.object(["draft": .string("saved privately before request")]))
  }
  #expect(await !lease.canEdit)
  #expect(await transport.actions.filter { $0 == "saveAndRelease" }.count == 1)
}
