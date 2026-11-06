import Foundation

public struct NativeReportRequest: Sendable {
  public var type: String
  public var boardID: String
  public var sprintID: String?
  public var localDate: String
  public var jql: String
  public var selectedUserID: String?
  public var completedStatusIDs: [String]
  public var fieldMapping: [String: String]
  public var progressMode: String
  public var language: String
  public var verifiedUserID: String?
  public init(
    type: String, boardID: String, sprintID: String? = nil, localDate: String, jql: String = "",
    selectedUserID: String? = nil, completedStatusIDs: [String],
    progressMode: String = "issue-count", fieldMapping: [String: String] = [:],
    language: String = "uk", verifiedUserID: String? = nil
  ) {
    self.type = type
    self.boardID = boardID
    self.sprintID = sprintID
    self.localDate = localDate
    self.jql = jql
    self.selectedUserID = selectedUserID
    self.completedStatusIDs = completedStatusIDs
    self.progressMode = progressMode
    self.language = language
    self.verifiedUserID = verifiedUserID
    self.fieldMapping = fieldMapping
  }
}
extension JiraClient {
  public func reportConfiguration(boardID: String) async throws -> JSONValue {
    guard boardID.range(of: "^[0-9]+$", options: .regularExpression) != nil else {
      throw JiraError.invalidKey
    }
    return try await get("/rest/agile/1.0/board/" + boardID + "/configuration")
  }
  public func reportStatuses(boardID: String) async throws -> [JSONValue] {
    let config = try await reportConfiguration(boardID: boardID)
    let ids = Set(
      config["columnConfig"]["columns"].array.flatMap {
        $0["statuses"].array.compactMap { $0["id"].identifier }
      })
    let statuses: JSONValue = try await get("/rest/api/3/status")
    var result = statuses.array.filter { ids.contains($0["id"].identifier ?? "") }
    let known = Set(result.compactMap { $0["id"].identifier })
    for id in ids.subtracting(known).sorted() {
      result.append(
        .object([
          "id": .string(id), "name": .string("Unknown status (" + id + ")"),
          "unresolved": .bool(true),
        ]))
    }
    return result
  }
  public func generateReport(
    _ request: NativeReportRequest, cache: JiraReportHistoryCache? = nil,
    forceRefresh: Bool = false,
    progress: @Sendable (String) async -> Void = { _ in }
  ) async throws -> JSONValue {
    if request.type == "board-health" {
      return try await generateBoardHealth(request, progress: progress)
    }
    guard ["daily", "weekly", "sprint"].contains(request.type), !request.completedStatusIDs.isEmpty,
      request.boardID.range(of: "^[0-9]+$", options: .regularExpression) != nil
    else { throw JiraError.invalidKey }
    let generatedAt = ReportPeriod.iso(Date())
    await progress("Завантаження борду")
    let board: JSONValue = try await get("/rest/agile/1.0/board/" + request.boardID)
    let config = try await reportConfiguration(boardID: request.boardID)
    let knownIDs = config["columnConfig"]["columns"].array.flatMap {
      $0["statuses"].array.compactMap { $0["id"].identifier }
    }
    guard request.completedStatusIDs.allSatisfy(knownIDs.contains) else {
      throw JiraError.unexpectedResponse
    }
    let configuredPoints = request.fieldMapping["storyPointsFieldId"]
    let boardPoints = config["estimation"]["field"]["fieldId"].string
    let pointsField =
      configuredPoints ?? (boardPoints?.hasPrefix("customfield_") == true ? boardPoints : nil)
    var sprint: JSONValue?
    let period: ReportPeriod
    var issuePath = "/rest/agile/1.0/board/" + request.boardID + "/issue"
    if request.type == "sprint" {
      guard let id = request.sprintID, id.range(of: "^[0-9]+$", options: .regularExpression) != nil
      else { throw JiraError.invalidKey }
      let loaded: JSONValue = try await get("/rest/agile/1.0/sprint/" + id)
      sprint = loaded
      period = try .sprint(loaded, generatedAt: generatedAt)
      issuePath = "/rest/agile/1.0/board/" + request.boardID + "/sprint/" + id + "/issue"
    } else {
      period = try .build(
        type: request.type, localDate: request.localDate, generatedAt: generatedAt)
    }
    await progress("Завантаження задач")
    var fields =
      "summary,status,assignee,created,resolutiondate,updated,issuetype,project,parent,timetracking,sprint"
    if let pointsField { fields += "," + pointsField }
    if let sprintField = request.fieldMapping["sprintFieldId"] { fields += "," + sprintField }
    let rawIssues = try await reportPages(
      path: issuePath, field: "issues",
      extra: [.init(name: "fields", value: fields), .init(name: "jql", value: request.jql)])
    guard rawIssues.count <= 5000 else { throw JiraError.paginationIncomplete }
    let issues = try rawIssues.map {
      try mapReportIssue(
        $0, pointsField: pointsField, sprintField: request.fieldMapping["sprintFieldId"])
    }
    var candidates = issues
    if request.type == "sprint" {
      let boardIssues = try await reportPages(
        path: "/rest/agile/1.0/board/" + request.boardID + "/issue", field: "issues",
        extra: [.init(name: "fields", value: fields), .init(name: "jql", value: request.jql)])
      let known = Set(issues.compactMap { $0["id"].string })
      candidates += try boardIssues.map {
        try mapReportIssue(
          $0, pointsField: pointsField, sprintField: request.fieldMapping["sprintFieldId"])
      }.filter { !known.contains($0["id"].string ?? "") }
      guard candidates.count < 5000 else { throw JiraError.paginationIncomplete }
    }
    var warnings: [JSONValue] = []
    var changes: [JSONValue] = []
    var logs: [JSONValue] = []
    let mapping: JSONValue = .object([
      "schemaVersion": .number(1), "jiraBaseUrl": .string(connection.origin.absoluteString),
      "boardId": .string(request.boardID),
      "completedStatusIds": .array(request.completedStatusIDs.map(JSONValue.string)),
      "completedStatusNames": .array([]), "updatedAt": .string(generatedAt),
    ])
    let inputs = candidates
    let histories = try await withThrowingTaskGroup(of: (Int, ReportIssueHistory).self) { group in
      var next = 0
      var completed = 0
      var results = [ReportIssueHistory?](repeating: nil, count: inputs.count)
      for index in 0..<min(4, inputs.count) {
        group.addTask {
          (
            index,
            try await fetchReportIssueHistory(
              inputs[index], request: request, period: period, pointsField: pointsField,
              cache: cache, forceRefresh: forceRefresh)
          )
        }
        next += 1
      }
      while let (index, history) = try await group.next() {
        try Task.checkCancellation()
        results[index] = history
        completed += 1
        await progress("Історія та worklog: \(completed)/\(inputs.count)")
        if next < inputs.count {
          let index = next
          next += 1
          group.addTask {
            (
              index,
              try await fetchReportIssueHistory(
                inputs[index], request: request, period: period, pointsField: pointsField,
                cache: cache, forceRefresh: forceRefresh)
            )
          }
        }
      }
      return results.compactMap { $0 }
    }
    for history in histories {
      changes += history.changes
      logs += history.logs
      warnings += history.warnings
    }
    if pointsField == nil && request.progressMode == "story-points" {
      warnings.append(
        .object([
          "code": .string("STORY_POINTS_FIELD_UNAVAILABLE"),
          "message": .string("Story Points не налаштовані для цього борду"),
        ]))
    }
    if request.progressMode == "original-estimate"
      && issues.allSatisfy({ ($0["originalEstimateSeconds"].number ?? 0) <= 0 })
    {
      warnings.append(
        .object([
          "code": .string("TIME_TRACKING_UNAVAILABLE"),
          "message": .string("Original Estimate недоступний"),
        ]))
    }
    // Same event ordering/deduplication as the existing generator.
    var seenEventIDs: Set<String> = []
    changes = changes.filter { seenEventIDs.insert($0["id"].string ?? "").inserted }.sorted {
      ($0["occurredAt"].string ?? "") < ($1["occurredAt"].string ?? "")
    }
    let scope: JSONValue =
      request.selectedUserID.map { .object(["kind": .string("assignee"), "userId": .string($0)]) }
      ?? .object(["kind": .string("team")])
    let input = ReportingInput(
      issues: issues, changes: changes, worklogs: logs, period: period, type: request.type,
      scope: scope, statusMapping: mapping)
    await progress("Розрахунок")
    var result = ReportCalculator.calculate(
      input, progressMode: request.type == "sprint" ? request.progressMode : nil
    ).object
    if var sprintResult = result["sprint"]?.object {
      for (type, field) in [
        ("sprint-added", "addedAfterStart"), ("sprint-removed", "removedAfterStart"),
      ] {
        var order: [String] = []
        var grouped: [String: [JSONValue]] = [:]
        for event in changes
        where event["type"].string == type && period.contains(event["occurredAt"]) {
          let id = event["issueId"].string ?? ""
          if grouped[id] == nil { order.append(id) }
          grouped[id, default: []].append(event)
        }
        sprintResult[field] = .array(
          order.compactMap { id in
            guard let issue = candidates.first(where: { $0["id"].string == id }) else { return nil }
            return .object(["issue": issue, "events": .array(grouped[id]!)])
          })
      }
      result["sprint"] = .object(sprintResult)
    }
    let periodValue = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(period))
    var metadata: [String: JSONValue] = [
      "type": .string(request.type), "boardId": .string(request.boardID),
      "jql": .string(request.jql), "scope": scope, "period": periodValue,
      "progressMode": .string(request.progressMode), "language": .string(request.language),
    ]
    if let id = request.sprintID { metadata["sprintId"] = .string(id) }
    var snapshot: [String: JSONValue] = [
      "schemaVersion": .number(1), "id": .string(UUID().uuidString),
      "generatedAt": .string(generatedAt), "generatorVersion": .string("native-0.1"),
      "jira": .object([
        "baseUrl": .string(connection.origin.absoluteString),
        "deploymentType": .string(connection.deployment.rawValue),
      ]), "request": .object(metadata),
      "board": .object([
        "id": .string(request.boardID), "name": board["name"], "type": board["type"],
        "projectKeys": .array([]),
      ]),
      "statusMapping": mapping, "issues": .array(issues), "changes": .array(changes),
      "worklogs": .array(logs),
      "result": .object(result),
      "completeness": .object([
        "complete": .bool(warnings.isEmpty), "issueCount": .number(Double(issues.count)),
        "truncated": .bool(false), "warnings": .array(warnings),
      ]),
    ]
    let healthIssues: [JSONValue] = rawIssues.map { raw in
      let f = raw["fields"]
      let category = f["status"]["statusCategory"]["key"].string ?? "unknown"
      let normalizedCategory =
        category == "new" ? "to-do" : category == "indeterminate" ? "in-progress" : category
      var value: [String: JSONValue] = [
        "id": .string(raw["id"].identifier ?? ""), "key": raw["key"],
        "status": .object([
          "id": f["status"]["id"], "name": f["status"]["name"],
          "category": .string(normalizedCategory),
        ]),
      ]
      if let pointsField, f[pointsField] != .null { value["storyPoints"] = f[pointsField] }
      if f["assignee"] != .null { value["assignee"] = f["assignee"] }
      if f["resolutiondate"] != .null { value["resolvedAt"] = f["resolutiondate"] }
      let sprints = f["sprint"].array + (f["sprint"].object.isEmpty ? [] : [f["sprint"]])
      value["sprints"] = .array(sprints)
      return .object(value)
    }
    let healthOptions: JSONValue = .object([
      "now": .string(generatedAt), "sprintDataAvailable": .bool(false),
      "completedStatusIds": .array(request.completedStatusIDs.map(JSONValue.string)),
      "preferredBoardId": .string(request.boardID),
    ])
    if request.type != "sprint" {
      snapshot["boardHealth"] = BoardHealthCalculator.board(healthIssues, options: healthOptions)
    }
    if let sprint { snapshot["sprint"] = sprint }
    return .object(snapshot)
  }
  private func reportPages(path: String, field: String, extra: [URLQueryItem] = []) async throws
    -> [JSONValue]
  {
    var result: [JSONValue] = []
    var cursor = 0
    for _ in 0..<1000 {
      try Task.checkCancellation()
      let page: JSONValue = try await get(
        path,
        query: extra + [
          .init(name: "startAt", value: String(cursor)), .init(name: "maxResults", value: "100"),
        ])
      guard let total = page["total"].number, page["startAt"].number == Double(cursor),
        case .array(let entries) = page[field]
      else { throw JiraError.unexpectedResponse }
      result += entries
      guard result.count <= 100_000 else { throw JiraError.paginationIncomplete }
      if Double(cursor + entries.count) >= total { return result }
      guard !entries.isEmpty else { throw JiraError.paginationIncomplete }
      cursor += entries.count
    }
    throw JiraError.paginationIncomplete
  }
  private func mapReportIssue(_ raw: JSONValue, pointsField: String?, sprintField: String? = nil)
    throws -> JSONValue
  {
    guard let id = raw["id"].identifier, let key = raw["key"].string,
      raw["fields"]["status"]["name"].string != nil
    else { throw JiraError.unexpectedResponse }
    try validate(key)
    let f = raw["fields"]
    var status = ["name": f["status"]["name"]]
    if let id = f["status"]["id"].identifier { status["id"] = .string(id) }
    var result: [String: JSONValue] = [
      "id": .string(id), "key": .string(key),
      "browseUrl": .string(
        connection.origin.appendingPathComponent("browse").appendingPathComponent(key)
          .absoluteString),
      "summary": f["summary"],
      "issueType": .object([
        "id": .string(f["issuetype"]["id"].identifier ?? "unknown"), "name": f["issuetype"]["name"],
      ]), "status": .object(status),
      "sprintIds": .array(
        (sprintField == nil ? f["sprint"].array : WorkspaceReportMapping.sprints(f[sprintField!]))
          .compactMap {
            ($0["id"].identifier ?? $0.identifier).map(JSONValue.string)
          }),
    ]
    if let user = reportUser(f["assignee"]) { result["assignee"] = user }
    for (from, to) in [
      ("created", "createdAt"), ("updated", "updatedAt"), ("resolutiondate", "resolvedAt"),
    ] {
      if let value = f[from].string { result[to] = .string(value) }
    }
    for name in ["originalEstimateSeconds", "timeSpentSeconds"] {
      if let number = f["timetracking"][name].number { result[name] = .number(number) }
    }
    if let pointsField, let points = f[pointsField].number {
      result["storyPoints"] = .number(points)
    }
    if let id = f["parent"]["id"].identifier { result["parentId"] = .string(id) }
    if let key = f["parent"]["key"].string { result["parentKey"] = .string(key) }
    return .object(result)
  }
  private struct ReportIssueHistory: Sendable {
    let changes: [JSONValue]
    let logs: [JSONValue]
    let warnings: [JSONValue]
  }
  private func fetchReportIssueHistory(
    _ issue: JSONValue, request: NativeReportRequest, period: ReportPeriod, pointsField: String?,
    cache: JiraReportHistoryCache?, forceRefresh: Bool
  ) async throws -> ReportIssueHistory {
    var changes: [JSONValue] = []
    var logs: [JSONValue] = []
    var warnings: [JSONValue] = []
    try Task.checkCancellation()
    let key = issue["key"].string!
    if period.contains(issue["createdAt"]) {
      changes.append(
        .object([
          "id": .string("created:" + issue["id"].string!), "issueId": issue["id"],
          "issueKey": issue["key"], "type": .string("issue-created"),
          "occurredAt": issue["createdAt"],
        ]))
    }
    do {
      let entries = try await cachedReportHistory(
        issue, request: request, cache: cache, forceRefresh: forceRefresh, kind: "changelog",
        field: "values")
      changes += entries.flatMap {
        mapReportChanges(
          $0, issue: issue, completed: request.completedStatusIDs, pointsField: pointsField,
          sprintID: request.sprintID, sprintField: request.fieldMapping["sprintFieldId"])
      }
    } catch is CancellationError { throw CancellationError() } catch {
      warnings.append(
        .object([
          "code": .string("CHANGELOG_UNAVAILABLE"),
          "message": .string("Історія недоступна: " + key),
          "affectedIssueKeys": .array([.string(key)]),
        ]))
    }
    do {
      let worklogs = try await cachedReportHistory(
        issue, request: request, cache: cache, forceRefresh: forceRefresh, kind: "worklog",
        field: "worklogs")
      for log in worklogs {
        guard let author = reportUser(log["author"]), log["timeSpentSeconds"].number != nil,
          log["started"].string.flatMap(ReportPeriod.date) != nil,
          let id = log["id"].identifier
        else { throw JiraError.unexpectedResponse }
        var value: [String: JSONValue] = [
          "id": .string(id), "issueId": issue["id"], "issueKey": issue["key"], "author": author,
          "startedAt": log["started"], "timeSpentSeconds": log["timeSpentSeconds"],
        ]
        if log["created"] != .null { value["createdAt"] = log["created"] }
        if log["updated"] != .null { value["updatedAt"] = log["updated"] }
        logs.append(.object(value))
      }
    } catch is CancellationError { throw CancellationError() } catch {
      warnings.append(
        .object([
          "code": .string("WORKLOG_UNAVAILABLE"),
          "message": .string("Worklog недоступний: " + key),
          "affectedIssueKeys": .array([.string(key)]),
        ]))
    }
    return .init(changes: changes, logs: logs, warnings: warnings)
  }
  private func cachedReportHistory(
    _ issue: JSONValue, request: NativeReportRequest, cache: JiraReportHistoryCache?,
    forceRefresh: Bool, kind: String, field: String
  ) async throws -> [JSONValue] {
    let origin = connection.origin.absoluteString
    let id = issue["id"].plainText
    let updated = issue["updatedAt"].string
    if !forceRefresh, let cache,
      let entries = await cache.get(
        origin: origin, userID: request.verifiedUserID, issueID: id, updatedAt: updated, kind: kind)
    {
      return entries
    }
    let entries = try await reportPages(
      path: "/rest/api/3/issue/" + issue["key"].plainText + "/" + kind, field: field)
    if kind == "worklog" {
      guard
        entries.allSatisfy({
          reportUser($0["author"]) != nil && $0["timeSpentSeconds"].number != nil
            && $0["started"].string.flatMap(ReportPeriod.date) != nil && $0["id"].identifier != nil
        })
      else { throw JiraError.unexpectedResponse }
    }
    if let cache {
      try? await cache.put(
        entries, origin: origin, userID: request.verifiedUserID, issueID: id, updatedAt: updated,
        kind: kind)
    }
    return entries
  }
  private func reportUser(_ value: JSONValue) -> JSONValue? {
    guard
      let id = value["accountId"].identifier ?? value["key"].identifier ?? value["name"].identifier
        ?? value["displayName"].identifier
    else { return nil }
    return .object(["id": .string(id), "displayName": .string(value["displayName"].string ?? id)])
  }
  private func mapReportChanges(
    _ entry: JSONValue, issue: JSONValue, completed: [String], pointsField: String?,
    sprintID: String?, sprintField: String? = nil
  ) -> [JSONValue] {
    var result: [JSONValue] = []
    for (index, item) in entry["items"].array.enumerated() {
      let field =
        item["field"].string?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
      let type: String
      if field == "status" {
        type = "status-changed"
      } else if field == "assignee" {
        type = "assignee-changed"
      } else if (pointsField != nil && item["fieldId"].string == pointsField)
        || field.contains("story point")
      {
        type = "story-points-changed"
      } else if ["original estimate", "timeoriginalestimate"].contains(field) {
        type = "original-estimate-changed"
      } else if field == "sprint" || (sprintField != nil && item["fieldId"].string == sprintField) {
        type = "sprint-added"
      } else {
        continue
      }
      let id =
        (issue["id"].string ?? "") + ":" + (entry["id"].identifier ?? "") + ":" + String(index)
      var event: [String: JSONValue] = [
        "id": .string(id), "issueId": issue["id"], "issueKey": issue["key"],
        "occurredAt": entry["created"], "type": .string(type),
      ]
      if let actor = reportUser(entry["author"]) { event["actor"] = actor }
      for (from, to) in [("fieldId", "fieldId"), ("fromString", "from"), ("toString", "to")] {
        if item[from] != .null { event[to] = item[from] }
      }
      if type == "sprint-added" {
        guard let sprintID else { continue }
        func sprintIDs(_ string: String?) -> Set<String> {
          Set((string ?? "").split(whereSeparator: { !$0.isNumber }).map(String.init))
        }
        let before = sprintIDs(item["fromString"].string)
        let after = sprintIDs(item["toString"].string)
        if !before.contains(sprintID) && after.contains(sprintID) {
          event["sprintId"] = .string(sprintID)
          result.append(.object(event))
        }
        if before.contains(sprintID) && !after.contains(sprintID) {
          event["id"] = .string(id + ":removed")
          event["type"] = .string("sprint-removed")
          event["sprintId"] = .string(sprintID)
          result.append(.object(event))
        }
      } else {
        result.append(.object(event))
        if type == "status-changed" {
          let before = completed.contains(item["from"].identifier ?? "")
          let after = completed.contains(item["to"].identifier ?? "")
          if before != after {
            event["id"] = .string(id + (after ? ":completed" : ":reopened"))
            event["type"] = .string(after ? "issue-completed" : "issue-reopened")
            result.append(.object(event))
          }
        }
      }
    }
    return result
  }
}
extension JSONValue {
  public var identifier: String? {
    if let string { return string }
    if let number, number.isFinite, number.rounded() == number, abs(number) < Double(Int.max) {
      return String(Int(number))
    }
    return nil
  }
}

