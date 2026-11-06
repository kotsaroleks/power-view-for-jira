import Foundation
import Testing

@testable import PowerViewCore

private actor ReportTransport: JiraTransport {
  var mutations = 0
  var historyRequests = 0
  var issueVersion = "2026-08-01T12:00:00.000Z"
  func bumpVersion() { issueVersion = "2026-08-02T12:00:00.000Z" }
  let worklogsForbidden: Bool
  let issueCount: Int
  let delayedHistory: Bool
  let estimationField: String?
  var activeHistory = 0
  var peakHistory = 0
  init(
    worklogsForbidden: Bool = false, issueCount: Int = 2, delayedHistory: Bool = false,
    estimationField: String? = nil
  ) {
    self.estimationField = estimationField
    self.worklogsForbidden = worklogsForbidden
    self.issueCount = issueCount
    self.delayedHistory = delayedHistory
  }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    if request.httpMethod != "GET" { mutations += 1 }
    let path = request.url!.path
    if path.hasSuffix("/changelog") || path.hasSuffix("/worklog") {
      historyRequests += 1
      if delayedHistory {
        activeHistory += 1
        peakHistory = max(peakHistory, activeHistory)
        let key =
          path.split(separator: "/").dropLast().last?.split(separator: "-").last.flatMap { Int($0) }
          ?? 1
        try await Task.sleep(for: .milliseconds(max(1, 10 - key)))
        activeHistory -= 1
      }
    }
    let value: JSONValue
    var status = 200
    if path.hasSuffix("configuration") {
      value = .object([
        "estimation": .object([
          "field": .object(["fieldId": estimationField.map(JSONValue.string) ?? .null])
        ]),
        "columnConfig": .object([
          "columns": .array([.object(["statuses": .array([.object(["id": .string("done")])])])])
        ]),
      ])
    } else if path == "/rest/agile/1.0/board/1" {
      value = .object(["name": .string("Pilot Board"), "type": .string("scrum")])
    } else if path == "/rest/agile/1.0/board/1/sprint" {
      value = .object([
        "startAt": .number(0), "isLast": .bool(true),
        "values": .array([
          .object(["id": .number(7), "name": .string("Sprint 7"), "state": .string("active")])
        ]),
      ])
    } else if path == "/rest/agile/1.0/sprint/7" {
      value = .object([
        "id": .number(7), "name": .string("Sprint 7"), "state": .string("active"),
        "startDate": .string("2000-01-01T00:00:00.000Z"),
      ])
    } else if path.hasSuffix("/issue") {
      let ids = path.contains("/sprint/") ? ["1"] : (1...issueCount).map(String.init)
      value = page(ids.map(rawIssue), field: "issues")
    } else if path.hasSuffix("/changelog") {
      let entries: [JSONValue] =
        path.contains("APP-2")
        ? [
          .object([
            "id": .string("c"), "created": .string("2026-08-01T12:00:00.000Z"),
            "items": .array([
              .object([
                "field": .string("Sprint"), "fromString": .string("7"), "toString": .string(""),
              ])
            ]),
          ])
        ] : []
      value = page(entries, field: "values")
    } else if path.hasSuffix("/worklog") {
      if worklogsForbidden {
        status = 403
        value = .object([:])
      } else {
        let id = String(
          path.split(separator: "/").dropLast().last?.split(separator: "-").last ?? "1")
        value = page(
          [
            .object([
              "id": .string("w" + id), "issueId": .string(id),
              "started": .string("2026-08-01T12:00:00.000Z"), "timeSpentSeconds": .number(3600),
              "author": .object([
                "accountId": .string("writer"), "displayName": .string("Contributor"),
              ]),
            ])
          ], field: "worklogs")
      }
    } else {
      throw JiraError.unexpectedResponse
    }
    return (
      try JSONEncoder().encode(value),
      HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
  private func page(_ values: [JSONValue], field: String) -> JSONValue {
    .object([
      "startAt": .number(0), "maxResults": .number(100), "total": .number(Double(values.count)),
      field: .array(values),
    ])
  }
  private func rawIssue(_ id: String) -> JSONValue {
    .object([
      "id": .string(id), "key": .string("APP-" + id),
      "fields": .object([
        "summary": .string("Story " + id), "created": .string("2026-07-01T00:00:00.000Z"),
        "updated": .string(issueVersion),
        "status": .object([
          "id": .string("done"), "name": .string("Done"),
          "statusCategory": .object(["key": .string("done")]),
        ]), "issuetype": .object(["id": .string("1"), "name": .string("Story")]),
        "timetracking": .object([
          "originalEstimateSeconds": .number(28800), "timeSpentSeconds": .number(3600),
        ]),
      ]),
    ])
  }
}
@Test func nativeSprintLoadsRemovedBoardIssuesAndAllContributorsWithoutWrites() async throws {
  let transport = ReportTransport()
  let client = JiraClient(
    connection: try JiraConnection(
      origin: "https://jira.example.test", email: "fixture@example.test", token: "fixture-only"),
    transport: transport)
  let snapshot = try await client.generateReport(
    .init(
      type: "sprint", boardID: "1", sprintID: "7", localDate: "2026-10-16",
      completedStatusIDs: ["done"]))
  #expect(snapshot["result"]["executiveSummary"]["totalIssues"].number == 1)
  #expect(snapshot["result"]["executiveSummary"]["worklogSeconds"].number == 7200)
  #expect(
    snapshot["result"]["sprint"]["removedAfterStart"].array.first?["issue"]["key"].string == "APP-2"
  )
  #expect(snapshot["result"]["people"].array.first?["user"]["id"].string == "writer")
  #expect(await transport.mutations == 0)
}
@Test func unavailableWorklogsStayVisibleAsUnavailableInNativeText() async throws {
  let client = JiraClient(
    connection: try JiraConnection(
      origin: "https://jira.example.test", email: "fixture@example.test", token: "fixture-only"),
    transport: ReportTransport(worklogsForbidden: true))
  let snapshot = try await client.generateReport(
    .init(
      type: "sprint", boardID: "1", sprintID: "7", localDate: "2026-10-16",
      completedStatusIDs: ["done"]))
  #expect(!snapshot["completeness"]["complete"].boolean)
  #expect(ReportTextRenderer.render(snapshot, language: "en").contains("Worklog: N/A"))
}
@Test func reportHistoryNeverOverwritesSnapshotIDs() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try ReportHistoryStore(directory: directory)
  let id = UUID().uuidString
  let snapshot: JSONValue = .object([
    "id": .string(id), "generatedAt": .string("2026-10-16T00:00:00.000Z"),
  ])
  try store.save(snapshot)
  #expect(throws: (any Error).self) { try store.save(snapshot) }
  #expect(try store.list() == [snapshot])
}

