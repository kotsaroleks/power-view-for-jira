import Foundation
import Testing

@testable import PowerViewCore

@Test func nativeEstimationMatchesOriginalChromeWorkflowForEveryEditAndReset() throws {
  let url = Bundle.module.url(
    forResource: "estimation-golden", withExtension: "json", subdirectory: "Fixtures")!
  let cases = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)).array
  var draft = ChromeEstimationDraft()
  for item in cases {
    let field = item["field"].string!
    if let text = item["value"].string {
      draft.edit(field, text: text)
    } else {
      draft.edit(field, flag: item["value"].boolean)
    }
    let expected = try JSONDecoder().decode(
      ChromeEstimationDraft.self, from: JSONEncoder().encode(item["expected"]))
    #expect(draft == expected)
    #expect(draft.stage == Int(item["stage"].number!))
    #expect(draft.techComplete == item["techComplete"].boolean)
    #expect(draft.scopeComplete == item["scopeComplete"].boolean)
    #expect(draft.qaComplete == item["qaComplete"].boolean)
  }
}
@Test func nativeHandoffKeepsChromeDraftsAndKeysWithoutInventedReleaseGates() throws {
  let raw = Data(
    #"{"release":"8.2","keys":["APP-1","OTHER-0","APP-1"],"drafts":{"APP-1":{"techLead":"Alex","days":"2","decomposition":"API","scope":"Scope","scopeConfirmed":true},"OTHER-0":{}}}"#
      .utf8)
  let board = try ChromeEstimationBoard.read(raw)
  #expect(board.keys == ["APP-1", "OTHER-0"])
  #expect(board.drafts["APP-1"]?.stage == 3)
  #expect(board.total == 2)
  let roundtrip = try ChromeEstimationBoard.read(JSONEncoder().encode(board))
  #expect(roundtrip == board)
}

@Test func nativeNumberValidationPreservesJavascriptImportedEstimateSemantics() {
  var board = ChromeEstimationBoard()
  _ = board.add("APP-1")
  for (text, expected) in [
    ("0x10", 16.0), ("0b11", 3), ("0o10", 8), (" 3.5 ", 3.5), ("1e2", 100), ("", 0),
    ("Infinity", 0), ("0x1p2", 0), ("1_000", 0),
  ] {
    var draft = ChromeEstimationDraft()
    draft.techLead = "Alex"
    draft.decomposition = "Work"
    draft.days = text
    board.drafts["APP-1"] = draft
    #expect(board.total == expected)
    #expect(draft.techComplete == (expected > 0))
  }
}
