import Foundation

public struct DescriptionReportPeriod: Codable, Equatable, Sendable {
  public let date: String
  public let start: String
  public let end: String
  public let timeZone: String
  public static func build(_ date: String) throws -> Self {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Kyiv")!
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    guard date.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil,
      let day = formatter.date(from: date), formatter.string(from: day) == date,
      let end = calendar.date(bySettingHour: 21, minute: 0, second: 0, of: day),
      let start = calendar.date(byAdding: .day, value: -1, to: end)
    else { throw DescriptionReportError.invalidDate }
    return .init(
      date: date, start: ReportPeriod.iso(start), end: ReportPeriod.iso(end),
      timeZone: "Europe/Kyiv")
  }
  public static func latestDate(now: Date = Date()) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Kyiv")!
    let today = calendar.date(bySettingHour: 21, minute: 0, second: 0, of: now)!
    let selected = now >= today ? now : calendar.date(byAdding: .day, value: -1, to: now)!
    let formatter = DateFormatter()
    formatter.timeZone = calendar.timeZone
    formatter.calendar = calendar
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: selected)
  }
  public var candidateJQL: String {
    let date = ReportPeriod.date(start)!.addingTimeInterval(-86_400)
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd HH:mm"
    return "updated >= \"" + formatter.string(from: date) + "\" ORDER BY key ASC"
  }
}
public enum DescriptionReportError: LocalizedError, Equatable {
  case invalidDate, openPeriod, identity, incomplete, hierarchy
  public var errorDescription: String? {
    switch self {
    case .invalidDate: return "Choose a valid report date."
    case .openPeriod: return "This report period has not ended at 21:00 Kyiv yet."
    case .identity: return "The Jira account changed. Report generation was stopped."
    case .incomplete:
      return "Jira returned incomplete issue history. No complete report was generated."
    case .hierarchy:
      return "The full parent hierarchy is unavailable or cyclic. No complete report was generated."
    }
  }
}
public struct DescriptionReportAuthor: Codable, Equatable, Sendable {
  public let id: String
  public let displayName: String
}
public struct DescriptionReportRow: Codable, Equatable, Identifiable, Sendable {
  public var id: String { issueId }
  public let issueId: String
  public let issueKey: String
  public let summary: String
  public let issueType: String
  public let parentId: String?
  public let depth: Int
  public let contextOnly: Bool
  public let authors: [DescriptionReportAuthor]
  public let changeCount: Int
}
public struct DescriptionReportSnapshot: Codable, Equatable, Sendable {
  public let schemaVersion: Int
  public let id: String
  public let jiraBaseUrl: String
  public let boardId: String
  public let boardName: String
  public let period: DescriptionReportPeriod
  public let generatedAt: String
  public let changedIssueCount: Int
  public let changeCount: Int
  public let rows: [DescriptionReportRow]
}
public enum DescriptionReportBuilder {
  public static func build(
    origin: String, boardID: String, boardName: String, date: String, generatedAt: String,
    issues: [JSONValue], events: [JSONValue]
  ) throws -> DescriptionReportSnapshot {
    let period = try DescriptionReportPeriod.build(date)
    let start = ReportPeriod.date(period.start)!
    let end = ReportPeriod.date(period.end)!
    var byID: [String: JSONValue] = [:]
    var byKey: [String: JSONValue] = [:]
    for issue in issues {
      guard let id = issue["id"].identifier, let key = issue["key"].string else {
        throw DescriptionReportError.incomplete
      }
      byID[id] = issue
      byKey[key] = issue
    }
    var changes: [String: [JSONValue]] = [:]
    var seen: Set<String> = []
    for event in events where event["type"].string == "description-changed" {
      guard let time = event["occurredAt"].string.flatMap(ReportPeriod.date),
        let id = event["id"].string,
        let issueID = event["issueId"].identifier
      else { throw DescriptionReportError.incomplete }
      guard time >= start, time < end, !seen.contains(id) else { continue }
      guard byID[issueID] != nil else { throw DescriptionReportError.incomplete }
      seen.insert(id)
      changes[issueID, default: []].append(event)
    }
    func parent(_ issue: JSONValue) -> JSONValue? {
      issue["parentId"].identifier.flatMap { byID[$0] }
        ?? issue["parentKey"].string.flatMap { byKey[$0] }
    }
    var included: Set<String> = []
    for id in changes.keys {
      var current = byID[id]
      var path: Set<String> = []
      while let issue = current, let id = issue["id"].identifier {
        guard !path.contains(id), path.count <= 50 else { throw DescriptionReportError.hierarchy }
        path.insert(id)
        included.insert(id)
        let next = parent(issue)
        if (issue["parentId"] != .null || issue["parentKey"] != .null) && next == nil {
          throw DescriptionReportError.hierarchy
        }
        current = next
      }
    }
    var children: [String: [JSONValue]] = [:]
    var roots: [JSONValue] = []
    for id in included {
      let issue = byID[id]!
      if let parentID = parent(issue)?["id"].identifier, included.contains(parentID) {
        children[parentID, default: []].append(issue)
      } else {
        roots.append(issue)
      }
    }
    func order(_ a: JSONValue, _ b: JSONValue) -> Bool {
      a["key"].plainText.compare(
        b["key"].plainText, options: .numeric, locale: Locale(identifier: "en_US_POSIX"))
        == .orderedAscending
    }
    var rows: [DescriptionReportRow] = []
    func visit(_ issue: JSONValue, depth: Int) {
      let id = issue["id"].identifier!
      let edits = (changes[id] ?? []).sorted {
        $0["occurredAt"].plainText < $1["occurredAt"].plainText
      }
      var authors: [String: DescriptionReportAuthor] = [:]
      for event in edits {
        let authorID = event["actor"]["id"].identifier ?? "unavailable"
        authors[authorID] = .init(
          id: authorID, displayName: event["actor"]["displayName"].string ?? "Автор недоступний")
      }
      rows.append(
        .init(
          issueId: id, issueKey: issue["key"].plainText,
          summary: issue["summary"].string ?? issue["key"].plainText,
          issueType: issue["issueType"]["name"].string ?? "Unknown",
          parentId: parent(issue)?["id"].identifier,
          depth: depth, contextOnly: edits.isEmpty,
          authors: authors.values.sorted {
            $0.displayName == $1.displayName
              ? $0.id < $1.id
              : $0.displayName.compare($1.displayName, locale: Locale(identifier: "uk"))
                == .orderedAscending
          }, changeCount: edits.count))
      for child in (children[id] ?? []).sorted(by: order) { visit(child, depth: depth + 1) }
    }
    for root in roots.sorted(by: order) { visit(root, depth: 0) }
    return .init(
      schemaVersion: 1, id: "descriptions:" + boardID + ":" + date,
      jiraBaseUrl: origin.trimmingCharacters(in: CharacterSet(charactersIn: "/")), boardId: boardID,
      boardName: boardName, period: period, generatedAt: generatedAt,
      changedIssueCount: changes.count, changeCount: changes.values.reduce(0) { $0 + $1.count },
      rows: rows)
  }
}

