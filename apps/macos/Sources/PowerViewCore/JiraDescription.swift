import Foundation

public enum JiraDescriptionError: Error, Equatable {
  case unsupportedDocument, ambiguousManagedSections
}
public enum JiraDescription {
  public static let managedTitle = "Power View — Acceptance Criteria / Definition of Done"
  /// Only the explicitly labelled Power View panel is replaced. All other ADF nodes stay byte-semantically intact.
  public static func merging(
    existing: JSONValue?, acceptanceCriteria: String, definitionOfDone: String
  ) throws -> JSONValue {
    var document: [String: JSONValue]
    if let existing, existing != .null {
      guard case .object(let object) = existing, object["type"] == .string("doc"),
        case .array = object["content"]
      else { throw JiraDescriptionError.unsupportedDocument }
      document = object
    } else {
      document = ["type": .string("doc"), "version": .number(1), "content": .array([])]
    }
    var nodes = document["content"]!.array
    let matches = nodes.indices.filter { index in
      nodes[index]["type"].string == "panel"
        && nodes[index]["content"].array.first?.plainText.trimmingCharacters(
          in: .whitespacesAndNewlines) == managedTitle
    }
    guard matches.count <= 1 else { throw JiraDescriptionError.ambiguousManagedSections }
    func heading(_ text: String) -> JSONValue {
      .object([
        "type": .string("heading"), "attrs": .object(["level": .number(2)]),
        "content": .array([.object(["type": .string("text"), "text": .string(text)])]),
      ])
    }
    let content =
      [paragraph(managedTitle), heading("Acceptance Criteria")] + paragraphs(acceptanceCriteria) + [
        heading("Definition of Done")
      ] + paragraphs(definitionOfDone)
    let panel: JSONValue = .object([
      "type": .string("panel"), "attrs": .object(["panelType": .string("info")]),
      "content": .array(content),
    ])
    if let index = matches.first {
      nodes[index] = panel
    } else {
      // Migrate the exact four-paragraph package emitted by the first native prototype.
      // Similar headings, custom panels, rich sections, and everything outside this exact package are preserved.
      var legacy: [Int] = []
      if nodes.count >= 4 {
        for index in 0...(nodes.count - 4) {
          let block = Array(nodes[index..<(index + 4)])
          if block.allSatisfy({ $0["type"].string == "paragraph" }),
            block[0].plainText.trimmingCharacters(in: .whitespacesAndNewlines)
              == "Power View — Acceptance Criteria",
            block[2].plainText.trimmingCharacters(in: .whitespacesAndNewlines)
              == "Power View — Definition of Done"
          {
            legacy.append(index)
          }
        }
      }
      guard legacy.count <= 1 else { throw JiraDescriptionError.ambiguousManagedSections }
      if let index = legacy.first {
        nodes.replaceSubrange(index..<(index + 4), with: [panel])
      } else {
        nodes.append(panel)
      }
    }
    document["content"] = .array(nodes)
    return .object(document)
  }
  private static func paragraph(_ text: String) -> JSONValue {
    .object([
      "type": .string("paragraph"),
      "content": text.isEmpty
        ? .array([]) : .array([.object(["type": .string("text"), "text": .string(text)])]),
    ])
  }
  private static func paragraphs(_ text: String) -> [JSONValue] {
    text.components(separatedBy: "\n").map(paragraph)
  }
}
