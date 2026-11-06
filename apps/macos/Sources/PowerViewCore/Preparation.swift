import Foundation

public enum Role: String, Codable, CaseIterable, Sendable {
  case coordinator = "Координатор"
  case techLead = "ТЛ"
  case qaLead = "QA лід"
  case viewer = "Перегляд"
}
public enum PreparationState: String, Codable, Sendable {
  case techLead = "Опрацювання ТЛ"
  case qa = "QA-підготовка"
  case returned = "Повернено ТЛ"
  case ready = "Готова до розробки"
}
public struct DevelopmentTask: Codable, Equatable, Sendable {
  public var summary: String?
  public var jiraKey: String?
  public var days: Double
  // Set only from a successful Jira response/read, never from a local preview.
  public var recordedEstimateSeconds: Int?
  public init(
    jiraKey: String? = nil, days: Double, recordedEstimateSeconds: Int? = nil,
    summary: String? = nil
  ) {
    self.summary = summary
    self.jiraKey = jiraKey
    self.days = days
    self.recordedEstimateSeconds = recordedEstimateSeconds
  }
  public var isRecorded: Bool {
    guard let jiraKey,
      jiraKey.range(of: "^[A-Z][A-Z0-9_]*-[1-9][0-9]*$", options: .regularExpression) != nil,
      days.isFinite, days > 0, days < Double(Int.max) / 28_800
    else { return false }
    return recordedEstimateSeconds == Int((days * 28_800).rounded())
  }
}
public enum PreparationError: Error, Equatable {
  case forbidden
  case missingRequirements([String])
  case invalidState
}
public struct Story: Codable, Equatable, Identifiable, Sendable {
  public let requiresJiraEvidence: Bool
  public var id: String
  public var title: String
  public var acceptanceCriteria = ""
  public var definitionOfDone = ""
  public var techLeadName: String?
  public var qaLeadName: String?
  public var questions: String?
  public var answers: String?
  public var noOpenQuestions = false
  public var tlApproved = false
  public var decompositionComplete = false
  public var development: [DevelopmentTask] = []
  public var recordedStoryEstimateSeconds: Int?
  public var explicitQADays: Double?
  public private(set) var buffer = 0.15
  public var qaApproved = false
  public var testPlan = ""
  public var testData = ""
  public var environment = ""
  public var testConditions = ""
  public var qaTask: DevelopmentTask?
  public private(set) var state: PreparationState = .techLead
  public private(set) var returnNotes = ""
  public init(id: String, title: String, requiresJiraEvidence: Bool = true) {
    self.requiresJiraEvidence = requiresJiraEvidence
    self.id = id
    self.title = title
  }
  private enum CodingKeys: String, CodingKey {
    case requiresJiraEvidence, techLeadName, qaLeadName, questions, answers, id, title,
      acceptanceCriteria, definitionOfDone, noOpenQuestions,
      tlApproved,
      decompositionComplete, development, recordedStoryEstimateSeconds, explicitQADays, buffer,
      qaApproved, testPlan, testData, environment, testConditions, qaTask, state, returnNotes
  }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    techLeadName = try values.decodeIfPresent(String.self, forKey: .techLeadName)
    qaLeadName = try values.decodeIfPresent(String.self, forKey: .qaLeadName)
    questions = try values.decodeIfPresent(String.self, forKey: .questions)
    answers = try values.decodeIfPresent(String.self, forKey: .answers)
    requiresJiraEvidence =
      try values.decodeIfPresent(Bool.self, forKey: .requiresJiraEvidence) ?? true
    id = try values.decode(String.self, forKey: .id)
    title = try values.decode(String.self, forKey: .title)
    acceptanceCriteria = try values.decodeIfPresent(String.self, forKey: .acceptanceCriteria) ?? ""
    definitionOfDone = try values.decodeIfPresent(String.self, forKey: .definitionOfDone) ?? ""
    noOpenQuestions = try values.decodeIfPresent(Bool.self, forKey: .noOpenQuestions) ?? false
    tlApproved = try values.decodeIfPresent(Bool.self, forKey: .tlApproved) ?? false
    decompositionComplete =
      try values.decodeIfPresent(Bool.self, forKey: .decompositionComplete) ?? false
    development = try values.decodeIfPresent([DevelopmentTask].self, forKey: .development) ?? []
    recordedStoryEstimateSeconds = try values.decodeIfPresent(
      Int.self, forKey: .recordedStoryEstimateSeconds)
    explicitQADays = try values.decodeIfPresent(Double.self, forKey: .explicitQADays)
    buffer = try values.decodeIfPresent(Double.self, forKey: .buffer) ?? 0.15
    qaApproved = try values.decodeIfPresent(Bool.self, forKey: .qaApproved) ?? false
    testPlan = try values.decodeIfPresent(String.self, forKey: .testPlan) ?? ""
    testData = try values.decodeIfPresent(String.self, forKey: .testData) ?? ""
    environment = try values.decodeIfPresent(String.self, forKey: .environment) ?? ""
    testConditions = try values.decodeIfPresent(String.self, forKey: .testConditions) ?? ""
    qaTask = try values.decodeIfPresent(DevelopmentTask.self, forKey: .qaTask)
    state = try values.decodeIfPresent(PreparationState.self, forKey: .state) ?? .techLead
    returnNotes = try values.decodeIfPresent(String.self, forKey: .returnNotes) ?? ""
  }
  public var developmentDays: Double { development.reduce(0) { $0 + $1.days } }
  public var qaDays: Double { explicitQADays ?? developmentDays * 0.2 }
  public var clientDays: Double { developmentDays + qaDays }
  public var originalEstimateSeconds: Int? {
    guard clientDays.isFinite, clientDays >= 0, clientDays < Double(Int.max) / 28_800 else {
      return nil
    }
    return Int((clientDays * 28_800).rounded())
  }
  public var tlRequirements: [String] {
    var missing: [String] = []
    if !requiresJiraEvidence,
      !(questions ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      (answers ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
      missing.append("Дайте відповідь на відкриті питання")
    }
    if !noOpenQuestions { missing.append("Підтвердьте відсутність відкритих питань") }
    if acceptanceCriteria.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      missing.append("Заповніть AC")
    }
    if requiresJiraEvidence
      && definitionOfDone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
      missing.append("Заповніть DoD")
    }
    if !tlApproved { missing.append("Погодьте AC/DoD для передачі") }
    if !decompositionComplete { missing.append("Завершіть декомпозицію") }
    if development.isEmpty
      || !development.allSatisfy({
        requiresJiraEvidence ? $0.isRecorded : ($0.days.isFinite && $0.days > 0)
      })
    {
      missing.append(
        requiresJiraEvidence
          ? "Створіть та оцініть усі dev-підзадачі в Jira"
          : "Додайте декомпозицію з додатними dev-оцінками")
    }
    let keys = development.compactMap(\.jiraKey)
    if Set(keys).count != keys.count { missing.append("Dev-підзадача повторюється в декомпозиції") }
    if let qaKey = qaTask?.jiraKey, keys.contains(qaKey) {
      missing.append("QA-підзадача не може входити до dev-оцінки")
    }
    return missing
  }
  public var qaRequirements: [String] {
    var missing = tlRequirements
    if !qaDays.isFinite || qaDays <= 0 { missing.append("Вкажіть коректну QA-оцінку") }
    if requiresJiraEvidence
      && (recordedStoryEstimateSeconds != originalEstimateSeconds || originalEstimateSeconds == nil)
    {
      missing.append("Запишіть актуальний Original Estimate сторі в Jira")
    }
    if !qaApproved { missing.append("QA має погодити AC/DoD") }
    if [testPlan, testData, environment, testConditions].contains(where: {
      $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }) {
      missing.append("Заповніть усі матеріали тестування")
    }
    let expectedQA = DevelopmentTask(
      jiraKey: qaTask?.jiraKey, days: qaDays,
      recordedEstimateSeconds: qaTask?.recordedEstimateSeconds)
    if requiresJiraEvidence && (qaTask?.isRecorded != true || !expectedQA.isRecorded) {
      missing.append("Створіть QA-підзадачу з актуальною оцінкою в Jira")
    }
    return missing
  }
  public mutating func handoff(role: Role, canEdit: Bool) throws {
    guard role == .techLead, canEdit else { throw PreparationError.forbidden }
    guard state == .techLead || state == .returned else { throw PreparationError.invalidState }
    guard tlRequirements.isEmpty else { throw PreparationError.missingRequirements(tlRequirements) }
    qaApproved = false
    state = .qa
  }
  public mutating func returnToTL(notes: String, role: Role, canEdit: Bool) throws {
    guard role == .qaLead, canEdit else { throw PreparationError.forbidden }
    guard state == .qa else { throw PreparationError.invalidState }
    guard !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw PreparationError.missingRequirements(["Додайте зауваження"])
    }
    returnNotes = notes
    tlApproved = false
    qaApproved = false
    noOpenQuestions = false
    state = .returned
  }
  public mutating func confirmReady(role: Role, canEdit: Bool) throws {
    guard role == .qaLead, canEdit else { throw PreparationError.forbidden }
    guard state == .qa else { throw PreparationError.invalidState }
    guard qaRequirements.isEmpty else { throw PreparationError.missingRequirements(qaRequirements) }
    state = .ready
  }
  public mutating func setBuffer(_ value: Double, role: Role, canEdit: Bool) throws {
    guard [.coordinator, .techLead].contains(role), canEdit else {
      throw PreparationError.forbidden
    }
    guard value.isFinite, value >= 0, value <= 1 else {
      throw PreparationError.missingRequirements(["Буфер має бути від 0 до 100%"])
    }
    buffer = value
  }
  public mutating func reopenForEstimation(role: Role) throws {
    guard role == .techLead || role == .coordinator else { throw PreparationError.forbidden }
    state = .techLead
    tlApproved = false
    qaApproved = false
    noOpenQuestions = false
    recordedStoryEstimateSeconds = nil
  }
}
