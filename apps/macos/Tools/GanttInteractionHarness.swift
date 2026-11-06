// Isolated UI acceptance app. Every request is handled in memory; no network transport exists.
import AppKit
import PowerViewCore
import SwiftUI

private func fixtureIssue(_ key: String) -> JSONValue {
  let first = key == "TEST-1"
  return .object([
    "id": .string(first ? "1" : "2"), "key": .string(key),
    "fields": .object([
      "summary": .string(first ? "Isolated date-edit task" : "Dependent task"),
      "updated": .string("1"),
      "project": .object(["id": .string("1"), "key": .string("TEST")]),
      "status": .object([
        "id": .string("1"), "name": .string("To Do"),
        "statusCategory": .object(["key": .string("new")]),
      ]),
      "issuetype": .object(["id": .string("1"), "name": .string("Story"), "subtask": .bool(false)]),
      "customfield_10015": .string(first ? "2026-10-19" : "2026-10-26"),
      "duedate": .string(first ? "2026-10-21" : "2026-10-28"),
    ]),
  ])
}
private actor GanttMockTransport: JiraTransport {
  private var issues = ["TEST-1": fixtureIssue("TEST-1"), "TEST-2": fixtureIssue("TEST-2")]
  private var writes: [JSONValue] = []
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    guard request.url?.host == "gantt-fixture.invalid" else { throw JiraError.invalidOrigin }
    let path = request.url!.path
    let value: JSONValue
    var status = 200
    if path.hasSuffix("/myself") {
      value = .object([
        "accountId": .string("fixture-user"), "displayName": .string("Fixture User"),
      ])
    } else if path.hasSuffix("/editmeta") {
      let field: JSONValue = .object([
        "schema": .object(["type": .string("date")]), "operations": .array([.string("set")]),
      ])
      value = .object(["fields": .object(["customfield_10015": field, "duedate": field])])
    } else if ["/rest/agile/1.0/board/90000/issue", "/rest/software/1.0/board/90000/issue"].contains(path) {
      value = .object([
        "startAt": .number(0), "total": .number(2), "isLast": .bool(true),
        "issues": .array(issues.keys.sorted().compactMap { issues[$0] }),
      ])
    } else if let current = issues[request.url!.lastPathComponent] {
      if request.httpMethod == "PUT" {
        let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
        var raw = current.object
        var fields = current["fields"].object
        fields.merge(body["fields"].object) { _, new in new }
        fields["updated"] = .string(String(writes.count + 2))
        raw["fields"] = .object(fields)
        issues[request.url!.lastPathComponent] = .object(raw)
        writes.append(.object(["key": .string(request.url!.lastPathComponent), "body": body]))
        try JSONEncoder().encode(writes).write(
          to: URL(fileURLWithPath: "/private/tmp/power-view-gantt-fixture-writes.json"),
          options: .atomic)
        status = 204
        value = .null
      } else {
        value = current
      }
    } else {
      throw JiraError.unexpectedResponse
    }
    return (
      try JSONEncoder().encode(value),
      HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
}
@main private struct GanttInteractionHarness: App {
  @State private var state: ProductWorkspace
  @StateObject private var session: JiraSession
  init() {
    let connection = try! JiraConnection(
      origin: "https://gantt-fixture.invalid", email: "fixture@example.invalid",
      token: "fixture-only")
    let client = JiraClient(connection: connection, transport: GanttMockTransport())
    _session = StateObject(
      wrappedValue: JiraSession(
        client: client, user: .init(accountId: "fixture-user", displayName: "Fixture User"),
        auditDirectory: URL(fileURLWithPath: "/private/tmp/power-view-gantt-fixture-audit")))
    var state = ProductWorkspace()
    state.snapshot = .init(
      boardID: "90000", boardName: "Isolated Gantt test", jql: "",
      issues: [
        try! WorkspaceIssue(raw: fixtureIssue("TEST-1")),
        try! WorkspaceIssue(raw: fixtureIssue("TEST-2")),
      ], startField: "customfield_10015", dueField: "duedate", origin: connection.origin.absoluteString)
    state.preferences.dayWidth = 24
    _state = State(initialValue: state)
  }
  var body: some Scene {
    Window("Power View — isolated Gantt test", id: "fixture") {
      VStack(alignment: .leading, spacing: 16) {
        Text("Isolated Gantt acceptance test — no real Jira connection").font(.headline)
        ProductGantt(state: $state, jira: session)
      }.padding(24).frame(minWidth: 1100, minHeight: 650).preferredColorScheme(.light)
    }.defaultSize(width: 1360, height: 850)
  }
}