extension JiraClient {
  public func descriptionChangeReport(
    boardID: String, date: String, expectedUserID: String, now: Date = Date(),
    progress: @Sendable (String) async -> Void = { _ in }
  ) async throws -> DescriptionReportSnapshot {
    guard boardID.range(of: "^\\d+$", options: .regularExpression) != nil else {
      throw JiraError.invalidKey
    }
    let period = try DescriptionReportPeriod.build(date)
    guard ReportPeriod.date(period.end)! <= now else { throw DescriptionReportError.openPeriod }
    let viewer = try await myself()
    guard viewer.accountId == expectedUserID else { throw DescriptionReportError.identity }
    let board: JSONValue = try await get("/rest/agile/1.0/board/" + boardID)
    var issues: [String: JSONValue] = [:]
    var cursor = 0
    func normalize(_ raw: JSONValue) throws -> JSONValue {
      guard let id = raw["id"].identifier, let key = raw["key"].string else {
        throw DescriptionReportError.incomplete
      }
      var issue: [String: JSONValue] = [
        "id": .string(id), "key": .string(key), "summary": raw["fields"]["summary"],
        "issueType": raw["fields"]["issuetype"],
      ]
      if let parentID = raw["fields"]["parent"]["id"].identifier {
        issue["parentId"] = .string(parentID)
      }
      if let parentKey = raw["fields"]["parent"]["key"].string {
        issue["parentKey"] = .string(parentKey)
      }
      return .object(issue)
    }
    while true {
      try Task.checkCancellation()
      await progress("Reading updated issues…")
      let page: JSONValue = try await get(
        "/rest/agile/1.0/board/" + boardID + "/issue",
        query: [
          .init(name: "startAt", value: String(cursor)), .init(name: "maxResults", value: "100"),
          .init(name: "fields", value: "summary,parent,issuetype,updated"),
          .init(name: "jql", value: period.candidateJQL),
          .init(name: "validateQuery", value: "true"),
        ])
      guard page["startAt"].number == Double(cursor), let total = page["total"].number, total >= 0,
        total.rounded() == total, total <= 5000, case .array(let values) = page["issues"],
        Double(cursor + values.count) <= total
      else { throw DescriptionReportError.incomplete }
      for raw in values {
        let issue = try normalize(raw)
        guard issues[issue["id"].plainText] == nil else { throw DescriptionReportError.incomplete }
        issues[issue["id"].plainText] = issue
      }
      cursor += values.count
      if Double(cursor) >= total { break }
      if values.isEmpty { throw DescriptionReportError.incomplete }
    }
    var events: [JSONValue] = []
    for issue in issues.values.sorted(by: { $0["key"].plainText < $1["key"].plainText }) {
      await progress("Reading description history…")
      let key = issue["key"].plainText
      try validate(key)
      var offset = 0
      var historyComplete = false
      var historyIDs: Set<String> = []
      for _ in 0..<1000 {
        try Task.checkCancellation()
        let page: JSONValue = try await get(
          "/rest/api/3/issue/" + key + "/changelog",
          query: [
            .init(name: "startAt", value: String(offset)), .init(name: "maxResults", value: "100"),
          ])
        guard page["startAt"].number == Double(offset), let total = page["total"].number,
          total >= 0, total.rounded() == total, case .array(let histories) = page["values"],
          Double(offset + histories.count) <= total
        else { throw DescriptionReportError.incomplete }
        for history in histories {
          guard let historyID = history["id"].identifier,
            let time = history["created"].string.flatMap(ReportPeriod.date),
            case .array(let items) = history["items"]
          else { throw DescriptionReportError.incomplete }
          guard !historyIDs.contains(historyID) else { throw DescriptionReportError.incomplete }
          historyIDs.insert(historyID)
          guard time >= ReportPeriod.date(period.start)!, time < ReportPeriod.date(period.end)!
          else { continue }
          for (index, item) in items.enumerated()
          where item["fieldId"].string == "description"
            || item["field"].plainText.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
              == "description"
          {
            var event: [String: JSONValue] = [
              "id": .string(issue["id"].plainText + ":" + historyID + ":" + String(index)),
              "issueId": issue["id"], "type": .string("description-changed"),
              "occurredAt": history["created"],
            ]
            if let authorID = history["author"]["accountId"].identifier
              ?? history["author"]["key"].identifier
            {
              event["actor"] = .object([
                "id": .string(authorID),
                "displayName": .string(history["author"]["displayName"].string ?? authorID),
              ])
            }
            events.append(.object(event))
          }
        }
        offset += histories.count
        if Double(offset) >= total {
          historyComplete = true
          break
        }
        if histories.isEmpty || offset >= 100000 { throw DescriptionReportError.incomplete }
      }
      guard historyComplete else { throw DescriptionReportError.incomplete }
    }
    var pending = events.compactMap { issues[$0["issueId"].plainText] }
    var checked: Set<String> = []
    while !pending.isEmpty {
      try Task.checkCancellation()
      let issue = pending.removeFirst()
      let id = issue["id"].plainText
      if checked.contains(id) { continue }
      checked.insert(id)
      guard checked.count <= 5500 else { throw DescriptionReportError.hierarchy }
      guard let reference = issue["parentKey"].string ?? issue["parentId"].identifier else {
        continue
      }
      let parent: JSONValue
      if let known = issues.values.first(where: {
        $0["id"].identifier == issue["parentId"].identifier && issue["parentId"] != .null
          || $0["key"].string == issue["parentKey"].string && issue["parentKey"] != .null
      }) {
        parent = known
      } else {
        guard
          reference.range(
            of: "^(?:[A-Z][A-Z0-9_]*-[1-9][0-9]*|[0-9]+)$", options: .regularExpression) != nil
        else { throw DescriptionReportError.hierarchy }
        let raw: JSONValue = try await get(
          "/rest/api/3/issue/" + reference,
          query: [.init(name: "fields", value: "summary,parent,issuetype,updated")])
        parent = try normalize(raw)
        if let expected = issue["parentId"].identifier, parent["id"].identifier != expected {
          throw DescriptionReportError.hierarchy
        }
        if let expected = issue["parentKey"].string, parent["key"].string != expected {
          throw DescriptionReportError.hierarchy
        }
        issues[parent["id"].plainText] = parent
      }
      pending.append(parent)
    }
    try Task.checkCancellation()
    let current = try await myself()
    guard current.accountId == viewer.accountId else { throw DescriptionReportError.identity }
    return try DescriptionReportBuilder.build(
      origin: connection.origin.absoluteString, boardID: boardID,
      boardName: board["name"].string ?? boardID, date: date, generatedAt: ReportPeriod.iso(now),
      issues: Array(issues.values), events: events)
  }
}
