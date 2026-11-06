import Foundation

public struct WorkspaceIssue: Codable, Equatable, Sendable, Identifiable {
  public let rawSource: JSONValue?
  public let assigneeID: String?
  public let issueTypeName: String?
  public let isSubtask: Bool?
  public let progressPercentage: Double?
  public let progressSource: String?
  public let parentReference: JSONValue?
  public var id: String { key }
  public let key: String
  public let title: String
  public let statusID: String
  public let status: String
  public let category: String
  public let assignee: String?
  public let parentKey: String?
  public let start: String?
  public let due: String?
  public let estimateSeconds: Double?
  public let dependencies: [String]
  public let dependencyKinds: [String: TimelineLinkKind]?
  public init(
    raw: JSONValue, startField: String = "customfield_10015", dueField: String = "duedate",
    hierarchyField: String? = nil
  ) throws {
    guard let key = raw["key"].string,
      key.range(of: "^[A-Z][A-Z0-9_]*-[1-9][0-9]*$", options: .regularExpression) != nil,
      let title = raw["fields"]["summary"].string,
      let status = raw["fields"]["status"]["name"].string
    else { throw JiraError.unexpectedResponse }
    let fields = raw["fields"]
    rawSource = raw
    assigneeID =
      fields["assignee"]["accountId"].string ?? fields["assignee"]["name"].string
      ?? fields["assignee"]["key"].string ?? fields["assignee"]["id"].string
    issueTypeName = fields["issuetype"]["name"].string
    isSubtask =
      fields["issuetype"]["subtask"] == .null ? nil : fields["issuetype"]["subtask"].boolean
    if let total = fields["aggregateprogress"]["total"].number, total > 0,
      let actual = fields["aggregateprogress"]["progress"].number
    {
      progressPercentage = min(100, max(0, actual / total * 100))
      progressSource = "jira-progress"
    } else {
      progressPercentage = fields["normalizedProgress"]["percentage"].number
      progressSource = fields["normalizedProgress"]["source"].string
    }
    let customParent = hierarchyField.map { fields[$0] } ?? .null
    let reference = fields["parent"] != .null ? fields["parent"] : customParent
    parentReference = reference == .null ? nil : reference
    self.key = key
    self.title = title
    statusID =
      fields["status"]["id"].identifier
      ?? status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    self.status = status
    category = fields["status"]["statusCategory"]["key"].string ?? "unknown"
    assignee = fields["assignee"]["displayName"].string
    parentKey =
      fields["parent"]["key"].string ?? customParent["key"].string ?? customParent.string
      ?? fields["epic"]["key"].string
    start = fields[startField].string
    due = fields[dueField].string
    estimateSeconds =
      fields["timetracking"]["originalEstimateSeconds"].number
      ?? fields["timeoriginalestimate"].number
    var kinds: [String: TimelineLinkKind] = [:]
    for link in BlockedMetric.normalizeJiraLinks(fields["issuelinks"]) {
      let semantic = link["semanticType"].string
      if semantic == "is-blocked-by"
        || (["depends-on", "finish-to-finish"].contains(semantic ?? "")
          && link["direction"].string == "outward"),
        let target = link["linkedIssueKey"].string
      {
        kinds[target] = semantic == "finish-to-finish" ? .FF : .FS
      }
    }
    if fields["normalizedDependencyKinds"] != .null {
      kinds = fields["normalizedDependencyKinds"].object.compactMapValues {
        $0.string.flatMap(TimelineLinkKind.init(rawValue:))
      }
    }
    dependencies = kinds.keys.sorted()
    dependencyKinds = kinds

  }
}
public struct WorkspaceSnapshot: Codable, Equatable, Sendable {
  public let fieldMapping: [String: String]?
  public let truncated: Bool?
  public let origin: String?
  public let startField: String?
  public let dueField: String?
  public let boardID: String
  public let boardName: String
  public let jql: String
  public let loadedAt: Date
  public let issues: [WorkspaceIssue]
  public init(
    boardID: String, boardName: String, jql: String, issues: [WorkspaceIssue],
    loadedAt: Date = Date(), startField: String? = nil, dueField: String? = nil,
    origin: String? = nil, fieldMapping: [String: String]? = nil, truncated: Bool? = nil
  ) {
    self.boardID = boardID
    self.fieldMapping = fieldMapping
    self.truncated = truncated
    self.origin = origin?.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    self.boardName = boardName
    self.jql = jql
    self.issues = issues
    self.loadedAt = loadedAt
    self.startField = startField
    self.dueField = dueField
  }
}
public struct StatusDistribution: Identifiable, Equatable, Sendable {
  public var id: String { statusID }
  public let statusID: String
  public let name: String
  public let category: String
  public let count: Int
  public let percentage: Double
  public static func build(_ issues: [WorkspaceIssue]) -> [Self] {
    Dictionary(grouping: issues, by: \.statusID).map { id, entries in
      Self(
        statusID: id, name: entries[0].status, category: entries[0].category,
        count: entries.count, percentage: Double(entries.count) / Double(issues.count) * 100)
    }.sorted { $0.count == $1.count ? $0.name < $1.name : $0.count > $1.count }
  }
}
extension JiraClient {
  /// Enhanced board endpoint uses continuation tokens, never assumes a first page is the board.
  public func loadWorkspace(
    boardID: String, boardName: String, jql: String, startField: String, dueField: String,
    fieldMapping: [String: String] = [:], maxIssues: Int = 5000
  ) async throws -> WorkspaceSnapshot {
    guard (1...5000).contains(maxIssues),
      fieldMapping.values.allSatisfy({
        $0.range(of: "^[A-Za-z][A-Za-z0-9_]*$", options: .regularExpression) != nil
      }), boardID.range(of: "^[0-9]+$", options: .regularExpression) != nil,
      [startField, dueField].allSatisfy({
        $0.isEmpty || $0.range(of: "^[A-Za-z][A-Za-z0-9_]*$", options: .regularExpression) != nil
      })
    else { throw JiraError.invalidKey }
    var token: String?
    var cursor = 0
    var seenTokens: Set<String> = []
    var seenKeys: Set<String> = []
    var issues: [WorkspaceIssue] = []
    for _ in 0..<1000 {
      try Task.checkCancellation()
      var query = [
        URLQueryItem(name: "maxResults", value: String(min(100, maxIssues - issues.count))),
        .init(
          name: "fields",
          value: ([
            "summary", "status", "issuetype", "assignee", "parent", "epic", "issuelinks",
            "timetracking", "timeoriginalestimate", "timespent", "aggregateprogress", "created",
            "updated", "resolutiondate", "sprint", "project",
          ] + [startField, dueField] + fieldMapping.values.sorted()).filter { !$0.isEmpty }.reduce(
            into: [String]()
          ) { if !$0.contains($1) { $0.append($1) } }.joined(separator: ",")
        ),
      ]
      if !jql.isEmpty { query.append(.init(name: "jql", value: jql)) }
      if connection.deployment == .dataCenter {
        query.append(.init(name: "startAt", value: String(cursor)))
      } else if let token {
        query.append(.init(name: "nextPageToken", value: token))
      }
      let path =
        connection.deployment == .dataCenter
        ? "/rest/agile/1.0/board/\(boardID)/issue" : "/rest/software/1.0/board/\(boardID)/issue"
      let page: JSONValue = try await get(path, query: query)
      guard case .array(let values) = page["issues"] else { throw JiraError.unexpectedResponse }
      let remaining = maxIssues - issues.count
      for raw in values.prefix(remaining) {
        let issue = try WorkspaceIssue(
          raw: raw, startField: startField, dueField: dueField,
          hierarchyField: fieldMapping["hierarchyFieldId"])
        guard seenKeys.insert(issue.key).inserted else { throw JiraError.paginationIncomplete }
        issues.append(issue)
      }
      guard issues.count <= 100_000 else { throw JiraError.paginationIncomplete }
      let finished: Bool
      if connection.deployment == .dataCenter {
        guard page["startAt"].number == Double(cursor), let total = page["total"].number else {
          throw JiraError.paginationIncomplete
        }
        finished = Double(cursor + values.count) >= total
      } else {
        finished = page["isLast"].boolean
      }
      if finished || issues.count >= maxIssues {
        return .init(
          boardID: boardID, boardName: boardName, jql: jql, issues: issues, startField: startField,
          dueField: dueField, origin: connection.origin.absoluteString, fieldMapping: fieldMapping,
          truncated: !finished || values.count > remaining)
      }
      if connection.deployment == .dataCenter {
        guard !values.isEmpty else { throw JiraError.paginationIncomplete }
        cursor += values.count
        continue
      }
      guard let next = page["nextPageToken"].string, !next.isEmpty, seenTokens.insert(next).inserted
      else { throw JiraError.paginationIncomplete }
      token = next
    }
    throw JiraError.paginationIncomplete
  }
}

