import Foundation
import Testing

@testable import PowerViewCore

private actor DataCenterTransport: JiraTransport {
  var requests: [URLRequest] = []
  var writes = 0
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic-pat")
    let path = request.url!.path
    let value: JSONValue
    if request.httpMethod == "PUT" {
      writes += 1
      value = .null
    } else if path.hasSuffix("/myself") {
      value = .object(["name": .string("alex"), "displayName": .string("Alex")])
    } else if path == "/rest/api/2/project" {
      value = .array([
        .object(["id": .string("1"), "key": .string("APP"), "name": .string("Application")])
      ])
    } else if path.hasSuffix("/editmeta") {
      value = .object([
        "fields": .object([
          "customfield_10015": .object([
            "schema": .object(["type": .string("date")]), "operations": .array([.string("set")]),
          ]),
          "duedate": .object([
            "schema": .object(["type": .string("date")]), "operations": .array([.string("set")]),
          ]), "assignee": .object(["operations": .array([.string("set")])]),
        ])
      ])
    } else if path.hasSuffix("/transitions") {
      value = .object([
        "transitions": .array([
          .object([
            "id": .string("31"), "name": .string("Done"), "to": .object(["name": .string("Done")]),
            "fields": .object([:]),
          ])
        ])
      ])
    } else if path.contains("/assignable/") {
      value = .array([.object(["name": .string("alex"), "displayName": .string("Alex")])])
    } else if path == "/rest/agile/1.0/board/7/issue" {
      let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
      let offset = Int(query.first { $0.name == "startAt" }!.value!)!
      value = .object([
        "startAt": .number(Double(offset)), "total": .number(2),
        "issues": .array([rawIssue(offset + 1)]),
      ])
    } else if path == "/rest/api/2/issue/APP-1" {
      value = rawIssue(1)
    } else {
      throw JiraError.unexpectedResponse
    }
    return (
      try JSONEncoder().encode(value),
      HTTPURLResponse(
        url: request.url!, statusCode: request.httpMethod == "PUT" ? 204 : 200, httpVersion: nil,
        headerFields: nil)!
    )
  }
  private func rawIssue(_ number: Int) -> JSONValue {
    .object([
      "id": .string(String(number)), "key": .string("APP-\(number)"),
      "fields": .object([
        "summary": .string("Synthetic task"), "updated": .string("2026-10-20T00:00:00Z"),
        "project": .object(["id": .string("1"), "key": .string("APP")]),
        "description": .string("Data Center description"),
        "status": .object([
          "id": .string("1"), "name": .string("Open"),
          "statusCategory": .object(["key": .string("new")]),
        ]), "assignee": .object(["name": .string("alex"), "displayName": .string("Alex")]),
        "customfield_10015": .string("2026-10-20"), "duedate": .string("2026-10-22"),
      ]),
    ])
  }
}
@Test func dataCenterUsesBearerV2IdentityProjectsBoardPaginationAndReviewedDateWrites() async throws
{
  let transport = DataCenterTransport()
  let client = JiraClient(
    connection: try .init(
      origin: "https://dc.example.test", email: "", token: "synthetic-pat", deployment: .dataCenter),
    transport: transport)
  let user = try await client.myself()
  #expect(user.accountId == "alex")
  let projects = try await client.workspaceProjects(query: "application")
  #expect(projects["values"].array.count == 1)
  let snapshot = try await client.loadWorkspace(
    boardID: "7", boardName: "Board", jql: "project = APP", startField: "customfield_10015",
    dueField: "duedate")
  #expect(snapshot.issues.map(\.key) == ["APP-1", "APP-2"])
  let context = try await client.dateEditContext(
    key: "APP-1", startField: "customfield_10015", dueField: "duedate")
  let proposal = try JiraWriteProposal.dates(
    origin: client.connection.origin, authorID: user.accountId, role: .coordinator,
    context: context, start: "2026-10-21", due: "2026-10-23")
  #expect(proposal.operations[0].path == "/rest/api/2/issue/APP-1")
  #expect(await transport.writes == 0)
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let results = try await JiraWriteExecutor(auditDirectory: directory).execute(
    proposal.approve(by: user), client: client)
  #expect(results[0].outcome == .succeeded)
  #expect(await transport.writes == 1)
  let metadata = try await client.metadataEditContext(key: "APP-1")
  let assignee = try JiraWriteProposal.assignee(
    origin: client.connection.origin, authorID: user.accountId, role: .coordinator,
    context: metadata, user: user)
  #expect(assignee.operations[0].body["fields"]["assignee"]["name"].string == "alex")
  let choices = try await client.assignableUsers(key: "APP-1", query: "al")
  #expect(choices[0].accountId == "alex")
  let requests = await transport.requests
  let search = requests.last!
  #expect(
    URLComponents(url: search.url!, resolvingAgainstBaseURL: false)!.queryItems!.contains {
      $0.name == "username" && $0.value == "al"
    })
  #expect(!requests.contains { $0.url!.path.contains("/rest/api/3/") })
}
