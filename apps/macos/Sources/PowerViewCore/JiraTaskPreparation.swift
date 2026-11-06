import Foundation

public enum JiraTaskError: Error, Equatable {
  case notSubtaskOfStory, missingEstimate, duplicateKey, qaTaskInDevelopment, forbidden
}
extension Story {
  /// Accept read-back evidence, not local preview values. Parent and issue type are checked explicitly.
  public mutating func acceptDevelopmentTasks(
    _ issues: [JiraIssue], excludingQAKey: String?, role: Role
  ) throws {
    guard role == .techLead, [.techLead, .returned].contains(state) else {
      throw JiraTaskError.forbidden
    }
    let tasks = issues.filter { $0.key != excludingQAKey }
    guard Set(tasks.map(\.key)).count == tasks.count else { throw JiraTaskError.duplicateKey }
    let converted = try tasks.map { try verifiedTask($0) }
    guard !converted.contains(where: { $0.jiraKey == qaTask?.jiraKey }) else {
      throw JiraTaskError.qaTaskInDevelopment
    }
    development = converted
  }
  public mutating func acceptQATask(_ issue: JiraIssue, adoptEstimate: Bool, role: Role) throws {
    guard role == .qaLead, state == .qa else { throw JiraTaskError.forbidden }
    guard !development.contains(where: { $0.jiraKey == issue.key }) else {
      throw JiraTaskError.qaTaskInDevelopment
    }
    let task = try verifiedTask(issue)
    if adoptEstimate { explicitQADays = task.days }
    qaTask = task
  }
  public mutating func acceptUpdatedDevelopmentTask(_ issue: JiraIssue, role: Role) throws {
    guard role == .techLead, [.techLead, .returned].contains(state) else {
      throw JiraTaskError.forbidden
    }
    guard issue.key != qaTask?.jiraKey else { throw JiraTaskError.qaTaskInDevelopment }
    let task = try verifiedTask(issue)
    if let index = development.firstIndex(where: { $0.jiraKey == issue.key }) {
      development[index] = task
    } else {
      development.append(task)
    }
  }
  public func verifiedTask(_ issue: JiraIssue) throws -> DevelopmentTask {
    guard issue.fields.parent?.key == id, issue.fields.issuetype?.subtask == true,
      issue.fields.project.key == id.components(separatedBy: "-").first
    else { throw JiraTaskError.notSubtaskOfStory }
    guard let seconds = issue.fields.timetracking?.originalEstimateSeconds, seconds > 0 else {
      throw JiraTaskError.missingEstimate
    }
    return .init(
      jiraKey: issue.key, days: Double(seconds) / 28_800, recordedEstimateSeconds: seconds)
  }
}
extension JiraWriteProposal {
  public static func existingTaskEstimate(
    origin: URL, authorID: String, role: Role, story: Story,
    target: JiraIssue, designatedQAKey: String?, days: Double
  ) throws -> Self {
    guard target.fields.parent?.key == story.id, target.fields.issuetype?.subtask == true,
      target.fields.project.key == story.id.components(separatedBy: "-").first
    else { throw JiraTaskError.notSubtaskOfStory }
    switch role {
    case .techLead:
      guard [.techLead, .returned].contains(story.state), target.key != designatedQAKey,
        target.key != story.qaTask?.jiraKey
      else { throw JiraTaskError.forbidden }
    case .qaLead:
      guard story.state == .qa, target.key == designatedQAKey,
        !story.development.contains(where: { $0.jiraKey == target.key }),
        abs(days - story.qaDays) < 0.0000001
      else { throw JiraTaskError.forbidden }
    default: throw JiraTaskError.forbidden
    }
    return try .estimate(origin: origin, authorID: authorID, role: role, issue: target, days: days)
  }
}
