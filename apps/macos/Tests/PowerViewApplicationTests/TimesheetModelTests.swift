import Foundation
import Testing
@testable import PowerView
import PowerViewCore

@MainActor @Test func nativeTimesheetLargeBoardBuildsHierarchyWithoutRepeatedSorting() throws {
  let began = Date()
  let model = NativeTimesheetModel()
  let issues: [TimeIssue] = try (1...1500).map { index in
    let json = "{\"id\":\"\(index)\",\"key\":\"APP-\(index)\",\"fields\":{\"summary\":\"Task \(index)\",\"project\":{\"id\":\"100\",\"key\":\"APP\"},\"parent\":{\"key\":\"APP-1\"}}}"
    return try TimeIssue(raw: JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)))
  }
  print("Timesheet fixture construction: \(Date().timeIntervalSince(began))")
  let rowsBegan = Date()
  model.boardIssues = issues
  model.priorities = ["APP-1"]
  #expect(model.rows(search: "").count > 0) // even malformed self-parent must remain reachable
  #expect(model.rows(search: "Task").count == 1500)
  model.pins = ["APP-100"]
  #expect(model.rows(search: "").first?.issue.key == "APP-100")
  print("Timesheet three hierarchy passes: \(Date().timeIntervalSince(rowsBegan))")
}
@MainActor @Test func nativeTimesheetExplicitFilterDoesNotLeakBoardOnlyRows() throws {
  let raw = #"{"id":"1","key":"APP-1","fields":{"summary":"Task","project":{"id":"100","key":"APP"}}}"#
  let model = NativeTimesheetModel()
  model.boardIssues = [try TimeIssue(raw: JSONDecoder().decode(JSONValue.self, from: Data(raw.utf8)))]
  #expect(model.allIssues.count == 1)
  model.explicitJQL = "project = OTHER"
  #expect(model.allIssues.isEmpty)
}