@Test func deletingReportCanBeUndoneWithoutOverwritingAnotherSnapshot() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try ReportHistoryStore(directory: directory)
  let id = UUID().uuidString
  let snapshot: JSONValue = .object(["id": .string(id), "generatedAt": .string("2026-10-27T00:00:00Z")])
  try store.save(snapshot)
  try store.delete(id: id)
  #expect(try store.list().isEmpty)
  try store.restore(id: id)
  #expect(try store.list() == [snapshot])
  try store.delete(id: id)
  let competing: JSONValue = .object(["id": .string(id), "generatedAt": .string("2026-10-28T00:00:00Z")])
  try store.save(competing)
  #expect(throws: (any Error).self) { try store.restore(id: id) }
  #expect(try store.list() == [competing])
}

@Test func sprintModeSwitchUsesSnapshotDataAndPreservesRemovedIssueHistory() async throws {
  let transport = ReportTransport()
  let client = JiraClient(
    connection: try JiraConnection(
      origin: "https://jira.example.test", email: "fixture@example.test", token: "fixture-only"),
    transport: transport)
  let original = try await client.generateReport(
    .init(
      type: "sprint", boardID: "1", sprintID: "7", localDate: "2026-10-16",
      completedStatusIDs: ["done"]))
  let changed = try ReportCalculator.changingProgressMode(
    snapshot: original, to: "original-estimate")
  #expect(changed["id"] == original["id"])
  #expect(changed["issues"] == original["issues"])
  #expect(
    changed["result"]["sprint"]["removedAfterStart"]
      == original["result"]["sprint"]["removedAfterStart"])
  #expect(changed["result"]["sprint"]["completion"]["unit"].string == "seconds")
  #expect(original["result"]["sprint"]["completion"]["unit"].string == "issues")
}

