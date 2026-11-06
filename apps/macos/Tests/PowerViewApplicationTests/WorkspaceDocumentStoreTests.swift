import Foundation
import PowerViewCore
import Testing

@testable import PowerView

@Test @MainActor func openPreservesEditsBeforeAutosaveAndKeepsAnUnnamedWorkspace() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  let suite = "PowerViewTests." + UUID().uuidString
  let defaults = UserDefaults(suiteName: suite)!
  defer {
    defaults.removePersistentDomain(forName: suite)
    try? FileManager.default.removeItem(at: root)
  }
  let store = WorkspaceDocumentStore(
    recoveryURL: root.appendingPathComponent("recovery.pvworkspace"), defaults: defaults)
  let previous = root.appendingPathComponent(store.sessionID.uuidString + ".pvworkspace")
  store.document.state.estimation.release = "Unsaved release A"
  var b = ProductWorkspace()
  b.estimation.release = "Release B"
  let target = root.appendingPathComponent("B.pvworkspace")
  try JSONEncoder().encode(b).write(to: target)
  await store.open(target)
  let preserved = try JSONDecoder().decode(ProductWorkspace.self, from: Data(contentsOf: previous))
  #expect(preserved.estimation.release == "Unsaved release A")
  #expect(store.document.state.estimation.release == "Release B")
  #expect(store.fileURL == target)
  #expect(!store.switching)
  try await store.flush()
}
@Test @MainActor func competingOpenAndNewNeverCrossWriteDocuments() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  let suite = "PowerViewTests." + UUID().uuidString
  let defaults = UserDefaults(suiteName: suite)!
  defer {
    defaults.removePersistentDomain(forName: suite)
    try? FileManager.default.removeItem(at: root)
  }
  let store = WorkspaceDocumentStore(
    recoveryURL: root.appendingPathComponent("recovery.pvworkspace"), defaults: defaults)
  let original = root.appendingPathComponent(store.sessionID.uuidString + ".pvworkspace")
  store.document.state.estimation.release = "Release A"
  var b = ProductWorkspace()
  b.estimation.release = "Release B"
  let target = root.appendingPathComponent("B.pvworkspace")
  try JSONEncoder().encode(b).write(to: target)
  let open = Task { @MainActor in await store.open(target) }
  await Task.yield()
  await store.newWorkspace()
  await open.value
  try await store.flush()
  #expect(
    try JSONDecoder().decode(ProductWorkspace.self, from: Data(contentsOf: original)).estimation
      .release == "Release A")
  #expect(
    try JSONDecoder().decode(ProductWorkspace.self, from: Data(contentsOf: target)).estimation
      .release == "Release B")
  #expect(!store.switching)
}
