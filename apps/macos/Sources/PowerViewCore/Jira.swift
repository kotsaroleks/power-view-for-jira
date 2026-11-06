import Foundation
import Security

public enum JiraError: Error, Equatable {
  case invalidOrigin, invalidKey, unexpectedResponse
  case http(Int)
  case paginationIncomplete, missingCredentials
  case keychain(Int32)
}
public enum JiraDeployment: String, Codable, Sendable {
  case cloud
  case dataCenter = "data-center"
}
public struct JiraConnection: Sendable {
  public let deployment: JiraDeployment
  public var apiVersion: String { deployment == .cloud ? "3" : "2" }
  public let origin: URL
  public let email: String
  private let token: String
  public init(origin: String, email: String, token: String, deployment: JiraDeployment = .cloud)
    throws
  {
    guard let url = URL(string: origin.trimmingCharacters(in: .whitespacesAndNewlines)),
      url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil, ["", "/"].contains(url.path),
      deployment == .dataCenter || !email.isEmpty, !email.contains(":"), !token.isEmpty
    else { throw JiraError.invalidOrigin }
    self.origin = URL(
      string: url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))!
    self.deployment = deployment
    self.email = email
    self.token = token
  }
  var authorization: String {
    deployment == .cloud
      ? "Basic " + Data((email + ":" + token).utf8).base64EncodedString() : "Bearer " + token
  }
}
public enum JiraKeychain {
  private static let service = "com.powerview.jira"
  public static func save(token: String, origin: URL, email: String) throws {
    let query = query(origin: origin, email: email)
    let update = SecItemUpdate(
      query as CFDictionary, [kSecValueData: Data(token.utf8)] as CFDictionary)
    if update == errSecSuccess { return }
    guard update == errSecItemNotFound else { throw JiraError.keychain(update) }
    var item = query
    item[kSecValueData] = Data(token.utf8)
    item[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else { throw JiraError.keychain(status) }
  }
  public static func load(origin: URL, email: String, allowInteraction: Bool = true) throws -> String {
    var query = query(origin: origin, email: email)
    if !allowInteraction { query[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail }
    query[kSecReturnData] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data,
      let token = String(data: data, encoding: .utf8)
    else { throw JiraError.keychain(status) }
    return token
  }
  public static func delete(origin: URL, email: String) throws {
    let status = SecItemDelete(query(origin: origin, email: email) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw JiraError.keychain(status)
    }
  }
  private static func query(origin: URL, email: String) -> [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword, kSecAttrService: service,
      kSecAttrAccount: origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        + "|" + email,
    ]
  }
}
public protocol JiraTransport: Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}
private final class NoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
public struct JiraURLTransport: JiraTransport {
  public init() {}
  public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false
    configuration.timeoutIntervalForRequest = 30
    let session = URLSession(
      configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw JiraError.unexpectedResponse }
    return (data, http)
  }
}
public struct JiraUser: Codable, Equatable, Sendable {
  public let accountId: String
  public let displayName: String
  public let emailAddress: String?
  public let timeZone: String?
  public init(accountId: String, displayName: String, emailAddress: String? = nil, timeZone: String? = nil) {
    self.accountId = accountId
    self.displayName = displayName
    self.emailAddress = emailAddress
    self.timeZone = timeZone
  }
  private enum CodingKeys: String, CodingKey {
    case accountId, displayName, emailAddress, timeZone, name, key
  }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    accountId =
      try values.decodeIfPresent(String.self, forKey: .accountId) ?? values.decodeIfPresent(
        String.self, forKey: .name) ?? values.decode(String.self, forKey: .key)
    displayName = try values.decode(String.self, forKey: .displayName)
    emailAddress = try values.decodeIfPresent(String.self, forKey: .emailAddress)
    timeZone = try values.decodeIfPresent(String.self, forKey: .timeZone)
  }
  public func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(accountId, forKey: .accountId)
    try values.encode(displayName, forKey: .displayName)
    try values.encodeIfPresent(emailAddress, forKey: .emailAddress)
    try values.encodeIfPresent(timeZone, forKey: .timeZone)
  }
}
public struct JiraIssue: Codable, Equatable, Sendable {
  public let nativeDeployment: JiraDeployment?
  public let id: String
  public let key: String
  public let fields: Fields
  public struct Fields: Codable, Equatable, Sendable {
    public let summary: String
    public let description: JiraDocument?
    public let updated: String
    public let project: Project
    public let parent: Subtask?
    public let issuetype: IssueType?
    public let subtasks: [Subtask]?
    public let timetracking: TimeTracking?
  }
  public struct Project: Codable, Equatable, Sendable {
    public let id: String
    public let key: String
  }
  public struct IssueType: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let subtask: Bool
  }
  public struct Subtask: Codable, Equatable, Sendable {
    public let id: String
    public let key: String
  }
  public struct TimeTracking: Codable, Equatable, Sendable {
    public let originalEstimateSeconds: Int?
  }
}
/// Recursive Atlassian Document Format. Raw structure is retained for lossless preview/merge.
public enum JSONValue: Codable, Equatable, Hashable, Sendable {
  case object([String: JSONValue])
  case array([JSONValue])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let value = try? c.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? c.decode(String.self) {
      self = .string(value)
    } else if let value = try? c.decode(Double.self) {
      self = .number(value)
    } else if let value = try? c.decode([JSONValue].self) {
      self = .array(value)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .object(let value): try c.encode(value)
    case .array(let value): try c.encode(value)
    case .string(let value): try c.encode(value)
    case .number(let value): try c.encode(value)
    case .bool(let value): try c.encode(value)
    case .null: try c.encodeNil()
    }
  }
}
public typealias JiraDocument = JSONValue
public struct JiraComment: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let body: JiraDocument
  public let author: JiraUser
  public let created: String
  public let updated: String
}
private struct CommentPage: Decodable {
  let startAt: Int
  let maxResults: Int
  let total: Int
  let comments: [JiraComment]
}
public struct JiraClient: Sendable {
  public let connection: JiraConnection
  let transport: any JiraTransport
  public init(connection: JiraConnection, transport: any JiraTransport = JiraURLTransport()) {
    self.connection = connection
    self.transport = transport
  }
  public func myself() async throws -> JiraUser { try await get("/rest/api/3/myself") }
  public func issue(_ key: String) async throws -> JiraIssue {
    try validate(key)
    let loaded: JiraIssue = try await get(
      "/rest/api/3/issue/" + key,
      query: [
        .init(
          name: "fields",
          value: "summary,description,updated,project,parent,issuetype,subtasks,timetracking")
      ])
    guard loaded.key == key, !loaded.id.isEmpty, key.hasPrefix(loaded.fields.project.key + "-")
    else { throw JiraError.unexpectedResponse }
    return loaded
  }
  public func comments(_ key: String) async throws -> [JiraComment] {
    try validate(key)
    var result: [JiraComment] = []
    var cursor = 0
    for _ in 0..<1000 {
      let page: CommentPage = try await get(
        "/rest/api/3/issue/" + key + "/comment",
        query: [
          .init(name: "startAt", value: String(cursor)), .init(name: "maxResults", value: "100"),
        ])
      guard page.startAt == cursor, page.total >= 0 else { throw JiraError.unexpectedResponse }
      result += page.comments
      if cursor + page.comments.count >= page.total {
        guard Set(result.map(\.id)).count == result.count else {
          throw JiraError.paginationIncomplete
        }
        return result
      }
      guard !page.comments.isEmpty else { throw JiraError.paginationIncomplete }
      cursor += page.comments.count
    }
    throw JiraError.paginationIncomplete
  }
  func validate(_ key: String) throws {
    guard key.range(of: "^[A-Z][A-Z0-9_]*-[1-9][0-9]*$", options: .regularExpression) != nil else {
      throw JiraError.invalidKey
    }
  }
  func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
    var components = URLComponents(url: connection.origin, resolvingAgainstBaseURL: false)!
    components.path =
      connection.deployment == .dataCenter
      ? path.replacingOccurrences(of: "/rest/api/3/", with: "/rest/api/2/") : path
    let adaptedQuery =
      connection.deployment == .dataCenter && path.contains("/user/")
      ? query.map { URLQueryItem(name: $0.name == "query" ? "username" : $0.name, value: $0.value) }
      : query
    components.queryItems = adaptedQuery.isEmpty ? nil : adaptedQuery
    guard let url = components.url else { throw JiraError.invalidOrigin }
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.setValue(connection.authorization, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let (data, response) = try await transport.send(request)
    guard response.url?.host == connection.origin.host, response.url?.scheme == "https" else {
      throw JiraError.unexpectedResponse
    }
    guard response.statusCode == 200 else { throw JiraError.http(response.statusCode) }
    if connection.deployment == .dataCenter {
      let decoded = try JSONDecoder().decode(JSONValue.self, from: data)
      if decoded["fields"] != .null, decoded["key"].string != nil {
        var object = decoded.object
        object["nativeDeployment"] = .string(JiraDeployment.dataCenter.rawValue)
        return try JSONDecoder().decode(
          T.self, from: JSONEncoder().encode(JSONValue.object(object)))
      }
    }
    return try JSONDecoder().decode(T.self, from: data)
  }
}

extension JSONValue {
  public var plainText: String {
    switch self {
    case .string(let value): return value
    case .number(let value):
      return value.rounded() == value ? String(format: "%.0f", value) : String(value)
    case .bool(let value): return value ? "true" : "false"
    case .array(let values): return values.map(\.plainText).joined()
    case .object(let object):
      if case .string(let text) = object["text"] { return text }
      let content = object["content"]?.plainText ?? ""
      if case .string(let type) = object["type"],
        ["paragraph", "heading", "listItem"].contains(type)
      {
        return content + "\n"
      }
      return content
    default: return ""
    }
  }
}

extension JiraClient {
  public func searchUsers(query: String) async throws -> [JiraUser] {
    let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard term.count >= 2 else { return [] }
    return try await get(
      "/rest/api/3/user/search",
      query: [.init(name: "query", value: term), .init(name: "maxResults", value: "50")])
  }
}