@Test func boardHealthUsesWholeBoardAndServerResolvedSprintMembership() async throws {
  let transport = ReportTransport()
  let client = JiraClient(
    connection: try JiraConnection(
      origin: "https://jira.example.test", email: "fixture@example.test", token: "fixture-only"),
    transport: transport)
  let snapshot = try await client.generateReport(
    .init(type: "board-health", boardID: "1", localDate: "2026-10-16", completedStatusIDs: ["done"])
  )
  #expect(snapshot["result"]["boardHealth"]["total"].number == 2)
  #expect(snapshot["result"]["sprintHealth"].array.first?["issues"]["total"].number == 1)
  #expect(snapshot["result"]["boardHealth"]["planning"] != .null)
  #expect(ReportTextRenderer.render(snapshot, language: "en").contains("Blocked issues: N/A"))
  #expect(await transport.mutations == 0)
}

@Test func historyCacheReusesRawHistoryWithoutChangingResultsAndRespectsUserVersionAndForceRefresh()
  async throws
{
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let cache = JiraReportHistoryCache(directory: directory)
  let transport = ReportTransport()
  let client = JiraClient(
    connection: try .init(
      origin: "https://jira.example.test", email: "test@example.test", token: "fake"),
    transport: transport)
  var request = NativeReportRequest(
    type: "daily", boardID: "1", localDate: "2026-08-02", completedStatusIDs: ["done"],
    language: "en", verifiedUserID: "user-a")
  let original = try await client.generateReport(request, cache: cache)
  #expect(await transport.historyRequests == 4)
  let cached = try await client.generateReport(request, cache: cache)
  #expect(await transport.historyRequests == 4)
  #expect(original["result"] == cached["result"])
  #expect(cached["request"]["language"].string == "en")
  _ = try await client.generateReport(request, cache: cache, forceRefresh: true)
  #expect(await transport.historyRequests == 8)
  request.verifiedUserID = "user-b"
  _ = try await client.generateReport(request, cache: cache)
  #expect(await transport.historyRequests == 12)
  await transport.bumpVersion()
  _ = try await client.generateReport(request, cache: cache)
  #expect(await transport.historyRequests == 16)
  request.verifiedUserID = nil
  _ = try await client.generateReport(request, cache: cache)
  #expect(await transport.historyRequests == 20)
  #expect(await transport.mutations == 0)
}

@Test func historyFetchUsesFourBoundedWorkersAndPreservesIssueOrderWhenResponsesFinishOutOfOrder()
  async throws
{
  let transport = ReportTransport(issueCount: 8, delayedHistory: true)
  let client = JiraClient(
    connection: try .init(
      origin: "https://jira.example.test", email: "test@example.test", token: "fake"),
    transport: transport)
  let snapshot = try await client.generateReport(
    .init(type: "daily", boardID: "1", localDate: "2026-08-02", completedStatusIDs: ["done"]))
  #expect(await transport.peakHistory == 4)
  #expect(await transport.historyRequests == 16)
  #expect(
    snapshot["worklogs"].array.compactMap { $0["issueId"].string } == (1...8).map(String.init))
  #expect(await transport.mutations == 0)
}

@Test func timeBasedBoardDoesNotPresentSecondsAsStoryPoints() async throws {
  let transport = ReportTransport(estimationField: "timeoriginalestimate")
  let client = JiraClient(
    connection: try .init(
      origin: "https://jira.example.test", email: "fixture@example.test", token: "fixture"),
    transport: transport)
  let snapshot = try await client.generateReport(
    .init(type: "board-health", boardID: "1", localDate: "2026-10-24", completedStatusIDs: ["done"])
  )
  #expect(snapshot["result"]["storyPointsDataAvailable"].boolean == false)
  #expect(await transport.mutations == 0)
}
