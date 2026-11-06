import Foundation
import Testing

@testable import PowerViewCore

private actor FixtureTransport: JiraTransport {
  var requests: [URLRequest] = []
  let pages: [String]
  let status: Int
  init(_ pages: [String], status: Int = 200) {
    self.pages = pages
    self.status = status
  }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    let index = min(requests.count - 1, pages.count - 1)
    return (
      Data(pages[index].utf8),
      HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
}
@Test func jiraRejectsUnsafeOriginsAndKeysBeforeNetwork() async throws {
  for origin in [
    "http://jira.example.test", "https://user@jira.example.test", "https://jira.example.test/path",
    "https://jira.example.test?token=no",
  ] {
    #expect(throws: JiraError.invalidOrigin) {
      try JiraConnection(origin: origin, email: "person@example.test", token: "fixture-only")
    }
  }
  let transport = FixtureTransport(["{}"])
  let client = JiraClient(
    connection: try JiraConnection(
      origin: "https://jira.example.test", email: "person@example.test", token: "fixture-only"),
    transport: transport)
  await #expect(throws: JiraError.invalidKey) { try await client.issue("APP-1/../../myself") }
  #expect(await transport.requests.isEmpty)
}
@Test func jiraCommentsArePagedAndErrorsAreNotEmptySuccess() async throws {
  let transport = FixtureTransport([
    #"{"startAt":0,"maxResults":1,"total":2,"comments":[{"id":"1","body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Answer"}]}]},"author":{"accountId":"u","displayName":"Person"},"created":"2026-10-16","updated":"2026-10-16"}]}"#,
    #"{"startAt":1,"maxResults":1,"total":2,"comments":[{"id":"2","body":{"type":"doc"},"author":{"accountId":"u","displayName":"Person"},"created":"2026-10-16","updated":"2026-10-16"}]}"#,
  ])
  let connection = try JiraConnection(
    origin: "https://jira.example.test", email: "person@example.test", token: "fixture-only")
  let comments = try await JiraClient(connection: connection, transport: transport).comments(
    "APP-1")
  #expect(comments.map(\.id) == ["1", "2"])
  #expect(comments[0].body.plainText == "Answer\n")
  let requests = await transport.requests
  #expect(requests.allSatisfy { $0.httpMethod == "GET" && $0.url?.host == "jira.example.test" })
  #expect(requests[1].url?.query?.contains("startAt=1") == true)
  let forbidden = JiraClient(
    connection: connection, transport: FixtureTransport(["{}"], status: 403))
  await #expect(throws: JiraError.http(403)) { try await forbidden.comments("APP-1") }
}
