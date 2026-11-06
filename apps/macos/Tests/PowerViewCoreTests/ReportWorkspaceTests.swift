import Foundation
import Testing

@testable import PowerViewCore

@Test func reportingSetupIsSharedByReportTypesButIsolatedByJiraProject() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  let origin = URL(string: "https://jira.example.test")!
  let store = try ReportWorkspaceStore(directory: root, origin: origin, projectKey: "APP")
  let setup = ReportWorkspace(
    boardID: "7", jql: "project = APP", completedStatusIDs: ["done", "accepted"])
  try store.save(setup)
  #expect(try store.load() == setup)
  #expect(
    try ReportWorkspaceStore(directory: root, origin: origin, projectKey: "OTHER").load() == nil)
  #expect(
    try ReportWorkspaceStore(
      directory: root, origin: URL(string: "https://other.example.test")!, projectKey: "APP"
    ).load() == nil)
}
