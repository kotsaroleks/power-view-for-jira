import Foundation
import Testing
@testable import PowerView
@testable import PowerViewCore

private func timeGolden() throws -> JSONValue {
  let url = try #require(Bundle.module.url(forResource: "time-tracking-golden", withExtension: "json", subdirectory: "Fixtures"))
  return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
}
@MainActor @Test func weeklyRowsMatchCurrentChromeGoldenIncludingCyclesAndParentContext() async throws {
  let transport = NativeTimeFixtureTransport()
  let client = JiraClient(connection: try JiraConnection(origin: NativeTimeFixtureTransport.origin, email: "fixture@example.invalid", token: "fixture-only"), transport: transport)
  let session = JiraSession(client: client, user: JiraUser(accountId: "fixture", displayName: "Fixture"))
  let suite = "PowerView.Golden." + UUID().uuidString; let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  for test in try timeGolden()["weekly"].array {
    let model = NativeTimesheetModel(calendarStore: nil, defaults: defaults)
    await model.configure(session)
    let issues = try test["issues"].array.map { row in try TimeIssue(raw: .object([
      "id": row["id"], "key": row["key"], "fields": .object([
        "summary": row["summary"], "project": .object(["id": .string("100"), "key": .string("TEST")]),
        "parent": .object(["key": row["parentKey"]]), "assignee": .object(["accountId": row["assigneeId"]]),
        "issuetype": .object(["hierarchyLevel": row["hierarchyLevel"]]),
      ]),
    ])) }
    model.boardIssues = issues
    let logs = try test["logged"].array.enumerated().map { index, key in
      let issue = try #require(issues.first { $0.key == key.plainText })
      return try TimeWorklog(raw: NativeTimeFixtureTransport.log(id: String(index + 1), issue: issue.id, day: "2026-11-03"), issue: issue)
    }
    model.snapshot = TimeSnapshot(issues: issues, worklogs: logs, warnings: [], discoveryJQL: "fixture", loadedAt: Date(), readIssueCount: issues.count, readWorklogCount: logs.count)
    model.pins = test["pins"].array.compactMap(\.string); model.priorities = test["priorities"].array.compactMap(\.string); model.expanded = Set(test["expanded"].array.compactMap(\.string))
    let actual = model.rows(search: test["search"].plainText)
    let expected = test["expected"].array
    #expect(actual.count == expected.count, "\(test["name"].plainText)")
    for (row, value) in zip(actual, expected) {
      #expect(row.issue.key == value["key"].string)
      #expect(row.group == Int(value["group"].number!) && row.depth == Int(value["depth"].number!))
      #expect(row.hasChildren == value["hasChildren"].boolean && row.withoutParent == value["withoutParent"].boolean)
      #expect(row.parentHeading?.key == value["parentHeading"].string)
    }
  }
}
@Test func reportMetricsAndTimezoneWarningsMatchCurrentChromeGolden() throws {
  let golden = try timeGolden()
  for test in golden["reports"].array {
    let input = test["input"]
    let users = input["users"].array.map { JiraUser(accountId: $0["userId"].plainText, displayName: $0["displayName"].plainText) }
    let logs = try input["worklogs"].array.map { raw in
      let issue = try TimeIssue(raw: .object(["id": .string(raw["issueKey"].plainText.components(separatedBy: "-").last!), "key": raw["issueKey"], "fields": .object(["summary": .string("Fixture"), "project": .object(["id": .string("100")])])]))
      return try TimeWorklog(raw: NativeTimeFixtureTransport.log(id: raw["id"].plainText, issue: issue.id, day: raw["day"].plainText, author: raw["userId"].plainText, seconds: Int(raw["timeSpentSeconds"].number!)), issue: issue)
    }
    var calendar = SharedDayOff()
    for off in input["dayOffs"].array { calendar.dates[off["userId"].plainText, default: []].insert(off["date"].plainText) }
    let query = TimeQuery(days: TimeCalendar.days(anchor: input["weekStart"].plainText, month: input["periodMode"].plainText == "month"), zone: "UTC")
    let result = try TimeReportCalculator.build(users: users, worklogs: logs, query: query, calendar: calendar, worklogsComplete: true)
    for (person, expected) in zip(result, test["expected"]["employees"].array) {
      #expect(person.logged == Int(expected["loggedSeconds"].number!))
      #expect(person.expected == Int(expected["expectedSeconds"].number!))
      #expect(person.missing == Int(expected["missingSeconds"].number!) && person.overtime == Int(expected["overtimeSeconds"].number!))
      if let percent = expected["utilizationPercent"].number { #expect(abs((person.utilization ?? -1) - percent) < 0.000001) }
      else { #expect(person.utilization == nil) }
      for day in expected["days"].array { #expect((person.days[day["date"].plainText] ?? 0) == Int(day["loggedSeconds"].number!)) }
    }
    #expect(result.reduce(0) { $0 + $1.logged } == Int(test["expected"]["team"]["loggedSeconds"].number!))
  }
  for test in golden["warnings"].array { #expect(TimeCalendar.profileWarning(zone: test["zone"].string, days: test["days"].array.compactMap(\.string)) == test["expected"].string) }
}
@MainActor @Test func boardPickerSeparatesAssignedChildrenAndScopedFavorites() async throws {
  let transport = NativeTimeFixtureTransport()
  let client = JiraClient(connection: try JiraConnection(origin: NativeTimeFixtureTransport.origin, email: "fixture@example.invalid", token: "fixture-only"), transport: transport)
  let session = JiraSession(client: client, user: JiraUser(accountId: "fixture", displayName: "Fixture"))
  let suite = "PowerView.Picker." + UUID().uuidString; let defaults = UserDefaults(suiteName: suite)!; defer { defaults.removePersistentDomain(forName: suite) }
  let picker = NativeWorklogBoardPicker(defaults: defaults)
  await picker.configure(session); picker.boardID = "101"; await picker.loadBoard()
  #expect(picker.parents.map(\.key) == ["TEST-1", "TEST-2", "TEST-3"])
  picker.parentKey = "TEST-1"
  #expect(picker.groups.first?.issues.map(\.key) == ["TEST-2"])
  #expect(picker.groups.dropFirst().flatMap(\.issues).map(\.key) == ["TEST-4"])
  picker.toggleFavorite("TEST-1")
  picker.boardID = "202"; await picker.loadBoard(); #expect(picker.favorites.isEmpty)
  picker.boardID = "101"; await picker.loadBoard(); #expect(picker.favorites == ["TEST-1"])
}
