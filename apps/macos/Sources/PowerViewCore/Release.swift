import Foundation

public struct TeamMember: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  public var name: String
  public var role: Role
  public init(id: String, name: String, role: Role) {
    self.id = id
    self.name = name
    self.role = role
  }
}
public struct ReleaseRevision: Codable, Equatable, Sendable {
  public let number: Int
  public let date: Date
  public let authorID: String
  public let reason: String
  public let stories: [Story]
  public let members: [TeamMember]?
  public let releaseName: String?
  public let teamName: String?
}
public enum ReleaseError: Error, Equatable {
  case forbidden, invalidProject, duplicateKey, wrongProject, unknownMember, releaseNotReady,
    unsupportedFormat, wrongJiraInstance, missingClientExport, staleStory
}
public struct Release: Codable, Equatable, Sendable {
  public let schemaVersion: Int
  public let id: UUID
  public var name: String
  public var teamName: String
  public var workspace: WorkspaceSnapshot?
  public var localPlans: [String: LocalIssuePlan]?
  public var timelineLinks: [TimelineLink]?
  public var timelinePreferences: TimelinePreferences?
  public var workspacePlans: [String: WorkspacePlanState]?
  public var chromeHandoffArchive: JSONValue?
  public var chromeSetupArchive: JSONValue?
  public let projectKey: String
  public private(set) var jiraOrigin: String?
  public private(set) var members: [TeamMember]
  public private(set) var stories: [Story]
  public private(set) var history: [ReleaseRevision]
  private var exportRecords: [ClientExport]?
  public var clientExports: [ClientExport] { exportRecords ?? [] }
  public var currentClientExport: ClientExport? {
    guard isReady else { return nil }
    let current = stories.map { ClientEstimate(issueKey: $0.id, personDays: $0.clientDays) }
    return clientExports.last { $0.estimates == current && $0.isIntact }
  }
  public var isCustomerApproved: Bool {
    guard let material = currentClientExport, customerApprovalRevision != nil else { return false }
    return customerApprovalExportID == material.id
  }
  public private(set) var customerApprovalExportID: UUID?
  public private(set) var customerApprovalRevision: Int?
  public var revision: Int { history.count }
  public var isReady: Bool {
    !stories.isEmpty && stories.allSatisfy { $0.state == .ready && $0.qaRequirements.isEmpty }
  }
  public var clientDays: Double { stories.reduce(0) { $0 + $1.clientDays } }
  public init(name: String, teamName: String, projectKey: String, coordinator: TeamMember) throws {
    guard projectKey.range(of: "^[A-Z][A-Z0-9_]*$", options: .regularExpression) != nil else {
      throw ReleaseError.invalidProject
    }
    guard coordinator.role == .coordinator, !coordinator.id.isEmpty else {
      throw ReleaseError.forbidden
    }
    self.schemaVersion = 1
    self.id = UUID()
    self.name = name
    self.teamName = teamName
    self.projectKey = projectKey
    self.members = [coordinator]
    self.stories = []
    self.history = []
    self.exportRecords = []
  }
  public func role(for memberID: String) -> Role {
    members.first { $0.id == memberID }?.role ?? .viewer
  }
  private func requireCoordinator(_ memberID: String) throws {
    guard role(for: memberID) == .coordinator else { throw ReleaseError.forbidden }
  }
  public mutating func setMember(_ member: TeamMember, actorID: String) throws {
    try requireCoordinator(actorID)
    guard !member.id.isEmpty else { throw ReleaseError.unknownMember }
    // The acting coordinator cannot accidentally remove their own administrative access.
    guard member.id != actorID || member.role == .coordinator else { throw ReleaseError.forbidden }
    checkpoint(author: actorID, reason: "Зміна ролей")
    members.removeAll { $0.id == member.id }
    members.append(member)
  }
  public mutating func add(_ story: Story, actorID: String) throws {
    try requireCoordinator(actorID)
    guard
      story.id.range(
        of: "^" + NSRegularExpression.escapedPattern(for: projectKey) + "-[1-9][0-9]*$",
        options: .regularExpression) != nil
    else { throw ReleaseError.wrongProject }
    guard !stories.contains(where: { $0.id == story.id }) else { throw ReleaseError.duplicateKey }
    checkpoint(author: actorID, reason: "Додано \(story.id)")
    stories.append(story)
  }
  public mutating func importIssue(
    _ issue: JiraIssue, origin: URL, actorID: String, requiresJiraEvidence: Bool = true
  ) throws {
    try requireCoordinator(actorID)
    let normalized = origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard jiraOrigin == nil || jiraOrigin == normalized else {
      throw ReleaseError.wrongJiraInstance
    }
    guard issue.fields.project.key == projectKey else { throw ReleaseError.wrongProject }
    if let index = stories.firstIndex(where: { $0.id == issue.key }) {
      checkpoint(author: actorID, reason: "Завантажено Jira-дані \(issue.key)")
      stories[index].title = issue.fields.summary
    } else {
      try add(
        Story(
          id: issue.key, title: issue.fields.summary, requiresJiraEvidence: requiresJiraEvidence),
        actorID: actorID)
    }
    jiraOrigin = normalized
  }
  public mutating func remove(key: String, actorID: String) throws {
    try requireCoordinator(actorID)
    guard stories.contains(where: { $0.id == key }) else { return }
    checkpoint(author: actorID, reason: "Вилучено \(key)")
    stories.removeAll { $0.id == key }
  }
  /// All preparation edits use this boundary; UI cannot substitute another team role.
  public mutating func updateStory(
    key: String, actorID: String, expectedStory: Story? = nil, coalesceTyping: Bool = false,
    operation: (inout Story, Role) throws -> Void
  ) throws {
    guard let index = stories.firstIndex(where: { $0.id == key }) else {
      throw ReleaseError.wrongProject
    }
    if let expectedStory, stories[index] != expectedStory { throw ReleaseError.staleStory }
    let role = role(for: actorID)
    guard role != .viewer else { throw ReleaseError.forbidden }
    var next = stories[index]
    try operation(&next, role)
    guard next.id == key else { throw ReleaseError.wrongProject }
    // Coordinator owns scope/buffer, TL owns preparation, QA owns only the QA stage.
    switch role {
    case .coordinator:
      var permitted = stories[index]
      try permitted.setBuffer(next.buffer, role: role, canEdit: true)
      guard permitted == next else { throw ReleaseError.forbidden }
    case .techLead:
      var bufferOnly = stories[index]
      try bufferOnly.setBuffer(next.buffer, role: role, canEdit: true)
      if bufferOnly == next { break }
      guard stories[index].state == .techLead || stories[index].state == .returned else {
        throw ReleaseError.forbidden
      }
      let before = stories[index]
      guard [.techLead, .returned, .qa].contains(next.state), !next.qaApproved,
        next.qaLeadName == before.qaLeadName,
        next.explicitQADays == before.explicitQADays, next.qaTask == before.qaTask,
        next.testPlan == before.testPlan, next.testData == before.testData,
        next.environment == before.environment, next.testConditions == before.testConditions
      else { throw ReleaseError.forbidden }
    case .qaLead:
      guard stories[index].state == .qa else { throw ReleaseError.forbidden }
      let before = stories[index]
      guard [.qa, .returned, .ready].contains(next.state), next.title == before.title,
        next.state == .returned
          || (next.noOpenQuestions == before.noOpenQuestions
            && next.tlApproved == before.tlApproved),
        next.acceptanceCriteria == before.acceptanceCriteria,
        next.definitionOfDone == before.definitionOfDone,
        next.development == before.development,
        next.techLeadName == before.techLeadName,
        next.questions == before.questions, next.answers == before.answers,
        next.decompositionComplete == before.decompositionComplete,
        next.buffer == before.buffer
      else { throw ReleaseError.forbidden }
    case .viewer: throw ReleaseError.forbidden
    }
    guard next != stories[index] else { return }
    var bufferOnly = stories[index]
    try bufferOnly.setBuffer(next.buffer, role: .coordinator, canEdit: true)
    checkpoint(
      author: actorID, reason: "Змінено \(key)", preservingCustomerApproval: bufferOnly == next,
      coalescing: coalesceTyping && next.state == stories[index].state)
    stories[index] = next
  }
  public mutating func recordClientExport(xlsxData: Data, actorID: String) throws {
    try requireCoordinator(actorID)
    guard isReady else { throw ReleaseError.releaseNotReady }
    guard xlsxData.starts(with: [0x50, 0x4b]) else { throw ReleaseError.unsupportedFormat }
    let record = ClientExport(release: self, xlsxData: xlsxData, authorID: actorID)
    exportRecords = clientExports + [record]
    customerApprovalRevision = nil
    customerApprovalExportID = nil
  }
  public mutating func reopenStory(key: String, actorID: String) throws {
    guard let index = stories.firstIndex(where: { $0.id == key }) else {
      throw ReleaseError.wrongProject
    }
    let role = role(for: actorID)
    var next = stories[index]
    try next.reopenForEstimation(role: role)
    checkpoint(author: actorID, reason: "Повторна оцінка \(key)")
    stories[index] = next
  }
  public mutating func approveCustomer(actorID: String) throws {
    try requireCoordinator(actorID)
    guard isReady else { throw ReleaseError.releaseNotReady }
    guard let material = currentClientExport else { throw ReleaseError.missingClientExport }
    customerApprovalRevision = revision
    customerApprovalExportID = material.id
  }
  private mutating func checkpoint(
    author: String, reason: String, preservingCustomerApproval: Bool = false,
    coalescing: Bool = false
  ) {
    let combine =
      coalescing
      && history.last.map {
        $0.authorID == author && $0.reason == reason && Date().timeIntervalSince($0.date) < 30
          && $0.stories.map(\.state) == stories.map(\.state)
      } == true
    if !combine {
      history.append(
        ReleaseRevision(
          number: revision, date: Date(), authorID: author, reason: reason, stories: stories,
          members: members, releaseName: name, teamName: teamName))
    }
    if !preservingCustomerApproval {
      customerApprovalRevision = nil
      customerApprovalExportID = nil
    }
  }
  public static func decode(_ data: Data) throws -> Release {
    let release = try JSONDecoder().decode(Release.self, from: data)
    guard release.schemaVersion == 1 else { throw ReleaseError.unsupportedFormat }
    guard Set(release.stories.map(\.id)).count == release.stories.count,
      release.stories.allSatisfy({ $0.id.hasPrefix(release.projectKey + "-") })
    else { throw ReleaseError.wrongProject }
    guard release.clientExports.allSatisfy(\.isIntact) else { throw ReleaseError.unsupportedFormat }
    guard Set(release.members.map(\.id)).count == release.members.count,
      Set(release.workspace?.issues.map(\.key) ?? []).count
        == (release.workspace?.issues.count ?? 0)
    else { throw ReleaseError.unsupportedFormat }
    return release
  }

