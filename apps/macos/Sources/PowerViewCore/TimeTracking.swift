import Foundation

public enum TimeTrackingError: Error, LocalizedError, Equatable {
  case invalid(String), identity, conflict, unknownOutcome, unavailable(Int)
  public var errorDescription: String? {
    switch self {
    case .invalid(let message): return message
    case .identity: return "The Jira account changed. Reconnect before continuing."
    case .conflict: return "This record changed. Refresh and reopen the latest version."
    case .unknownOutcome: return "Result unknown. Check Jira before another attempt. This request was not repeated."
    case .unavailable(let status): return "Jira request failed (HTTP \(status))."
    }
  }
}
public enum TimeCalendar {
  public static func profileWarning(zone: String?, days: [String]) -> String? {
    guard let zone, let author = TimeZone(identifier: zone), let kyiv = TimeZone(identifier: "Europe/Kyiv"), !days.isEmpty else { return nil }
    let offsets = days.compactMap { instant($0 + "T12:00:00Z") }.map { (author.secondsFromGMT(for: $0) - kyiv.secondsFromGMT(for: $0)) / 60 }
    guard let low = offsets.min(), let high = offsets.max(), low < -60 || high > 60 else { return nil }
    func label(_ value: Int) -> String { (value < 0 ? "−" : "+") + duration(abs(value) * 60) }
    let difference = low == high ? label(low) : label(low) + " to " + label(high)
    return "Your Jira profile uses \(zone) (\(difference) relative to Europe/Kyiv during this period; expected: ±1h). Worklog dates may differ from Kyiv. Check your time zone in Jira profile settings."
  }
  public static func instant(_ value: String) -> Date? {
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = iso.date(from: value) { return date }
    iso.formatOptions = [.withInternetDateTime]
    if let date = iso.date(from: value) { return date }
    let format = DateFormatter(); format.locale = Locale(identifier: "en_US_POSIX")
    for pattern in ["yyyy-MM-dd'T'HH:mm:ss.SSSZ", "yyyy-MM-dd'T'HH:mm:ssZ"] {
      format.dateFormat = pattern
      if let date = format.date(from: value) { return date }
    }
    return nil
  }
  public static func text(_ date: Date, zone: String, pattern: String = "yyyy-MM-dd") -> String {
    let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(identifier: zone); formatter.dateFormat = pattern
    return formatter.string(from: date)
  }
  public static func validDay(_ day: String) -> Bool {
    guard day.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil,
      let date = instant(day + "T12:00:00Z") else { return false }
    return text(date, zone: "UTC") == day
  }
  public static func shift(_ day: String, by count: Int) -> String {
    guard let date = instant(day + "T12:00:00Z") else { return day }
    return text(date.addingTimeInterval(Double(count) * 86400), zone: "UTC")
  }
  public static func days(anchor: String, month: Bool) -> [String] {
    guard validDay(anchor), let date = instant(anchor + "T12:00:00Z") else { return [] }
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let start = month ? String(anchor.prefix(7)) + "-01" : shift(anchor, by: -((calendar.component(.weekday, from: date) + 5) % 7))
    let count = month ? calendar.range(of: .day, in: .month, for: date)!.count : 7
    return (0..<count).map { shift(start, by: $0) }
  }
  public static func adjacent(_ anchor: String, month: Bool, direction: Int) -> String {
    if !month { return shift(anchor, by: direction * 7) }
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard let date = instant(String(anchor.prefix(7)) + "-01T12:00:00Z"),
      let next = calendar.date(byAdding: .month, value: direction, to: date) else { return anchor }
    return text(next, zone: "UTC")
  }
  public static func localChoices(day: String, clock: String, zone: String) -> [String] {
    guard validDay(day), clock.range(of: "^([01]\\d|2[0-3]):[0-5]\\d$", options: .regularExpression) != nil,
      let naive = instant(day + "T" + clock + ":00Z"), let timeZone = TimeZone(identifier: zone) else { return [] }
    let offsets = Set(stride(from: -36, through: 36, by: 6).map { timeZone.secondsFromGMT(for: naive.addingTimeInterval(Double($0) * 3600)) })
    return offsets.map { naive.addingTimeInterval(-Double($0)) }.filter {
      text($0, zone: zone) == day && text($0, zone: zone, pattern: "HH:mm") == clock
    }.sorted().map { ReportPeriod.iso($0) }
  }
  public static func parseDuration(_ text: String) -> Int? {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    func parts(_ pattern: String) -> [String]? {
      guard let regex = try? NSRegularExpression(pattern: pattern), let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) else { return nil }
      return (1..<match.numberOfRanges).map { Range(match.range(at: $0), in: value).map { String(value[$0]) } ?? "" }
    }
    let seconds: Double
    if let clock = parts("^(\\d+):([0-5]\\d)$") { seconds = (Double(clock[0]) ?? .infinity) * 3600 + (Double(clock[1]) ?? 0) * 60 }
    else if let units = parts("^(?:(\\d+)h(?:\\s+|$))?(?:(\\d+)m)?$"), units.contains(where: { !$0.isEmpty }) {
      seconds = (Double(units[0]) ?? 0) * 3600 + (Double(units[1]) ?? 0) * 60
    } else { return nil }
    return seconds > 0 && seconds <= 2_147_483_647 ? Int(seconds) : nil
  }
  public static func duration(_ seconds: Int) -> String {
    [seconds / 3600 > 0 ? "\(seconds / 3600)h" : "", seconds % 3600 / 60 > 0 ? "\(seconds % 3600 / 60)m" : "", seconds % 60 > 0 ? "\(seconds % 60)s" : ""].filter { !$0.isEmpty }.joined(separator: " ").nilIfEmpty ?? "0m"
  }
  public static func parseHours(_ input: String) -> Int? {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.range(of: "^\\d+(?:[.,]\\d+)?$", options: .regularExpression) != nil else { return parseDuration(text) }
    guard let hours = Double(text.replacingOccurrences(of: ",", with: ".")) else { return nil }
    let seconds = (hours * 3600).rounded()
    return seconds.isFinite && seconds >= 1 && seconds <= 2_147_483_647 ? Int(seconds) : nil
  }
  public static func inlineText(_ seconds: Int) -> String {
    let text = String((Double(seconds) / 36).rounded() / 100)
    return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
  }
  public static func filterJQL(_ value: String) -> String {
    var quote: Character?; var escaped = false
    for index in value.indices {
      let character = value[index]
      if escaped { escaped = false; continue }
      if character == "\\" { escaped = true; continue }
      if let current = quote { if character == current { quote = nil }; continue }
      if character == "\"" || character == "'" { quote = character; continue }
      if (index == value.startIndex || value[value.index(before: index)].isWhitespace), value[index...].range(of: "^order\\s+by\\b", options: [.regularExpression, .caseInsensitive]) != nil { return String(value[..<index]).trimmingCharacters(in: .whitespacesAndNewlines) }
    }
    return value.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}
private extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }
public struct TimeIssue: Identifiable, Codable, Hashable, Sendable {
  public var id: String; public var key: String; public var summary: String; public var projectID: String
  public var projectKey: String; public var parentKey: String?; public var assigneeID: String?; public var hierarchy: Int
  public var typeName: String?
  public init(raw: JSONValue) throws {
    guard let id = raw["id"].identifier, id.range(of: "^\\d{1,32}$", options: .regularExpression) != nil,
      let key = raw["key"].string, key.range(of: "^[A-Z][A-Z0-9_]*-\\d+$", options: .regularExpression) != nil,
      let summary = raw["fields"]["summary"].string, let project = raw["fields"]["project"]["id"].identifier,
      project.range(of: "^\\d{1,32}$", options: .regularExpression) != nil else { throw JiraError.unexpectedResponse }
    self.id = id; self.key = key; self.summary = summary; projectID = project
    projectKey = raw["fields"]["project"]["key"].plainText
    parentKey = raw["fields"]["parent"]["key"].string
    assigneeID = raw["fields"]["assignee"]["accountId"].string
    typeName = raw["fields"]["issuetype"]["name"].string
    hierarchy = Int(raw["fields"]["issuetype"]["hierarchyLevel"].number ?? (raw["fields"]["issuetype"]["subtask"].boolean ? -1 : 0))
  }
}
public struct TimeWorklog: Identifiable, Codable, Hashable, Sendable {
  public var id: String; public var issueID: String; public var issueKey: String; public var authorID: String
  public var started: String; public var seconds: Int; public var updated: String; public var comment: JSONValue?
  public var commentText: String { comment?.plainText.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
  public init(raw: JSONValue, issue: TimeIssue) throws {
    guard let id = raw["id"].identifier, id.range(of: "^\\d{1,32}$", options: .regularExpression) != nil,
      let author = raw["author"]["accountId"].string, !author.isEmpty,
      let started = raw["started"].string, TimeCalendar.instant(started) != nil,
      let updated = raw["updated"].string, TimeCalendar.instant(updated) != nil,
      let seconds = raw["timeSpentSeconds"].number, seconds.isFinite, seconds >= 0, seconds.rounded() == seconds,
      seconds <= 9_007_199_254_740_991,
      raw["issueId"] == .null || raw["issueId"].identifier == issue.id else { throw JiraError.unexpectedResponse }
    self.id = id; issueID = issue.id; issueKey = issue.key; authorID = author; self.started = started
    self.seconds = Int(seconds); self.updated = updated; comment = raw["comment"] == .null ? nil : raw["comment"]
  }
}
public struct TimeQuery: Equatable, Sendable {
  public var days: [String]; public var zone: String; public var projects: [String]; public var jql: String
  public init(days: [String], zone: String, projects: [String] = [], jql: String = "") { self.days = days; self.zone = zone; self.projects = projects; self.jql = jql }
  public func validate() throws {
    guard !days.isEmpty, days.count <= 31, days.allSatisfy(TimeCalendar.validDay), TimeZone(identifier: zone) != nil,
      days.enumerated().allSatisfy({ TimeCalendar.shift(days[0], by: $0.offset) == $0.element }),
      projects.allSatisfy({ $0.range(of: "^\\d+$", options: .regularExpression) != nil }), jql.count <= 9000 else { throw TimeTrackingError.invalid("Invalid time period, timezone or filters.") }
  }
  public var scope: String { (projects.isEmpty ? [] : ["project in (" + projects.joined(separator: ",") + ")"]) .appendingOptional(TimeCalendar.filterJQL(jql).nilIfEmpty.map { "(" + $0 + ")" }).joined(separator: " AND ") }
}
private extension Array { func appendingOptional(_ value: Element?) -> [Element] { value.map { self + [$0] } ?? self } }
public struct TimeSnapshot: Sendable {
  public var user: JiraUser? = nil
  public var readIssueIDs: Set<String> = []
  public var failedIssueIDs: Set<String> = []
  public var issues: [TimeIssue]; public var worklogs: [TimeWorklog]; public var warnings: [String]
  public var discoveryJQL: String; public var loadedAt: Date; public var readIssueCount: Int; public var readWorklogCount: Int
  public var complete: Bool { warnings.isEmpty }
  public static let coverageNotice = "Found time: Jira searches only the latest 1,000 worklogs per issue. Older records and records hidden by permissions may be missing. Check a known issue by key."
}
extension JiraClient {
  /// Cloud-only time boundary. Only reads/search are retried; mutations are sent once.
  func timeRequest(_ method: String = "GET", _ path: String, query: [URLQueryItem] = [], body: JSONValue? = nil, read: Bool = true) async throws -> JSONValue {
    guard connection.deployment == .cloud, path.hasPrefix("/rest/") || path.hasPrefix("/gateway/api/"), !path.contains(".."), query.allSatisfy({ $0.name != "token" }) else { throw TimeTrackingError.invalid("Time tracking requires Jira Cloud.") }
    var url = URLComponents(url: connection.origin, resolvingAgainstBaseURL: false)!; url.path = path; url.queryItems = query.isEmpty ? nil : query
    var request = URLRequest(url: url.url!); request.httpMethod = method
    request.setValue(connection.authorization, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    for attempt in 0...2 {
      try Task.checkCancellation()
      do {
        let (data, response) = try await transport.send(request)
        guard response.url?.host == connection.origin.host, response.url?.scheme == "https" else { throw JiraError.unexpectedResponse }
        if read && attempt < 2 && [429, 502, 503, 504].contains(response.statusCode) {
          let delay = min(60, max(0, Double(response.value(forHTTPHeaderField: "Retry-After") ?? "") ?? Double(attempt + 1)))
          try await Task.sleep(for: .seconds(delay)); continue
        }
        guard (200..<300).contains(response.statusCode) else { throw TimeTrackingError.unavailable(response.statusCode) }
        return data.isEmpty ? .null : try JSONDecoder().decode(JSONValue.self, from: data)
      } catch let error as URLError where read && attempt < 2 && error.code != .cancelled {
        try await Task.sleep(for: .milliseconds(250 * (attempt + 1)))
      }
    }
    throw JiraError.unexpectedResponse
  }
  public func timeUser() async throws -> JiraUser { try JSONDecoder().decode(JiraUser.self, from: JSONEncoder().encode(try await timeRequest("GET", "/rest/api/3/myself"))) }
  public func verifyTimeUser(_ account: String) async throws {
    guard !account.isEmpty, try await timeUser().accountId == account else { throw TimeTrackingError.identity }
  }
  public func timeSearch(_ jql: String, detailed: Bool = false) async throws -> [TimeIssue] {
    guard jql.count <= 10000 else { throw TimeTrackingError.invalid("Search is too long.") }
    var result: [String: TimeIssue] = [:]; var tokens = Set<String>(); var token: String?
    for _ in 0..<1000 {
      var body: [String: JSONValue] = ["jql": .string(jql), "fields": .array((detailed ? ["summary", "project", "issuetype", "assignee", "parent"] : ["summary", "project"]).map(JSONValue.string)), "maxResults": .number(100)]
      if let token { body["nextPageToken"] = .string(token) }
      let page = try await timeRequest("POST", "/rest/api/3/search/jql", body: .object(body))
      guard case .array(let values) = page["issues"] else { throw JiraError.unexpectedResponse }
      for value in values { let issue = try TimeIssue(raw: value); result[issue.id] = issue }
      let next = page["nextPageToken"].string
      if page["isLast"].boolean || (page["isLast"] == .null && next == nil) { return result.values.sorted { $0.key.localizedStandardCompare($1.key) == .orderedAscending } }
      guard !values.isEmpty, let next, !next.isEmpty, tokens.insert(next).inserted else { throw JiraError.paginationIncomplete }
      token = next
    }
    throw JiraError.paginationIncomplete
  }
  public func timeIssue(_ key: String) async throws -> TimeIssue {
    try validate(key)
    let issue = try TimeIssue(raw: await timeRequest("GET", "/rest/api/3/issue/" + key, query: [.init(name: "fields", value: "summary,project,issuetype,assignee,parent")]))
    guard issue.key == key else { throw JiraError.unexpectedResponse }; return issue
  }
  public func timeWorklogs(_ issue: TimeIssue) async throws -> [TimeWorklog] {
    try validate(issue.key); var start = 0; var logs: [String: TimeWorklog] = [:]
    for _ in 0..<10000 {
      let page = try await timeRequest("GET", "/rest/api/3/issue/" + issue.key + "/worklog", query: [.init(name: "startAt", value: String(start)), .init(name: "maxResults", value: "100")])
      guard page["startAt"].number == Double(start), let count = page["total"].number, count >= 0, count.rounded() == count, case .array(let values) = page["worklogs"], !values.isEmpty || Double(start) >= count else { throw JiraError.paginationIncomplete }
      for value in values {
        let log = try TimeWorklog(raw: value, issue: issue)
        guard logs[log.id] == nil else { throw JiraError.paginationIncomplete }; logs[log.id] = log
      }
      start += values.count
      if Double(start) >= count { return logs.values.sorted { $0.started < $1.started } }
    }
    throw JiraError.paginationIncomplete
  }
  public func timeWorklog(_ issue: TimeIssue, id: String) async throws -> TimeWorklog {
    try validate(issue.key); guard id.range(of: "^\\d{1,32}$", options: .regularExpression) != nil else { throw JiraError.invalidKey }
    let log = try TimeWorklog(raw: await timeRequest("GET", "/rest/api/3/issue/" + issue.key + "/worklog/" + id), issue: issue)
    guard log.id == id else { throw JiraError.unexpectedResponse }; return log
  }
  public func saveTime(_ issue: TimeIssue, started: String, seconds: Int, comment: String?, expectedUser: String, original: TimeWorklog? = nil) async throws -> TimeWorklog {
    try validate(issue.key)
    guard TimeCalendar.instant(started) != nil, seconds > 0, seconds <= 2_147_483_647, (comment?.utf8.count ?? 0) <= 32000 else { throw TimeTrackingError.invalid("Enter a valid start time and duration.") }
    try await verifyTimeUser(expectedUser)
    if let original { try await checkTimeVersion(issue, original: original, user: expectedUser) }
    var body: [String: JSONValue] = ["started": .string(original?.started == started ? started : TimeCalendar.text(TimeCalendar.instant(started)!, zone: "UTC", pattern: "yyyy-MM-dd'T'HH:mm:ss.SSSZ")), "timeSpentSeconds": .number(Double(seconds))]
    if let comment { body["comment"] = .object(["type": .string("doc"), "version": .number(1), "content": .array(comment.components(separatedBy: "\n").map { line in .object(["type": .string("paragraph"), "content": .array(line.isEmpty ? [] : [.object(["type": .string("text"), "text": .string(line)])])]) })]) }
    do {
      let result = try await timeRequest(original == nil ? "POST" : "PUT", "/rest/api/3/issue/" + issue.key + "/worklog" + (original.map { "/" + $0.id } ?? ""), query: [.init(name: "adjustEstimate", value: "leave")], body: .object(body), read: false)
      let saved = try TimeWorklog(raw: result, issue: issue)
      guard saved.authorID == expectedUser, original == nil || saved.id == original?.id else { throw JiraError.unexpectedResponse }
      return saved
    } catch let error as TimeTrackingError { if case .unavailable(let status) = error, [400,401,403,404,409,422,429].contains(status) { throw error }; throw TimeTrackingError.unknownOutcome }
      catch { throw TimeTrackingError.unknownOutcome }
  }
  private func checkTimeVersion(_ issue: TimeIssue, original: TimeWorklog, user: String) async throws {
    guard original.issueID == issue.id, original.issueKey == issue.key, original.authorID == user else { throw TimeTrackingError.identity }
    let current = try await timeWorklog(issue, id: original.id)
    guard current.authorID == user else { throw TimeTrackingError.identity }
    guard current == original else { throw TimeTrackingError.conflict }
  }
  public func deleteTime(_ issue: TimeIssue, original: TimeWorklog, expectedUser: String) async throws {
    try await verifyTimeUser(expectedUser); try await checkTimeVersion(issue, original: original, user: expectedUser)
    do { _ = try await timeRequest("DELETE", "/rest/api/3/issue/" + issue.key + "/worklog/" + original.id, query: [.init(name: "adjustEstimate", value: "leave")], read: false) }
    catch let error as TimeTrackingError { if case .unavailable(let status) = error, [400,401,403,404,409,422,429].contains(status) { throw error }; throw TimeTrackingError.unknownOutcome }
    catch { throw TimeTrackingError.unknownOutcome }
  }
  public func loadTime(_ query: TimeQuery, viewer: String, authors: [String]? = nil, known: [TimeIssue] = [], progress: @Sendable (String) async -> Void = { _ in }) async throws -> TimeSnapshot {
    try query.validate(); let user = try await timeUser(); guard user.accountId == viewer else { throw TimeTrackingError.identity }
    var clauses: [String] = []
    if let authors {
      guard !authors.isEmpty, authors.allSatisfy({ !$0.isEmpty && $0.count <= 255 && !$0.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) }) else { throw TimeTrackingError.identity }
      clauses = []
    }
    let authorIDs = authors ?? [viewer]
    var issues: [String: TimeIssue] = [:]; var discoveries: [String] = []
    for start in stride(from: 0, to: authorIDs.count, by: 25) {
      let batch = Array(authorIDs[start..<min(start + 25, authorIDs.count)])
      clauses = [authors == nil ? "worklogAuthor = currentUser()" : "worklogAuthor in (" + batch.map { "\"" + $0.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }.joined(separator: ", ") + ")"]
      if authors != nil || user.timeZone.flatMap(TimeZone.init(identifier:)) != nil {
        clauses += ["worklogDate >= \"" + TimeCalendar.shift(query.days.first!, by: -2) + "\"", "worklogDate < \"" + TimeCalendar.shift(query.days.last!, by: 3) + "\""]
      }
      if !query.scope.isEmpty { clauses.append(query.scope) }
      let jql = clauses.joined(separator: " AND "); discoveries.append(jql)
      for issue in try await timeSearch(jql) { issues[issue.id] = issue }
    }
    let permitted = query.scope.isEmpty || known.isEmpty ? known : try await timeSearch("id in (" + known.map(\.id).joined(separator: ",") + ") AND " + query.scope)
    for issue in permitted { issues[issue.id] = issue }
    let ordered = issues.values.sorted { $0.key.localizedStandardCompare($1.key) == .orderedAscending }
    var selected: [String: TimeWorklog] = [:]; var warnings: [String] = []; var readIssues = 0; var readLogs = 0
    var readIDs = Set<String>(); var failedIDs = Set<String>()
    for base in stride(from: 0, to: ordered.count, by: 4) {
      let batch = Array(ordered[base..<min(base + 4, ordered.count)])
      let results = try await withThrowingTaskGroup(of: (TimeIssue, [TimeWorklog]?, String?).self) { group in
        for issue in batch { group.addTask {
          do { return (issue, try await timeWorklogs(issue), nil) }
          catch is CancellationError { throw CancellationError() }
          catch let error as TimeTrackingError { if case .unavailable(let code) = error, code == 401 { throw error }; return (issue, nil, error.localizedDescription) }
          catch { return (issue, nil, error.localizedDescription) }
        } }
        var values: [(TimeIssue, [TimeWorklog]?, String?)] = []; for try await value in group { values.append(value) }; return values
      }
      for (issue, logs, error) in results {
        if let logs { readIssues += 1; readLogs += logs.count; readIDs.insert(issue.id)
          for log in logs where authorIDs.contains(log.authorID) {
            guard let date = TimeCalendar.instant(log.started), query.days.contains(TimeCalendar.text(date, zone: query.zone)) else { continue }
            if let previous = selected[log.id], previous != log { throw TimeTrackingError.invalid("Conflicting copies of a worklog. Refresh the period.") }
            selected[log.id] = log
          }
        } else { failedIDs.insert(issue.id); warnings.append(issue.key + ": " + (error ?? "Worklogs unavailable")) }
      }
      await progress("Reading worklogs: \(min(base + 4, ordered.count)) / \(ordered.count) issues")
    }
    try await verifyTimeUser(viewer); try Task.checkCancellation()
    return TimeSnapshot(user: user, readIssueIDs: readIDs, failedIssueIDs: failedIDs, issues: ordered, worklogs: selected.values.sorted { $0.started < $1.started }, warnings: warnings, discoveryJQL: discoveries.joined(separator: "\n"), loadedAt: Date(), readIssueCount: readIssues, readWorklogCount: readLogs)
  }
  public func timeBoards() async throws -> [JiraBoardChoice] {
    var start = 0; var result: [String: JiraBoardChoice] = [:]
    for _ in 0..<1000 {
      let page = try await timeRequest("GET", "/rest/agile/1.0/board", query: [.init(name: "startAt", value: String(start)), .init(name: "maxResults", value: "100")])
      guard page["startAt"].number == Double(start), case .array(let values) = page["values"], case .bool(let last) = page["isLast"] else { throw JiraError.paginationIncomplete }
      for value in values { guard let id = value["id"].identifier, let name = value["name"].string else { throw JiraError.unexpectedResponse }; result[id] = .init(id: id, name: name, type: value["type"].string ?? "scrum") }
      if last { return result.values.sorted { $0.name < $1.name } }
      guard !values.isEmpty else { throw JiraError.paginationIncomplete }; start += values.count
    }
    throw JiraError.paginationIncomplete
  }
  public func timeBoardIssues(_ id: String) async throws -> [TimeIssue] {
    guard id.range(of: "^\\d+$", options: .regularExpression) != nil else { throw JiraError.invalidKey }
    let config = try await timeRequest("GET", "/rest/agile/1.0/board/" + id + "/configuration")
    guard let filter = config["filter"]["id"].identifier, filter.range(of: "^\\d+$", options: .regularExpression) != nil else { throw JiraError.unexpectedResponse }
    return try await timeSearch("filter = " + filter + " ORDER BY key ASC", detailed: true)
  }
}
