import CryptoKit
import Foundation

public struct JiraIssueType: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let subtask: Bool
}
private struct IssueTypesPage: Decodable {
  let startAt: Int
  let total: Int
  let issueTypes: [JiraIssueType]
}
public struct JiraVersion: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let archived: Bool
  public let released: Bool
}
extension JiraClient {
  public func subtaskTypes(project: String) async throws -> [JiraIssueType] {
    guard project.range(of: "^[A-Z][A-Z0-9_]*$", options: .regularExpression) != nil else {
      throw JiraError.invalidKey
    }
    var cursor = 0
    var result: [JiraIssueType] = []
    for _ in 0..<100 {
      let page: IssueTypesPage = try await get(
        "/rest/api/3/issue/createmeta/" + project + "/issuetypes",
        query: [
          .init(name: "startAt", value: String(cursor)), .init(name: "maxResults", value: "100"),
        ])
      guard page.startAt == cursor else { throw JiraError.paginationIncomplete }
      result += page.issueTypes
      if cursor + page.issueTypes.count >= page.total { return result.filter(\.subtask) }
      guard !page.issueTypes.isEmpty else { throw JiraError.paginationIncomplete }
      cursor += page.issueTypes.count
    }
    throw JiraError.paginationIncomplete
  }
  public func versions(project: String) async throws -> [JiraVersion] {
    guard project.range(of: "^[A-Z][A-Z0-9_]*$", options: .regularExpression) != nil else {
      throw JiraError.invalidKey
    }
    return try await get("/rest/api/3/project/" + project + "/versions")
  }
}
public enum JiraWriteError: Error, Equatable {
  case forbidden, invalidContent, estimatePrecision, alreadyAttempted, identityChanged
  case stalePreview(String)
  case noCustomerApproval, versionUnavailable
}
public struct JiraWriteOperation: Codable, Equatable, Sendable, Identifiable {
  public let id: UUID
  public let targetKey: String
  public let method: String
  public let path: String
  public let body: JSONValue
  public let expectedUpdated: String
  public let before: JSONValue?
  public var exactJSON: String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return String(decoding: (try? encoder.encode(body)) ?? Data(), as: UTF8.self)
  }
  private init(
    target: JiraIssue, method: String, path: String, body: JSONValue, before: JSONValue? = nil
  ) {
    id = UUID()
    targetKey = target.key
    self.method = method
    self.path =
      target.nativeDeployment == .dataCenter
      ? path.replacingOccurrences(of: "/rest/api/3/", with: "/rest/api/2/") : path
    self.body = body
    expectedUpdated = target.fields.updated
    self.before = before
  }
  fileprivate static func comment(issue: JiraIssue, text: String) -> Self {
    .init(
      target: issue, method: "POST", path: "/rest/api/3/issue/" + issue.key + "/comment",
      body: .object(["body": adf(text)]))
  }
  fileprivate static func estimate(issue: JiraIssue, seconds: Int) -> Self {
    .init(
      target: issue, method: "PUT", path: "/rest/api/3/issue/" + issue.key,
      body: .object([
        "fields": .object([
          "timetracking": .object(["originalEstimate": .string("\(seconds / 60)m")])
        ])
      ]),
      before: issue.fields.timetracking?.originalEstimateSeconds.map { .number(Double($0)) })
  }
  fileprivate static func dates(context: JiraDateEditContext, start: String?, due: String?) -> Self
  {
    .init(
      target: context.issue, method: "PUT", path: "/rest/api/3/issue/" + context.issue.key,
      body: .object([
        "fields": .object([
          context.startField: start.map(JSONValue.string) ?? .null,
          context.dueField: due.map(JSONValue.string) ?? .null,
        ])
      ]),
      before: .object([
        "startField": .string(context.startField), "dueField": .string(context.dueField),
        "start": context.start, "due": context.due,
      ]))
  }
  fileprivate static func transition(context: JiraMetadataEditContext, choice: JiraTransitionChoice)
    -> Self
  {
    .init(
      target: context.issue, method: "POST",
      path: "/rest/api/3/issue/" + context.issue.key + "/transitions",
      body: .object(["transition": .object(["id": .string(choice.id)])]),
      before: .object([
        "metadataKind": .string("status"), "label": .string(context.statusName),
        "nextLabel": .string(choice.to.name),
      ]))
  }
  fileprivate static func assignee(context: JiraMetadataEditContext, user: JiraUser?) -> Self {
    .init(
      target: context.issue, method: "PUT", path: "/rest/api/3/issue/" + context.issue.key,
      body: .object([
        "fields": .object([
          "assignee": user.map {
            .object([
              context.issue.nativeDeployment == .dataCenter ? "name" : "accountId": .string(
                $0.accountId)
            ])
          } ?? .null
        ])
      ]),
      before: .object([
        "metadataKind": .string("assignee"),
        "label": .string(context.assignee["displayName"].string ?? "Не призначено"),
        "nextLabel": .string(user?.displayName ?? "Не призначено"),
      ]))
  }
  fileprivate static func subtask(
    issue: JiraIssue, summary: String, days: Double, type: JiraIssueType
  ) -> Self {
    .init(
      target: issue, method: "POST", path: "/rest/api/3/issue",
      body: .object([
        "fields": .object([
          "project": .object(["id": .string(issue.fields.project.id)]),
          "parent": .object(["key": .string(issue.key)]),
          "issuetype": .object(["id": .string(type.id)]), "summary": .string(summary),
          "timetracking": .object(["originalEstimate": .string("\(Int((days * 480).rounded()))m")]),
        ])
      ]))
  }
  fileprivate static func description(issue: JiraIssue, ac: String, dod: String) throws -> Self {
    let document = try JiraDescription.merging(
      existing: issue.fields.description, acceptanceCriteria: ac, definitionOfDone: dod)
    return .init(
      target: issue, method: "PUT", path: "/rest/api/3/issue/" + issue.key,
      body: .object(["fields": .object(["description": document])]),
      before: issue.fields.description)
  }
  fileprivate static func fixVersion(issue: JiraIssue, version: JiraVersion) -> Self {
    // Add preserves any other Fix Versions already present on the issue.
    .init(
      target: issue, method: "PUT", path: "/rest/api/3/issue/" + issue.key,
      body: .object([
        "update": .object([
          "fixVersions": .array([.object(["add": .object(["id": .string(version.id)])])])
        ])
      ]))
  }
  fileprivate static func paragraph(_ text: String) -> JSONValue {
    .object([
      "type": .string("paragraph"),
      "content": .array([.object(["type": .string("text"), "text": .string(text)])]),
    ])
  }
  fileprivate static func adf(_ text: String) -> JSONValue {
    .object([
      "type": .string("doc"), "version": .number(1),
      "content": .array(
        text.components(separatedBy: "\n").map { line in
          line.isEmpty
            ? .object(["type": .string("paragraph"), "content": .array([])]) : paragraph(line)
        }),
    ])
  }
}
public struct JiraWriteProposal: Codable, Equatable, Sendable, Identifiable {
  public let id: UUID
  public let origin: URL
  public let authorID: String
  public let title: String
  public let operations: [JiraWriteOperation]
  public let createdAt: Date
  public var fingerprint: String {
    SHA256.hash(
      data: Data(
        (origin.absoluteString + authorID
          + operations.map { $0.method + $0.path + $0.exactJSON + $0.expectedUpdated }.joined())
          .utf8)
    ).map { String(format: "%02x", $0) }.joined()
  }
  private init(origin: URL, authorID: String, title: String, operations: [JiraWriteOperation]) {
    id = UUID()
    self.origin = origin
    self.authorID = authorID
    self.title = title
    self.operations = operations
    createdAt = Date()
  }
  public static func transition(
    origin: URL, authorID: String, role: Role, context: JiraMetadataEditContext,
    transitionID: String
  ) throws -> Self {
    guard role != .viewer else { throw JiraWriteError.forbidden }
    guard let choice = context.transitions.first(where: { $0.id == transitionID }),
      !choice.needsAdditionalFields
    else { throw JiraWriteError.invalidContent }
    return .init(
      origin: origin, authorID: authorID, title: "Змінити статус на «\(choice.to.name)»",
      operations: [.transition(context: context, choice: choice)])
  }
  public static func assignee(
    origin: URL, authorID: String, role: Role, context: JiraMetadataEditContext, user: JiraUser?
  ) throws -> Self {
    guard role != .viewer, context.canAssign, user != nil || !context.assigneeRequired else {
      throw JiraWriteError.forbidden
    }
    guard user?.accountId.isEmpty != true else { throw JiraWriteError.invalidContent }
    return .init(
      origin: origin, authorID: authorID, title: "Змінити виконавця",
      operations: [.assignee(context: context, user: user)])
  }
  public static func comment(
    origin: URL, authorID: String, role: Role, issue: JiraIssue, text: String
  ) throws -> Self {
    guard role == .techLead else { throw JiraWriteError.forbidden }
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw JiraWriteError.invalidContent
    }
    return .init(
      origin: origin, authorID: authorID, title: "Опублікувати коментар",
      operations: [.comment(issue: issue, text: text)])
  }
  public static func dates(
    origin: URL, authorID: String, role: Role, context: JiraDateEditContext, start: String?,
    due: String?
  ) throws -> Self {
    guard [.coordinator, .techLead].contains(role) else { throw JiraWriteError.forbidden }
    guard context.startField != context.dueField,
      [context.startField, context.dueField].allSatisfy({
        $0.range(of: "^(customfield_[0-9]+|duedate|startdate)$", options: .regularExpression) != nil
      }),
      [start, due].compactMap({ $0 }).allSatisfy({
        $0.count == 10 && TimelineDates.parse($0) != nil
      })
    else { throw JiraWriteError.invalidContent }
    if let start = TimelineDates.parse(start), let end = TimelineDates.parse(due), end < start {
      throw JiraWriteError.invalidContent
    }
    return .init(
      origin: origin, authorID: authorID, title: "Змінити дати задачі в Jira",
      operations: [.dates(context: context, start: start, due: due)])
  }
  public static func combiningDateChanges(_ proposals: [Self]) throws -> Self {
    guard let first = proposals.first,
      proposals.allSatisfy({ proposal in
        proposal.origin == first.origin && proposal.authorID == first.authorID
          && proposal.operations.allSatisfy {
            $0.method == "PUT" && $0.before?["startField"].string != nil
              && $0.before?["dueField"].string != nil
          }
      })
    else { throw JiraWriteError.invalidContent }
    return .init(
      origin: first.origin, authorID: first.authorID, title: "Update schedule dates",
      operations: proposals.flatMap(\.operations))
  }
  public static func subtask(
    origin: URL, authorID: String, role: Role, issue: JiraIssue, type: JiraIssueType,
    summary: String, days: Double
  ) throws -> Self {
    guard role == .techLead || role == .qaLead else { throw JiraWriteError.forbidden }
    guard type.subtask, !type.id.isEmpty,
      !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      days.isFinite, days > 0, days < Double(Int.max) / 28_800, (days * 480).rounded() > 0
    else { throw JiraWriteError.invalidContent }
    guard abs(days * 480 - (days * 480).rounded()) < 0.000001 else {
      throw JiraWriteError.estimatePrecision
    }
    return .init(
      origin: origin, authorID: authorID, title: "Створити реальну Jira-підзадачу",
      operations: [.subtask(issue: issue, summary: summary, days: days, type: type)])
  }
  public static func estimate(
    origin: URL, authorID: String, role: Role, issue: JiraIssue, days: Double
  ) throws -> Self {
    guard [.techLead, .qaLead].contains(role) else { throw JiraWriteError.forbidden }
    guard days.isFinite, days > 0, days < Double(Int.max) / 28_800, (days * 480).rounded() > 0
    else { throw JiraWriteError.invalidContent }
    guard abs(days * 480 - (days * 480).rounded()) < 0.000001 else {
      throw JiraWriteError.estimatePrecision
    }
    let seconds = Int((days * 480).rounded()) * 60
    return .init(
      origin: origin, authorID: authorID, title: "Записати Original Estimate (8 годин/день)",
      operations: [.estimate(issue: issue, seconds: seconds)])
  }
  public static func description(
    origin: URL, authorID: String, role: Role, issue: JiraIssue, ac: String, dod: String
  ) throws -> Self {
    guard role == .coordinator else { throw JiraWriteError.forbidden }
    guard !ac.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      !dod.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { throw JiraWriteError.invalidContent }
    return try .init(
      origin: origin, authorID: authorID, title: "Додати AC/DoD до опису Jira",
      operations: [.description(issue: issue, ac: ac, dod: dod)])
  }
  public static func fixVersion(
    origin: URL, authorID: String, release: Release, version: JiraVersion, available: [JiraVersion],
    issues: [JiraIssue]
  ) throws -> Self {
    guard release.role(for: authorID) == .coordinator else { throw JiraWriteError.forbidden }
    guard release.isReady, release.isCustomerApproved,
      let material = release.currentClientExport, release.customerApprovalExportID == material.id
    else {
      throw JiraWriteError.noCustomerApproval
    }
    guard available.contains(version), !version.archived else {
      throw JiraWriteError.versionUnavailable
    }
    guard Set(issues.map(\.key)) == Set(release.stories.map(\.id)),
      issues.count == release.stories.count,
      issues.allSatisfy({ $0.fields.project.key == release.projectKey })
    else { throw JiraWriteError.invalidContent }
    return .init(
      origin: origin, authorID: authorID, title: "Додати наявну Fix Version: " + version.name,
      operations: issues.map { .fixVersion(issue: $0, version: version) })
  }
  /// Called only by the explicit confirmation button after showing this immutable proposal.
  public func approve(by user: JiraUser) throws -> JiraWriteApproval {
    guard user.accountId == authorID else { throw JiraWriteError.identityChanged }
    return JiraWriteApproval(proposal: self, approvedAt: Date())
  }
}
public struct JiraWriteApproval: Sendable {
  public let proposal: JiraWriteProposal
  public let approvedAt: Date
  fileprivate init(proposal: JiraWriteProposal, approvedAt: Date) {
    self.proposal = proposal
    self.approvedAt = approvedAt
  }
}
public struct JiraWriteResult: Codable, Sendable, Identifiable {
  public enum Outcome: String, Codable, Sendable { case succeeded, failed, uncertain, notAttempted }
  public let id: UUID
  public let targetKey: String
  public let outcome: Outcome
  public let message: String
  public let createdKey: String?
}
/// One attempt per reviewed proposal, no automatic retries of any mutation.
public actor JiraWriteExecutor {
  private var attempted: Set<UUID> = []
  private let auditStore: JiraWriteAuditStore?
  public init(auditDirectory: URL? = nil) {
    auditStore = auditDirectory.map(JiraWriteAuditStore.init)
  }
  public func execute(_ approval: JiraWriteApproval, client: JiraClient) async throws
    -> [JiraWriteResult]
  {
    let proposal = approval.proposal
    guard !attempted.contains(proposal.id) else { throw JiraWriteError.alreadyAttempted }
    guard client.connection.origin.host == proposal.origin.host,
      client.connection.origin.port == proposal.origin.port
    else { throw JiraWriteError.identityChanged }
    let user = try await client.myself()
    guard user.accountId == proposal.authorID else { throw JiraWriteError.identityChanged }
    // Revalidate before sending any write; stale data requires a new preview and approval.
    for operation in proposal.operations {
      try client.validate(operation.targetKey)
      let issuePath = "/rest/api/" + client.connection.apiVersion + "/issue/" + operation.targetKey
      guard
        (operation.method == "POST"
          && [
            "/rest/api/" + client.connection.apiVersion + "/issue", issuePath + "/comment",
            issuePath + "/transitions",
          ].contains(
            operation.path))
          || (operation.method == "PUT" && operation.path == issuePath)
      else { throw JiraWriteError.invalidContent }
      let current = try await client.issue(operation.targetKey)
      guard current.fields.updated == operation.expectedUpdated else {
        throw JiraWriteError.stalePreview(operation.targetKey)
      }
    }
    // Persist intent before the first mutation. An unfinished entry means "reconcile Jira", never "retry".
    let audit = try auditStore?.begin(proposal)
    attempted.insert(proposal.id)
    var results: [JiraWriteResult] = []
    var stopped = false
    for operation in proposal.operations {
      if stopped {
        results.append(
          .init(
            id: operation.id, targetKey: operation.targetKey, outcome: .notAttempted,
            message: "Не виконувалося після помилки попередньої операції", createdKey: nil))
        continue
      }
      do {
        let latest = try await client.issue(operation.targetKey)
        guard latest.fields.updated == operation.expectedUpdated else {
          results.append(
            .init(
              id: operation.id, targetKey: operation.targetKey, outcome: .notAttempted,
              message: "Jira-дані змінилися під час виконання пакета. Потрібен новий preview.",
              createdKey: nil))
          stopped = true
          continue
        }
      } catch {
        results.append(
          .init(
            id: operation.id, targetKey: operation.targetKey, outcome: .notAttempted,
            message:
              "Не вдалося повторно перевірити Jira перед записом. Ця операція не відправлялась.",
            createdKey: nil))
        stopped = true
        continue
      }
      do {
        var components = URLComponents(
          url: client.connection.origin, resolvingAgainstBaseURL: false)!
        components.path = operation.path
        var request = URLRequest(url: components.url!)
        request.httpMethod = operation.method
        request.httpBody = try JSONEncoder().encode(operation.body)
        request.setValue(client.connection.authorization, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await client.transport.send(request)
        guard [200, 201, 204].contains(response.statusCode) else {
          let uncertain = response.statusCode >= 500 || response.statusCode == 408
          results.append(
            .init(
              id: operation.id, targetKey: operation.targetKey,
              outcome: uncertain ? .uncertain : .failed,
              message: "HTTP \(response.statusCode). Звірте Jira перед новою спробою.",
              createdKey: nil))
          stopped = true
          continue
        }
        struct Created: Decodable { let key: String }
        let createdKey =
          operation.path == "/rest/api/3/issue"
          ? (try? JSONDecoder().decode(Created.self, from: data).key) : nil
        if operation.path == "/rest/api/3/issue", createdKey == nil {
          results.append(
            .init(
              id: operation.id, targetKey: operation.targetKey, outcome: .uncertain,
              message: "Jira відповіла успіхом без ключа. Звірте підзадачі вручну.", createdKey: nil
            ))
          stopped = true
        } else {
          results.append(
            .init(
              id: operation.id, targetKey: operation.targetKey, outcome: .succeeded,
              message: "Jira підтвердила запис", createdKey: createdKey))
        }
      } catch {
        results.append(
          .init(
            id: operation.id, targetKey: operation.targetKey, outcome: .uncertain,
            message:
              "Результат невідомий через помилку мережі. Звірте Jira; автоматичного повтору немає.",
            createdKey: nil))
        stopped = true
      }
    }
    if var entry = audit {
      entry.results = results
      entry.finished = true
      do { try auditStore?.update(entry) } catch {
        results = results.map {
          .init(
            id: $0.id, targetKey: $0.targetKey, outcome: $0.outcome,
            message: $0.message
              + " Журнал результатів не оновлено; збережено початковий намір операції.",
            createdKey: $0.createdKey)
        }
      }
    }
    return results
  }
}