  public mutating func applyWorkspace(_ next: WorkspaceSnapshot) {
    func identity(_ snapshot: WorkspaceSnapshot) -> String {
      (snapshot.origin ?? "imported") + "|" + snapshot.boardID
    }
    if let previous = workspace, identity(previous) != identity(next) {
      var saved = workspacePlans ?? [:]
      saved[identity(previous)] = .init(
        plans: localPlans ?? [:], links: timelineLinks ?? [],
        preferences: timelinePreferences ?? .init())
      workspacePlans = saved
      let restored = saved[identity(next)]
      localPlans = restored?.plans ?? [:]
      timelineLinks = restored?.links ?? []
      timelinePreferences = restored?.preferences ?? .init()
    }
    workspace = next
  }

  public mutating func importChromeSetup(_ setup: ChromeSetup, actorID: String) throws {
    guard role(for: actorID) == .coordinator else { throw ReleaseError.forbidden }
    guard setup.project == projectKey else { throw ReleaseError.wrongProject }
    guard jiraOrigin == nil || jiraOrigin == setup.origin else {
      throw ReleaseError.wrongJiraInstance
    }
    jiraOrigin = setup.origin
    let existing = workspace
    let matching = existing?.boardID == setup.boardID && existing?.origin == setup.origin
    applyWorkspace(
      .init(
        boardID: setup.boardID, boardName: setup.boardName, jql: setup.jql,
        issues: matching ? existing!.issues : [], startField: setup.startField,
        dueField: setup.dueField, origin: setup.origin))
    timelinePreferences = setup.preferences
    chromeSetupArchive = setup.raw
  }
}

public struct WorkspacePlanState: Codable, Equatable, Sendable {
  public let plans: [String: LocalIssuePlan]
  public let links: [TimelineLink]
  public let preferences: TimelinePreferences
}

extension ReleaseError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .forbidden: return "Ця дія недоступна для вашої ролі."
    case .invalidProject: return "Вкажіть коректний ключ Jira-проєкту."
    case .duplicateKey: return "Цю сторі вже додано до релізу."
    case .wrongProject: return "Задача належить іншому Jira-проєкту або має некоректний ключ."
    case .unknownMember: return "Оберіть учасника команди."
    case .releaseNotReady: return "Спочатку завершіть підготовку всіх сторіз."
    case .unsupportedFormat: return "Файл має непідтримуваний формат або пошкоджений вміст."
    case .wrongJiraInstance: return "Цей реліз належить іншому Jira-серверу."
    case .missingClientExport: return "Спочатку експортуйте поточні оцінки для ПМа."
    case .staleStory:
      return
        "Сторі вже змінилася після відкриття форми. Ваші поля збережені приватною чернеткою. Відкрийте сторі знову й перенесіть потрібні зміни через порівняння."
    }
  }
}
