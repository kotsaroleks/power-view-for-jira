import Foundation
import Testing

@testable import PowerViewCore

@Test func privateRecoveryKeepsOtherEditorsChanges() throws {
  let id = UUID()
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try PrivateDraftStore(directory: directory)
  let draft = PrivateDraft(
    releaseID: id, baseRevision: 1, base: ["AC": "old", "DoD": "old"],
    edited: ["AC": "mine", "DoD": "old"])
  try store.save(draft)
  #expect(try store.load(releaseID: id) == draft)
  let shared = ["AC": "theirs", "DoD": "new shared"]
  #expect(draft.differences(shared: shared).first?.conflict == true)
  #expect(draft.restoring(selectedFields: [], into: shared) == shared)
  #expect(
    draft.restoring(selectedFields: ["AC"], into: shared) == ["AC": "mine", "DoD": "new shared"])
  let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
  #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o700)
}
