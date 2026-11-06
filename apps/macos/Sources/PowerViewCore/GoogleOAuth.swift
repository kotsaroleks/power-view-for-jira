import CryptoKit
import Foundation
import Security

public enum GoogleConnectionError: Error, Equatable {
  case notConfigured, invalidCallback, cancelled, authorizationFailed, invalidResponse,
    missingRefreshToken
  case keychain(Int32)
}
public struct GoogleOAuthConfiguration: Codable, Sendable {
  public let clientID: String
  public let clientSecret: String?
  public init(clientID: String, clientSecret: String? = nil) throws {
    guard clientID.hasSuffix(".apps.googleusercontent.com") else {
      throw GoogleConnectionError.notConfigured
    }
    self.clientID = clientID
    self.clientSecret = clientSecret
  }
}
public struct GoogleAuthorizationAttempt: Sendable {
  public let state: String
  public let verifier: String
  public let redirectURL: URL
  public init(redirectURL: URL) throws {
    guard redirectURL.scheme == "http", redirectURL.host == "127.0.0.1", redirectURL.port != nil,
      redirectURL.path == "/oauth/callback", redirectURL.query == nil, redirectURL.fragment == nil
    else { throw GoogleConnectionError.invalidCallback }
    self.redirectURL = redirectURL
    state = try Self.random()
    verifier = try Self.random()
  }
  public var challenge: String { Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }
  public func authorizationURL(configuration: GoogleOAuthConfiguration) -> URL {
    var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    components.queryItems = [
      .init(name: "client_id", value: configuration.clientID),
      .init(name: "redirect_uri", value: redirectURL.absoluteString),
      .init(name: "response_type", value: "code"),
      .init(
        name: "scope",
        value:
          "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email"
      ),
      .init(name: "code_challenge", value: challenge),
      .init(name: "code_challenge_method", value: "S256"),
      .init(name: "state", value: state), .init(name: "access_type", value: "offline"),
      .init(name: "prompt", value: "consent"),
    ]
    return components.url!
  }
  public func code(from callback: URL) throws -> String {
    guard callback.scheme == redirectURL.scheme, callback.host == redirectURL.host,
      callback.port == redirectURL.port,
      callback.path == redirectURL.path,
      let components = URLComponents(url: callback, resolvingAgainstBaseURL: false)
    else { throw GoogleConnectionError.invalidCallback }
    let items = components.queryItems ?? []
    guard items.filter({ $0.name == "state" }).count == 1,
      items.first(where: { $0.name == "state" })?.value == state
    else { throw GoogleConnectionError.invalidCallback }
    if items.contains(where: { $0.name == "error" }) { throw GoogleConnectionError.cancelled }
    guard items.filter({ $0.name == "code" }).count == 1,
      let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty
    else { throw GoogleConnectionError.invalidCallback }
    return code
  }
  private static func random() throws -> String {
    var data = Data(count: 32)
    let status = data.withUnsafeMutableBytes {
      SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!)
    }
    guard status == errSecSuccess else { throw GoogleConnectionError.authorizationFailed }
    return base64url(data)
  }
  private static func base64url(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(
      of: "/", with: "_"
    ).replacingOccurrences(of: "=", with: "")
  }
}
public struct GoogleCredentials: Codable, Sendable {
  public let accessToken: String
  public let refreshToken: String
  public let expiresAt: Date
  public let email: String
}
/// Authorizes only fixed Google HTTPS endpoints; no user-supplied token endpoint or redirects.
public struct GoogleOAuthClient: Sendable {
  public let configuration: GoogleOAuthConfiguration
  private let transport: any JiraTransport
  public init(
    configuration: GoogleOAuthConfiguration, transport: any JiraTransport = JiraURLTransport()
  ) {
    self.configuration = configuration
    self.transport = transport
  }
  public func exchange(attempt: GoogleAuthorizationAttempt, callback: URL) async throws
    -> GoogleCredentials
  {
    let code = try attempt.code(from: callback)
    let result = try await tokenRequest([
      "grant_type": "authorization_code", "code": code,
      "redirect_uri": attempt.redirectURL.absoluteString,
      "code_verifier": attempt.verifier,
    ])
    guard let refresh = result["refresh_token"].string, !refresh.isEmpty else {
      throw GoogleConnectionError.missingRefreshToken
    }
    let token = try tokenFields(result)
    var request = URLRequest(url: URL(string: "https://www.googleapis.com/oauth2/v2/userinfo")!)
    request.setValue("Bearer " + token.access, forHTTPHeaderField: "Authorization")
    let (data, response) = try await transport.send(request)
    guard response.statusCode == 200, response.url?.host == "www.googleapis.com" else {
      throw GoogleConnectionError.authorizationFailed
    }
    let user = try JSONDecoder().decode(JSONValue.self, from: data)
    guard let email = user["email"].string, user["verified_email"].boolean else {
      throw GoogleConnectionError.invalidResponse
    }
    return .init(
      accessToken: token.access, refreshToken: refresh, expiresAt: token.expiry, email: email)
  }
  public func refresh(_ credentials: GoogleCredentials) async throws -> GoogleCredentials {
    let result = try await tokenRequest([
      "grant_type": "refresh_token", "refresh_token": credentials.refreshToken,
    ])
    let token = try tokenFields(result)
    return .init(
      accessToken: token.access,
      refreshToken: result["refresh_token"].string ?? credentials.refreshToken,
      expiresAt: token.expiry, email: credentials.email)
  }
  private func tokenFields(_ result: JSONValue) throws -> (access: String, expiry: Date) {
    guard let access = result["access_token"].string, !access.isEmpty,
      let expires = result["expires_in"].number,
      expires > 0, expires <= 86_400, result["token_type"].string?.lowercased() == "bearer"
    else { throw GoogleConnectionError.invalidResponse }
    return (access, Date().addingTimeInterval(expires))
  }
  private func tokenRequest(_ fields: [String: String]) async throws -> JSONValue {
    var values = fields
    values["client_id"] = configuration.clientID
    if let secret = configuration.clientSecret { values["client_secret"] = secret }
    var encoded = URLComponents()
    encoded.queryItems = values.sorted { $0.key < $1.key }.map {
      URLQueryItem(name: $0.key, value: $0.value)
    }
    var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    // Encode literal '+' so form parsing cannot turn a token character into a space.
    request.httpBody = Data(
      (encoded.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
    let (data, response) = try await transport.send(request)
    guard response.statusCode == 200, response.url?.host == "oauth2.googleapis.com" else {
      throw GoogleConnectionError.authorizationFailed
    }
    return try JSONDecoder().decode(JSONValue.self, from: data)
  }
}
public enum GoogleCredentialKeychain {
  private static func query(_ clientID: String) -> [CFString: Any] {
    [
      kSecClass: kSecClassGenericPassword, kSecAttrService: "com.powerview.google",
      kSecAttrAccount: clientID,
    ]
  }
  public static func save(_ credentials: GoogleCredentials, clientID: String) throws {
    let data = try JSONEncoder().encode(credentials)
    let query = query(clientID)
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData: data] as CFDictionary)
    if status == errSecSuccess { return }
    guard status == errSecItemNotFound else { throw GoogleConnectionError.keychain(status) }
    var item = query
    item[kSecValueData] = data
    item[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let added = SecItemAdd(item as CFDictionary, nil)
    guard added == errSecSuccess else { throw GoogleConnectionError.keychain(added) }
  }
  public static func load(clientID: String) throws -> GoogleCredentials? {
    var query = query(clientID)
    query[kSecReturnData] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw GoogleConnectionError.keychain(status)
    }
    return try JSONDecoder().decode(GoogleCredentials.self, from: data)
  }
  public static func delete(clientID: String) throws {
    let status = SecItemDelete(query(clientID) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw GoogleConnectionError.keychain(status)
    }
  }
}
/// Serial refresh prevents a slow refresh response from overwriting a newly selected account.
public actor GoogleTokenProvider {
  private let client: GoogleOAuthClient
  private var credentials: GoogleCredentials
  private var refreshTask: Task<GoogleCredentials, Error>?
  public init(client: GoogleOAuthClient, credentials: GoogleCredentials) {
    self.client = client
    self.credentials = credentials
  }
  public func accessToken() async throws -> String {
    if credentials.expiresAt.timeIntervalSinceNow > 360 { return credentials.accessToken }
    if let refreshTask { return try await refreshTask.value.accessToken }
    let current = credentials
    let client = client
    let task = Task { try await client.refresh(current) }
    refreshTask = task
    defer { refreshTask = nil }
    let refreshed = try await task.value
    try GoogleCredentialKeychain.save(refreshed, clientID: client.configuration.clientID)
    credentials = refreshed
    return refreshed.accessToken
  }
}
