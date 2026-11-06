import Foundation
import Testing

@testable import PowerViewCore

@Test func atomicWorkspaceSavePreservesLatestEstimationEditAndRejectsStaleAutosave() async throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let url = directory.appendingPathComponent("workspace.pvworkspace")
  let persistence = WorkspacePersistence()
  var state = ProductWorkspace()
  _ = state.estimation.add("APP-1")
  state.estimation.drafts["APP-1"]?.edit("days", text: "3.5")
  try await persistence.save(state, to: url, revision: 1)
  let stale = state
  state.estimation.drafts["APP-1"]?.edit("days", text: "4")
  try await persistence.save(state, to: url, revision: 3)
  try await persistence.save(stale, to: url, revision: 2)
  let reopened = try JSONDecoder().decode(ProductWorkspace.self, from: Data(contentsOf: url))
  #expect(reopened.estimation.drafts["APP-1"]?.days == "4")
}
