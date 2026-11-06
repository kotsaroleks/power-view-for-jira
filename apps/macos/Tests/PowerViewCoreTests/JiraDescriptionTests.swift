import Testing

@testable import PowerViewCore

private func paragraph(_ text: String) -> JSONValue {
  .object([
    "type": .string("paragraph"),
    "content": .array([.object(["type": .string("text"), "text": .string(text)])]),
  ])
}
@Test func repeatedACDoDTransferReplacesOneManagedBlockAndPreservesOtherNodes() throws {
  let media: JSONValue = .object([
    "type": .string("media"),
    "attrs": .object(["id": .string("attachment"), "type": .string("file")]),
  ])
  let mediaNode: JSONValue = .object([
    "type": .string("mediaSingle"),
    "attrs": .object(["layout": .string("center")]),
    "content": .array([media]),
  ])
  let original: JSONValue = .object([
    "type": .string("doc"), "version": .number(1),
    "content": .array([paragraph("Customer description"), mediaNode]),
  ])
  let first = try JiraDescription.merging(
    existing: original, acceptanceCriteria: "First AC", definitionOfDone: "First DoD")
  let second = try JiraDescription.merging(
    existing: first, acceptanceCriteria: "Revised AC\nSecond criterion",
    definitionOfDone: "Revised DoD")
  #expect(second["content"].array.count == 3)
  #expect(Array(second["content"].array.prefix(2)) == original["content"].array)
  #expect(!second.plainText.contains("First AC"))
  #expect(second.plainText.contains("Revised AC"))
  #expect(second.plainText.contains("Second criterion"))
}
@Test func ambiguousManagedDescriptionIsRejectedBeforePreview() throws {
  let first = try JiraDescription.merging(
    existing: nil, acceptanceCriteria: "AC", definitionOfDone: "DoD")
  var object = first.object
  object["content"] = .array(first["content"].array + first["content"].array)
  #expect(throws: JiraDescriptionError.ambiguousManagedSections) {
    try JiraDescription.merging(
      existing: .object(object), acceptanceCriteria: "New", definitionOfDone: "New")
  }
}
@Test func exactLegacyACDoDBlockMigratesWithoutRemovingSurroundingText() throws {
  let original: JSONValue = .object([
    "type": .string("doc"), "version": .number(1),
    "content": .array([
      paragraph("Before"), paragraph("Power View — Acceptance Criteria"), paragraph("Legacy AC"),
      paragraph("Power View — Definition of Done"), paragraph("Legacy DoD"), paragraph("After"),
    ]),
  ])
  let result = try JiraDescription.merging(
    existing: original, acceptanceCriteria: "New AC", definitionOfDone: "New DoD")
  #expect(result["content"].array.count == 3)
  #expect(result["content"].array.first == paragraph("Before"))
  #expect(result["content"].array.last == paragraph("After"))
}