public struct LocalIssuePlan: Codable, Equatable, Sendable {
  public var start: String?
  public var due: String?
  public var dependencies: [String]
  public init(start: String?, due: String?, dependencies: [String]) {
    self.start = start
    self.due = due
    self.dependencies = dependencies
  }
}
public enum TimelineDates {
  public static func parse(_ value: String?) -> Date? {
    guard let value else { return nil }
    let day = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if day.count != 10 {
      let parser = ISO8601DateFormatter()
      parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      var timestamp = parser.date(from: day)
      if timestamp == nil {
        parser.formatOptions = [.withInternetDateTime]
        timestamp = parser.date(from: day)
      }
      guard let timestamp else { return nil }
      var calendar = Calendar(identifier: .gregorian)
      calendar.timeZone = TimeZone(secondsFromGMT: 0)!
      return calendar.startOfDay(for: timestamp)
    }
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    guard let date = formatter.date(from: day), formatter.string(from: date) == day else {
      return nil
    }
    return date
  }
  public static func string(_ value: Date) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: value)
  }
  public static func dayOffset(_ date: Date, from origin: Date) -> Int {
    Int((date.timeIntervalSince(origin) / 86_400).rounded())
  }
}

public enum LocalPlanValidation {
  public static func validate(
    key: String, plan: LocalIssuePlan, issues: [WorkspaceIssue], plans: [String: LocalIssuePlan]
  ) -> String? {
    let keys = Set(issues.map(\.key))
    guard keys.contains(key), plan.dependencies.allSatisfy({ keys.contains($0) && $0 != key })
    else {
      return "Попередник має бути іншою задачею цього борду."
    }
    for value in [plan.start, plan.due].compactMap({ $0 }) {
      guard value.count == 10, TimelineDates.parse(value) != nil else {
        return "Дата має бути у форматі YYYY-MM-DD."
      }
    }
    if let begin = TimelineDates.parse(plan.start), let end = TimelineDates.parse(plan.due),
      end < begin
    {
      return "Завершення не може бути раніше початку."
    }
    var edges = Dictionary(
      uniqueKeysWithValues: issues.map { ($0.key, plans[$0.key]?.dependencies ?? $0.dependencies) })
    edges[key] = plan.dependencies
    var seen: Set<String> = []
    func reachesEdited(_ next: String) -> Bool {
      if next == key { return true }
      guard seen.insert(next).inserted else { return false }
      return (edges[next] ?? []).contains(where: reachesEdited)
    }
    if plan.dependencies.contains(where: reachesEdited) { return "Залежність створює цикл." }
    return nil
  }
  public static func conflicts(issues: [WorkspaceIssue], plans: [String: LocalIssuePlan])
    -> [String]
  {
    let lookup = Dictionary(uniqueKeysWithValues: issues.map { ($0.key, $0) })
    return issues.flatMap { issue -> [String] in
      let plan =
        plans[issue.key]
        ?? .init(start: issue.start, due: issue.due, dependencies: issue.dependencies)
      guard let start = TimelineDates.parse(plan.start) else { return [] }
      return plan.dependencies.compactMap { key in
        guard let previous = lookup[key],
          let end = TimelineDates.parse(
            (plans[key]
              ?? .init(
                start: previous.start, due: previous.due, dependencies: previous.dependencies)).due),
          end >= start
        else { return nil }
        return "\(issue.key) починається до завершення \(key)."
      }
    }
  }
}
