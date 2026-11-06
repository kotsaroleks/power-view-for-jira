import Foundation

/// Native port of apps/web/src/app/estimation/workflow.ts, including invalidation rules.
public struct ChromeEstimationDraft: Codable, Equatable, Sendable {
  public var techLead = "", qaLead = "", days = "", decomposition = ""
  public var questions = "", answers = "", scope = "", environment = ""
  public var conditions = "", testPlan = "", testData = ""
  public var questionsResolved = false, scopeConfirmed = false, qaSubmitted = false, ready = false
  public init() {}
  public static func number(_ input: String) -> Double {
    let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty { return 0 }
    for (prefix, radix) in [("0x", 16), ("0b", 2), ("0o", 8)]
    where value.lowercased().hasPrefix(prefix) {
      let digits = value.dropFirst(2)
      guard !digits.isEmpty else { return .nan }
      var result = 0.0
      for digit in digits {
        guard let number = Int(String(digit), radix: radix) else { return .nan }
        result = result * Double(radix) + Double(number)
      }
      return result
    }
    guard
      value.range(
        of: "^[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$",
        options: .regularExpression) != nil
    else { return .nan }
    return Double(value) ?? .nan
  }
  public var techComplete: Bool {
    let estimate = Self.number(days)
    return estimate.isFinite && estimate > 0 && !techLead.trimmed.isEmpty
      && !decomposition.trimmed.isEmpty
  }
  public var scopeComplete: Bool {
    techComplete && !scope.trimmed.isEmpty
      && (questions.trimmed.isEmpty || (questionsResolved && !answers.trimmed.isEmpty))
  }
  public var qaComplete: Bool {
    scopeConfirmed && scopeComplete
      && [qaLead, environment, conditions, testPlan, testData].allSatisfy { !$0.trimmed.isEmpty }
  }
  public var stage: Int {
    if !techComplete { return 0 }
    if !questions.trimmed.isEmpty && (!questionsResolved || answers.trimmed.isEmpty) { return 1 }
    if !scopeConfirmed || !scopeComplete { return 2 }
    if !qaSubmitted || !qaComplete || !ready { return 3 }
    return 4
  }
  public mutating func edit(_ field: String, text: String? = nil, flag: Bool? = nil) {
    switch field {
    case "techLead": techLead = text ?? ""
    case "qaLead": qaLead = text ?? ""
    case "days": days = text ?? ""
    case "decomposition": decomposition = text ?? ""
    case "questions": questions = text ?? ""
    case "answers": answers = text ?? ""
    case "scope": scope = text ?? ""
    case "environment": environment = text ?? ""
    case "conditions": conditions = text ?? ""
    case "testPlan": testPlan = text ?? ""
    case "testData": testData = text ?? ""
    case "questionsResolved": questionsResolved = flag ?? false
    case "scopeConfirmed": scopeConfirmed = flag ?? false
    case "qaSubmitted":
      qaSubmitted = flag ?? false
      if !qaSubmitted { ready = false }
    case "ready": ready = flag ?? false
    default: return
    }
    if ["techLead", "days", "decomposition", "questions", "answers", "questionsResolved", "scope"]
      .contains(field)
    {
      scopeConfirmed = false
      qaSubmitted = false
      ready = false
    } else if ["qaLead", "environment", "conditions", "testPlan", "testData", "scopeConfirmed"]
      .contains(field)
    {
      qaSubmitted = false
      ready = false
    }
  }
  public func text(_ field: String) -> String {
    switch field {
    case "techLead": techLead
    case "qaLead": qaLead
    case "days": days
    case "decomposition": decomposition
    case "questions": questions
    case "answers": answers
    case "scope": scope
    case "environment": environment
    case "conditions": conditions
    case "testPlan": testPlan
    case "testData": testData
    default: ""
    }
  }
}
extension String {
  fileprivate var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
public struct ChromeEstimationBoard: Codable, Equatable, Sendable {
  public var release = ""
  public var keys: [String] = []
  public var drafts: [String: ChromeEstimationDraft] = [:]
  public init() {}
  public static let stages = [
    "Tech estimation", "PM clarification", "Scope confirmation", "QA preparation", "Ready to dev",
  ]
  public static func parseKeys(_ input: String) -> [String] {
    let value = input.uppercased()
    let regex = try! NSRegularExpression(pattern: "\\b[A-Z][A-Z0-9_]*-[0-9]+\\b")
    var seen: Set<String> = []
    return regex.matches(in: value, range: NSRange(value.startIndex..., in: value)).compactMap {
      guard let range = Range($0.range, in: value) else { return nil }
      let key = String(value[range])
      return seen.insert(key).inserted ? key : nil
    }
  }
  public mutating func add(_ input: String) -> Int {
    let added = Self.parseKeys(input).filter { !keys.contains($0) }
    for key in added {
      keys.append(key)
      drafts[key] = .init()
    }
    return added.count
  }
  public var total: Double {
    keys.reduce(0) { total, key in
      let value = ChromeEstimationDraft.number(drafts[key]?.days ?? "")
      return total + (value.isFinite && value > 0 ? value : 0)
    }
  }
  public static func read(_ data: Data) throws -> Self {
    let value = try JSONDecoder().decode(JSONValue.self, from: data)
    guard value["release"].string != nil, case .array = value["keys"],
      case .object = value["drafts"]
    else { throw ReleaseError.unsupportedFormat }
    var board = Self()
    board.release = value["release"].string!
    var seen: Set<String> = []
    for key in value["keys"].array.compactMap(\.string)
    where Self.parseKeys(key) == [key] && seen.insert(key).inserted {
      board.keys.append(key)
      let raw = value["drafts"][key]
      var draft = ChromeEstimationDraft()
      for name in [
        "techLead", "qaLead", "days", "decomposition", "questions", "answers", "scope",
        "environment", "conditions", "testPlan", "testData",
      ] {
        draft.edit(name, text: raw[name].string ?? "")
      }
      // Apply saved flags after material fields, as readBoard does without re-running edit invalidation.
      draft.questionsResolved = raw["questionsResolved"].boolean
      draft.scopeConfirmed = raw["scopeConfirmed"].boolean
      draft.qaSubmitted = raw["qaSubmitted"].boolean
      draft.ready = raw["ready"].boolean
      board.drafts[key] = draft
    }
    return board
  }
}
