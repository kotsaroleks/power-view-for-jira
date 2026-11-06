import Foundation
import Testing

@testable import PowerViewCore

@Test func corruptedPreferredWorkspaceRecoversSavedDrafts() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let broken = root.appendingPathComponent("broken.pvworkspace")
  let recovery = root.appendingPathComponent("recovery.pvworkspace")
  try Data("{truncated".utf8).write(to: broken)
  var workspace = ProductWorkspace()
  workspace.estimation.release = "Preserved release"
  try JSONEncoder().encode(workspace).write(to: recovery)
  let result = WorkspaceRecovery.restore(preferred: broken, recovery: recovery)
  #expect(result?.state.estimation.release == "Preserved release")
  #expect(result?.usedFallback == true)
  try FileManager.default.removeItem(at: broken)
  #expect(
    WorkspaceRecovery.restore(preferred: broken, recovery: recovery)?.state.estimation.release
      == "Preserved release")
}
