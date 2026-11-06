import Testing

@testable import PowerViewCore

@Test func activityGroupsOneJiraEditAndOmitsSyntheticCompletion() {
  func event(_ id: String, _ type: String, _ to: JSONValue = .null) -> JSONValue {
    .object([
      "id": .string(id), "issueId": .string("1"), "issueKey": .string("APP-1"),
      "occurredAt": .string("2026-10-20T10:00:00Z"),
      "actor": .object(["id": .string("a"), "displayName": .string("Alex")]), "type": .string(type),
      "to": to,
    ])
  }
  let rows = ReportPresentation.activity([
    event("1", "issue-created"), event("2", "status-changed", .string("Done")),
    event("3", "assignee-changed", .string("Sam")), event("4", "issue-completed"),
    event("5", "story-points-changed", .number(0)),
  ])
  #expect(rows.count == 2)
  #expect(rows[0].actor == "—")
  #expect(rows[1].actor == "Alex")
  #expect(
    rows[1].change == "set status to \"Done\", reassigned to Sam and updated story points to 0")
}

@Test func changedIssueTreeRetainsUnchangedAncestorsAndPrunesUnchangedSiblings() {
  func issue(_ id: String, _ key: String, _ parent: String? = nil) -> JSONValue {
    .object([
      "id": .string(id), "key": .string(key), "parentId": parent.map(JSONValue.string) ?? .null,
    ])
  }
  let rows = ReportPresentation.changedTree(
    issues: [
      issue("3", "APP-10", "1"), issue("2", "APP-2", "1"), issue("1", "APP-1"),
      issue("4", "APP-4", "2"),
    ], events: [.object(["issueId": .string("4")])])
  #expect(rows.map(\.id) == ["1", "2", "4"])
  #expect(rows.map(\.depth) == [0, 1, 2])
}
