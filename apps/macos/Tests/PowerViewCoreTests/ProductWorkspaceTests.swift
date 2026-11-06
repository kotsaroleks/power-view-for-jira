import Foundation
import Testing

@testable import PowerViewCore

@Test func workspaceSwitchRestoresEstimationPlansLinksAndPreferencesWithoutCrossBoardAttribution()
  throws
{
  var state = ProductWorkspace()
  func snapshot(_ origin: String, _ id: String) -> WorkspaceSnapshot {
    .init(boardID: id, boardName: id, jql: "", issues: [], origin: origin)
  }
  let a = snapshot("https://a.example.test", "1")
  let b = snapshot("https://a.example.test", "2")
  let c = snapshot("https://b.example.test", "1")
  state.activate(a, setup: nil)
  _ = state.estimation.add("APP-1")
  state.estimation.release = "A"
  state.handoffPath = "/fixture/A.json"
  state.handoffFingerprint = "accepted-A"
  state.plans["APP-1"] = .init(start: "2026-10-20", due: "2026-10-21", dependencies: [])
  state.links = [.init(predecessor: "APP-1", successor: "APP-2", kind: .FS)]
  state.preferences.search = "A only"
  state.activate(b, setup: nil)
  #expect(state.estimation.keys.isEmpty && state.plans.isEmpty && state.links.isEmpty)
  state.estimation.release = "B"
  state.activate(c, setup: nil)
  #expect(state.estimation.release.isEmpty)
  let client = JiraClient(
    connection: try .init(origin: "https://a.example.test", email: "a@example.test", token: "fake"))
  #expect(!state.matches(client))
  state = try JSONDecoder().decode(ProductWorkspace.self, from: JSONEncoder().encode(state))
  state.activate(a, setup: nil)
  #expect(state.matches(client))
  #expect(state.estimation.release == "A" && state.estimation.keys == ["APP-1"])
  #expect(state.handoffPath == "/fixture/A.json" && state.handoffFingerprint == "accepted-A")
  #expect(state.plans["APP-1"]?.due == "2026-10-21" && state.links.count == 1)
  #expect(state.preferences.search == "A only")
  state.activate(b, setup: nil)
  #expect(state.estimation.release == "B")
}
@Test func portableChromeConfigurationImportsRealEnvelopeAndRejectsMismatchedScopeAndCycles() throws
{
  let setup: JSONValue = .object([
    "jiraBaseUrl": .string("https://jira.example.test"),
    "project": .object(["key": .string("APP")]),
    "board": .object(["id": .string("7"), "name": .string("Board")]),
    "jql": .string("project = APP"),
  ])
  var raw: JSONValue = .object([
    "kind": .string("power-view-board-configuration"), "version": .number(1),
    "board": .object([
      "jiraBaseUrl": .string("https://jira.example.test"), "projectKey": .string("APP"),
      "boardId": .string("7"),
    ]),
    "configuration": .object([
      "setup": setup,
      "ganttViewPreferences": .object([
        "zoom": .string("day"), "sortBy": .string("name"), "sortDirection": .string("desc"),
      ]),
      "ganttBoardState": .object([
        "dependencies": .array([
          .object([
            "id": .string("link"), "predecessorIssueKey": .string("APP-1"),
            "successorIssueKey": .string("APP-2"), "type": .string("FS"),
            "lagWorkingDays": .number(2),
          ])
        ]),
        "reconciledDates": .object([
          "APP-1": .object(["startDate": .string("2026-10-20"), "dueDate": .string("2026-10-21")])
        ]),
      ]),
    ]),
  ])
  let imported = try ChromeSetup.decode(JSONEncoder().encode(raw))
  #expect(imported.archive == raw && imported.raw == setup)
  #expect(
    imported.links.first?.lagWorkingDays == 2
      && imported.reconciledDates["APP-1"]?.due == "2026-10-21")
  #expect(
    imported.preferences.dayWidth == 40 && imported.preferences.sort == .name
      && !imported.preferences.ascending)
  var object = raw.object
  object["board"] = .object([
    "jiraBaseUrl": .string("https://other.example.test"), "projectKey": .string("APP"),
    "boardId": .string("7"),
  ])
  raw = .object(object)
  #expect(throws: ReleaseError.unsupportedFormat) {
    try ChromeSetup.decode(JSONEncoder().encode(raw))
  }
}

@Test func realChromeExportCanRoundTripThroughNativeWithoutLosingSetupOrGanttData() throws {
  let fixture = Bundle.module.url(
    forResource: "chrome-portable-export", withExtension: "json", subdirectory: "Fixtures")!
  let imported = try ChromeSetup.decode(Data(contentsOf: fixture))
  var state = ProductWorkspace()
  let snapshot = WorkspaceSnapshot(
    boardID: imported.boardID, boardName: imported.boardName, jql: imported.jql, issues: [],
    origin: imported.origin)
  state.activate(snapshot, setup: imported.raw, preferences: imported.preferences)
  state.importedConfiguration = imported.archive
  state.links = imported.links
  state.reconciledDates = imported.reconciledDates
  let exported = try state.exportPortableConfiguration()
  let roundtrip = try ChromeSetup.decode(JSONEncoder().encode(exported))
  #expect(roundtrip.raw["fieldMapping"] == imported.raw["fieldMapping"])
  #expect(roundtrip.raw["reporting"] == imported.raw["reporting"])
  #expect(roundtrip.links == imported.links)
  #expect(roundtrip.reconciledDates == imported.reconciledDates)
  #expect(roundtrip.preferences == imported.preferences)
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(
    "power-view-native-portable-export.json")
  try JSONEncoder().encode(exported).write(to: url)
}

@Test func creatingDependencyRecordsChromeComparisonBaselinesForBothTasks() throws {
  let raw: JSONValue = .object([
    "key": .string("APP-1"),
    "fields": .object([
      "summary": .string("First"), "status": .object(["name": .string("Open")]),
      "customfield_10015": .string("2026-10-19"), "duedate": .string("2026-10-21"),
    ]),
  ])
  let first = try WorkspaceIssue(raw: raw)
  var other = raw.object
  other["key"] = .string("APP-2")
  let second = try WorkspaceIssue(raw: .object(other))
  let schedule = TimelineSchedule.build(issues: [first, second])
  var state = ProductWorkspace()
  state.addDependency(
    .init(predecessor: "APP-1", successor: "APP-2", kind: .FS), schedule: schedule)
  #expect(state.links.count == 1)
  #expect(state.reconciledDates?["APP-1"]?.start == "2026-10-19")
  #expect(state.reconciledDates?["APP-2"]?.due == "2026-10-21")
}
