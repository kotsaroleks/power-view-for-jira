import Foundation
import Testing

@testable import PowerViewCore

private actor DriveFileTransport: JiraTransport {
  var requests: [URLRequest] = []
  let status: Int
  init(status: Int = 200) { self.status = status }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    let data =
      request.httpMethod == "POST"
      ? Data(#"{"id":"created-123","name":"Release.pvrelease","mimeType":"application/json"}"#.utf8)
      : Data(#"{"release":"original bytes"}"#.utf8)
    return (
      data,
      HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
}

@Test func directDriveCreatesSnapshotInChosenFolderAndReadsExactBytes() async throws {
  let transport = DriveFileTransport()
  let client = GoogleDriveFiles(accessToken: { "synthetic-token" }, transport: transport)
  let content = Data(#"{"name":"Тест"}"#.utf8)
  let file = try await client.createSnapshot(
    name: "Release.pvrelease", folderID: "folder-123", data: content)
  #expect(file.id == "created-123")
  let downloaded = try await client.download(fileID: file.id)
  #expect(downloaded == Data(#"{"release":"original bytes"}"#.utf8))
  let requests = await transport.requests
  #expect(requests.count == 2)
  #expect(requests[0].url?.host == "www.googleapis.com")
  #expect(requests[0].httpMethod == "POST")
  #expect(requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer synthetic-token")
  let body = String(decoding: requests[0].httpBody!, as: UTF8.self)
  #expect(body.contains("folder-123"))
  #expect(body.contains(String(decoding: content, as: UTF8.self)))
  #expect(requests[1].httpMethod == "GET")
}

@Test func directDriveRejectsInvalidTargetsBeforeSendingAndDoesNotRetryDeniedWrites() async throws {
  let transport = DriveFileTransport(status: 403)
  let client = GoogleDriveFiles(accessToken: { "synthetic-token" }, transport: transport)
  await #expect(throws: GoogleDriveFileError.invalidIdentifier) {
    try await client.download(fileID: "../outside?token=secret")
  }
  #expect(await transport.requests.isEmpty)
  await #expect(throws: GoogleDriveFileError.denied) {
    try await client.createSnapshot(name: "Release.pvrelease", folderID: "folder", data: Data())
  }
  #expect(await transport.requests.count == 1)
}

@Test func googleAuthorizationUsesFileScopeWithoutAppsScriptDeployment() throws {
  let configuration = try GoogleOAuthConfiguration(clientID: "test.apps.googleusercontent.com")
  let attempt = try GoogleAuthorizationAttempt(
    redirectURL: URL(string: "http://127.0.0.1:12345/oauth/callback")!)
  let components = URLComponents(
    url: attempt.authorizationURL(configuration: configuration), resolvingAgainstBaseURL: false)!
  let scope = components.queryItems!.first { $0.name == "scope" }!.value!
  #expect(scope.contains("auth/drive.file"))
  #expect(!scope.split(separator: " ").contains("https://www.googleapis.com/auth/drive"))
}

@Test func googleCallbackRejectsWrongStateDuplicateCodesAndForeignHost() throws {
  let attempt = try GoogleAuthorizationAttempt(
    redirectURL: URL(string: "http://127.0.0.1:12345/oauth/callback")!)
  let valid = "http://127.0.0.1:12345/oauth/callback?state=\(attempt.state)&code=fixture"
  #expect(try attempt.code(from: URL(string: valid)!) == "fixture")
  for invalid in [
    valid.replacingOccurrences(of: attempt.state, with: "other-state"),
    valid + "&code=second",
    valid.replacingOccurrences(of: "127.0.0.1", with: "example.test"),
    valid.replacingOccurrences(of: ":12345", with: ":12346"),
  ] {
    #expect(throws: GoogleConnectionError.invalidCallback) {
      try attempt.code(from: URL(string: invalid)!)
    }
  }
}

private actor GoogleSignInTransport: JiraTransport {
  var requests: [URLRequest] = []
  let verified: Bool
  init(verified: Bool = true) { self.verified = verified }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    let body =
      request.url!.host == "oauth2.googleapis.com"
      ? #"{"access_token":"fake+access","refresh_token":"fake+refresh","expires_in":3600,"token_type":"Bearer"}"#
      : "{\"email\":\"fixture@example.test\",\"verified_email\":\(verified)}"
    return (
      Data(body.utf8),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}

@Test func googleTokenExchangeUsesPKCEAndVerifiesAccountBeforeAcceptingCredentials() async throws {
  let transport = GoogleSignInTransport()
  let configuration = try GoogleOAuthConfiguration(clientID: "test.apps.googleusercontent.com")
  let client = GoogleOAuthClient(configuration: configuration, transport: transport)
  let attempt = try GoogleAuthorizationAttempt(
    redirectURL: URL(string: "http://127.0.0.1:12345/oauth/callback")!)
  let callback = URL(
    string: "http://127.0.0.1:12345/oauth/callback?state=\(attempt.state)&code=code%2Bvalue")!
  let credentials = try await client.exchange(attempt: attempt, callback: callback)
  #expect(credentials.email == "fixture@example.test")
  #expect(credentials.refreshToken == "fake+refresh")
  let requests = await transport.requests
  #expect(requests.count == 2)
  let form = String(decoding: requests[0].httpBody!, as: UTF8.self)
  #expect(form.contains("code=code%2Bvalue"))
  #expect(form.contains("code_verifier=" + attempt.verifier))
  #expect(requests[1].value(forHTTPHeaderField: "Authorization") == "Bearer fake+access")
  let unverified = GoogleOAuthClient(
    configuration: configuration, transport: GoogleSignInTransport(verified: false))
  await #expect(throws: GoogleConnectionError.invalidResponse) {
    try await unverified.exchange(attempt: attempt, callback: callback)
  }
}
