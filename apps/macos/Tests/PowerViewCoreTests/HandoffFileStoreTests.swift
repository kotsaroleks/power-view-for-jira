import Foundation
import Testing

@testable import PowerViewCore

@Test func sharedHandoffRejectsAnotherUsersChangeWithoutOverwritingIt() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let url = root.appendingPathComponent("shared.json")
  let first = Data("{\"lead\":\"Alex\"}".utf8)
  let base = try HandoffFileStore.save(first, to: url, expected: nil)
  let second = Data("{\"lead\":\"Sam\"}".utf8)
  let newer = try HandoffFileStore.save(second, to: url, expected: base)
  #expect(newer != base)
  #expect(throws: HandoffFileError.changedElsewhere) {
    try HandoffFileStore.save(first, to: url, expected: base)
  }
  #expect(try Data(contentsOf: url) == second)
  try FileManager.default.removeItem(at: url)
  #expect(throws: HandoffFileError.changedElsewhere) {
    try HandoffFileStore.save(first, to: url, expected: newer)
  }
}

@Test func twoIndependentEstimationReadersContinueOneFileAndRejectStaleSave() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: root) }
  let file = root.appendingPathComponent("handoff.json")
  var lead = ChromeEstimationBoard(); lead.release = "Fixture release"; _ = lead.add("TEST-2")
  var draft = ChromeEstimationDraft(); draft.edit("techLead", text: "Fixture TL"); draft.edit("days", text: "3.5"); draft.edit("decomposition", text: "Implement the fixture")
  lead.drafts["TEST-2"] = draft
  let firstData = try JSONEncoder().encode(lead)
  let firstVersion = try HandoffFileStore.save(firstData, to: file, expected: nil)
  let receivedData = try HandoffFileStore.read(file)
  var pm = try ChromeEstimationBoard.read(receivedData)
  #expect(pm.drafts["TEST-2"]?.days == "3.5")
  pm.drafts["TEST-2"]?.edit("scope", text: "Confirmed fixture scope")
  pm.drafts["TEST-2"]?.edit("scopeConfirmed", flag: true)
  let secondData = try JSONEncoder().encode(pm)
  _ = try HandoffFileStore.save(secondData, to: file, expected: HandoffFileStore.fingerprint(receivedData))
  #expect(throws: HandoffFileError.changedElsewhere) { try HandoffFileStore.save(firstData, to: file, expected: firstVersion) }
  let reopened = try ChromeEstimationBoard.read(HandoffFileStore.read(file))
  #expect(reopened.drafts["TEST-2"]?.stage == 3 && reopened.total == 3.5)
}
