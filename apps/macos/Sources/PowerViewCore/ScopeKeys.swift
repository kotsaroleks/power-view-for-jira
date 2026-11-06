import Foundation

public struct ScopeKeys: Equatable, Sendable {
  public let accepted: [String]
  public let duplicates: [String]
  public let foreign: [String]
  public static func parse(_ text: String, project: String, existing: Set<String>) -> Self {
    let upper = text.uppercased()
    let expression = try! NSRegularExpression(pattern: "\\b[A-Z][A-Z0-9_]*-[1-9][0-9]*\\b")
    var seen = existing
    var accepted: [String] = []
    var duplicates: [String] = []
    var foreign: [String] = []
    for match in expression.matches(in: upper, range: NSRange(upper.startIndex..., in: upper)) {
      guard let range = Range(match.range, in: upper) else { continue }
      let key = String(upper[range])
      if !key.hasPrefix(project + "-") {
        if !foreign.contains(key) { foreign.append(key) }
      } else if !seen.insert(key).inserted {
        if !duplicates.contains(key) { duplicates.append(key) }
      } else {
        accepted.append(key)
      }
    }
    return .init(accepted: accepted, duplicates: duplicates, foreign: foreign)
  }
}