extension JiraClient {
  private func generateBoardHealth(
    _ request: NativeReportRequest, progress: @Sendable (String) async -> Void
  ) async throws -> JSONValue {
    guard !request.completedStatusIDs.isEmpty,
      request.boardID.range(of: "^[0-9]+$", options: .regularExpression) != nil
    else { throw JiraError.invalidKey }
    await progress("Завантаження борду")
    let board: JSONValue = try await get("/rest/agile/1.0/board/" + request.boardID)
    let config = try await reportConfiguration(boardID: request.boardID)
    let known = Set(
      config["columnConfig"]["columns"].array.flatMap {
        $0["statuses"].array.compactMap { $0["id"].identifier }
      })
    guard request.completedStatusIDs.allSatisfy(known.contains) else {
      throw JiraError.unexpectedResponse
    }
    let generatedAt = ReportPeriod.iso(Date())
    let configuredPoints = request.fieldMapping["storyPointsFieldId"]
    let boardPoints = config["estimation"]["field"]["fieldId"].string
    let pointsField =
      configuredPoints ?? (boardPoints?.hasPrefix("customfield_") == true ? boardPoints : nil)
    let fields =
      "summary,status,assignee,issuetype,resolutiondate,timetracking,parent,project,issuelinks"
      + (pointsField.map { "," + $0 } ?? "")
    let query: [URLQueryItem] = [
      .init(name: "fields", value: fields), .init(name: "jql", value: request.jql),
    ]
    await progress("Завантаження задач борду")
    let raw = try await reportPages(
      path: "/rest/agile/1.0/board/" + request.boardID + "/issue", field: "issues", extra: query)
    guard raw.count <= 5000 else { throw JiraError.paginationIncomplete }
    var normalized = raw.map { value -> JSONValue in
      let f = value["fields"]
      let category = f["status"]["statusCategory"]["key"].string ?? "unknown"
      var issue: [String: JSONValue] = [
        "id": .string(value["id"].identifier ?? ""), "key": value["key"], "summary": f["summary"],
        "status": .object([
          "id": f["status"]["id"], "name": f["status"]["name"],
          "category": .string(
            category == "new" ? "to-do" : category == "indeterminate" ? "in-progress" : category),
        ]), "sprints": .array([]),
      ]
      issue["issueLinks"] = .array(BlockedMetric.normalizeJiraLinks(f["issuelinks"]))
      if f["assignee"] != .null { issue["assignee"] = f["assignee"] }
      if f["resolutiondate"] != .null { issue["resolvedAt"] = f["resolutiondate"] }
      if let pointsField, f[pointsField] != .null { issue["storyPoints"] = f[pointsField] }
      return .object(issue)
    }
    var warnings: [JSONValue] = []
    var planningAvailable = board["type"].string == "scrum"
    var sprintRecords: [(JSONValue, Set<String>)] = []
    if planningAvailable {
      do {
        let sprints = try await reportSprints(boardID: request.boardID).filter {
          ["active", "future"].contains($0.state)
        }
        for sprint in sprints {
          try Task.checkCancellation()
          await progress("Звірка складу спринту: " + sprint.name)
          let issues = try await reportPages(
            path: "/rest/agile/1.0/board/" + request.boardID + "/sprint/" + sprint.id + "/issue",
            field: "issues", extra: query)
          let ids = Set(issues.compactMap { $0["id"].identifier })
          let record: JSONValue = .object([
            "id": .string(sprint.id), "name": .string(sprint.name), "state": .string(sprint.state),
            "boardId": .string(request.boardID),
          ])
          sprintRecords.append((record, ids))
        }
        normalized = normalized.map { value in
          var issue = value.object
          issue["sprints"] = .array(
            sprintRecords.filter { $0.1.contains(value["id"].string ?? "") }.map(\.0))
          return .object(issue)
        }
      } catch is CancellationError { throw CancellationError() } catch {
        planningAvailable = false
        sprintRecords = []
        warnings.append(
          .object([
            "code": .string("SPRINT_SCOPE_HISTORY_PARTIAL"),
            "message": .string("Склад спринтів недоступний. Планувальні метрики показані як N/A."),
          ]))
      }
    }
    let blockedAvailable = raw.allSatisfy { $0["fields"].object.keys.contains("issuelinks") }
    let blockedIDs = BlockedMetric.calculate(normalized)
    if let user = request.selectedUserID {
      normalized = normalized.filter { $0["assignee"]["accountId"].string == user }
    }
    let options: JSONValue = .object([
      "now": .string(generatedAt), "sprintDataAvailable": .bool(planningAvailable),
      "preferredBoardId": .string(request.boardID),
      "completedStatusIds": .array(request.completedStatusIDs.map(JSONValue.string)),
      "completedStatusNames": .array([]),
    ])
    let health = BoardHealthCalculator.board(normalized, options: options)
    let sprintHealth = sprintRecords.filter { $0.0["state"].string == "active" }.map {
      sprint, ids in
      var value = BoardHealthCalculator.sprint(
        normalized.filter { ids.contains($0["id"].string ?? "") }, sprint: sprint,
        blockedIDs: blockedIDs,
        options: options
      ).object
      value["issueIds"] = .array(ids.sorted().map(JSONValue.string))
      return JSONValue.object(value)
    }
    // Missing issue-link evidence remains unavailable rather than being presented as a proven zero.
    let period: JSONValue = .object([
      "timeZone": .string("Europe/Kyiv"), "start": .string(generatedAt),
      "end": .string(generatedAt), "dataCutoff": .string(generatedAt),
    ])
    let mapping: JSONValue = .object([
      "completedStatusIds": .array(request.completedStatusIDs.map(JSONValue.string)),
      "completedStatusNames": .array([]),
    ])
    return .object([
      "schemaVersion": .number(1), "id": .string(UUID().uuidString),
      "generatedAt": .string(generatedAt), "generatorVersion": .string("native-0.1"),
      "jira": .object([
        "baseUrl": .string(connection.origin.absoluteString),
        "deploymentType": .string(connection.deployment.rawValue),
      ]),
      "request": .object([
        "type": .string("board-health"), "boardId": .string(request.boardID),
        "jql": .string(request.jql), "period": period,
        "scope": request.selectedUserID.map {
          .object(["kind": .string("assignee"), "userId": .string($0)])
        } ?? .object(["kind": .string("team")]),
      ]),
      "board": .object([
        "id": .string(request.boardID), "name": board["name"], "type": board["type"],
      ]), "statusMapping": mapping,
      "issues": .array(
        try raw.map {
          try mapReportIssue(
            $0, pointsField: pointsField, sprintField: request.fieldMapping["sprintFieldId"])
        }),
      "changes": .array([]), "worklogs": .array([]),
      "result": .object([
        "boardHealth": health, "sprintHealth": .array(sprintHealth),
        "blockedAvailable": .bool(blockedAvailable),
        "storyPointsDataAvailable": .bool(pointsField != nil),
      ]),
      "completeness": .object([
        "complete": .bool(warnings.isEmpty), "truncated": .bool(false),
        "issueCount": .number(Double(normalized.count)), "warnings": .array(warnings),
      ]),
    ])
  }
}
