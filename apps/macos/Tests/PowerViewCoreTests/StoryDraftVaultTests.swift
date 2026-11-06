import Foundation
import Testing

@testable import PowerViewCore

@Test func encryptedDraftRequiresAuthorsKeyAndRestoresSelectedFieldsOnly() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let releaseID = UUID()
  let base = prepared()
  var edited = base
  edited.acceptanceCriteria = "private author changes"
  let envelope = StoryDraftEnvelope(
    releaseID: releaseID, authorID: "author", baseRevision: 2, base: base, edited: edited)
  let vault = try StoryDraftVault(
    directory: directory, authorID: "author", keyData: Data(repeating: 1, count: 32))
  try vault.save(envelope)
  #expect(try vault.load(releaseID: releaseID, storyKey: base.id) == envelope)
  var shared = base
  shared.acceptanceCriteria = "other author"
  shared.definitionOfDone = "new shared DoD"
  #expect(
    try envelope.differences(shared: shared).contains {
      $0.field == "acceptanceCriteria" && $0.conflict
    })
  let restored = try envelope.restoring(fields: ["acceptanceCriteria"], into: shared)
  #expect(restored.acceptanceCriteria == edited.acceptanceCriteria)
  #expect(restored.definitionOfDone == shared.definitionOfDone)
  let wrongKey = try StoryDraftVault(
    directory: directory, authorID: "author", keyData: Data(repeating: 2, count: 32))
  #expect(throws: (any Error).self) { try wrongKey.load(releaseID: releaseID, storyKey: base.id) }
  let otherAuthor = try StoryDraftVault(
    directory: directory, authorID: "other", keyData: Data(repeating: 1, count: 32))
  #expect(try otherAuthor.load(releaseID: releaseID, storyKey: base.id) == nil)
  #expect(throws: ReleaseError.forbidden) { try otherAuthor.save(envelope) }
}
