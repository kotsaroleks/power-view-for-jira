import Foundation

public struct TimeTeam: Identifiable, Sendable, Equatable {
  public var id: String; public var name: String; public var organization: String; public var members: [JiraUser] = []; public var warnings: [String] = []
}
extension JiraClient {
  public func myTimeTeams(viewer: String) async throws -> [TimeTeam] {
    try await verifyTimeUser(viewer)
    let tenant = try await timeRequest("POST", "/gateway/api/graphql", body: .object([
      "operationName": .string("PowerViewTenantContext"),
      "query": .string("query PowerViewTenantContext($hostNames: [String!]!) { tenantContexts(hostNames: $hostNames) { cloudId orgId hostName } }"),
      "variables": .object(["hostNames": .array([.string(connection.origin.host!)])])]))
    guard tenant["errors"].array.isEmpty, tenant["data"]["tenantContexts"].array.count == 1,
      let context = tenant["data"]["tenantContexts"].array.first,
      context["hostName"].string == connection.origin.host,
      let org = context["orgId"].string?.replacingOccurrences(of: "ari:cloud:platform::org/", with: ""),
      org.range(of: "^[A-Za-z0-9-]{1,128}$", options: .regularExpression) != nil,
      let site = context["cloudId"].string, UUID(uuidString: site) != nil else { throw TimeTrackingError.invalid("Atlassian did not return the organization for this Jira site.") }
    var result: [String: TimeTeam] = [:]; var cursor: String?; var seen = Set<String>()
    for _ in 0..<1000 {
      let page = try await timeRequest("POST", "/gateway/api/graphql", body: .object([
        "operationName": .string("PowerViewMyTeams"),
        "query": .string("query PowerViewMyTeams($organizationId: ID!, $siteId: String!, $memberId: ID!, $after: String) { team { teamSearchV2(organizationId: $organizationId, siteId: $siteId, filter: { membership: { memberIds: [$memberId] } }, first: 100, after: $after, enablePagination: true) { nodes { team { id displayName organizationId } } pageInfo { hasNextPage endCursor } } } }"),
        "variables": .object(["organizationId": .string("ari:cloud:platform::org/" + org), "siteId": .string(site), "memberId": .string(viewer), "after": cursor.map(JSONValue.string) ?? .null])]))
      let search = page["data"]["team"]["teamSearchV2"]
      guard page["errors"].array.isEmpty, case .array(let nodes) = search["nodes"], case .bool(let hasNext) = search["pageInfo"]["hasNextPage"] else { throw TimeTrackingError.invalid("My teams could not be read from Atlassian.") }
      for node in nodes {
        let team = node["team"]
        guard let id = team["id"].string?.replacingOccurrences(of: "ari:cloud:identity::team/", with: ""), UUID(uuidString: id) != nil,
          let name = team["displayName"].string, !name.isEmpty,
          team["organizationId"] == .null || team["organizationId"].string?.replacingOccurrences(of: "ari:cloud:platform::org/", with: "") == org else { throw JiraError.unexpectedResponse }
        if let previous = result[id], previous.name != name { throw JiraError.unexpectedResponse }
        result[id] = TimeTeam(id: id, name: name, organization: org)
      }
      if !hasNext { try await verifyTimeUser(viewer); return result.values.sorted { $0.name < $1.name } }
      guard !nodes.isEmpty, let next = search["pageInfo"]["endCursor"].string, !next.isEmpty, seen.insert(next).inserted else { throw JiraError.paginationIncomplete }; cursor = next
    }
    throw JiraError.paginationIncomplete
  }
  public func timeTeam(_ summary: TimeTeam, viewer: String) async throws -> TimeTeam {
    guard UUID(uuidString: summary.id) != nil, summary.organization.range(of: "^[A-Za-z0-9-]{1,128}$", options: .regularExpression) != nil else { throw JiraError.invalidKey }
    try await verifyTimeUser(viewer)
    let path = "/gateway/api/public/teams/v1/org/" + summary.organization + "/teams/" + summary.id
    let raw = try await timeRequest("GET", path)
    guard raw["teamId"].string == summary.id, raw["organizationId"].string == summary.organization, raw["displayName"].string != nil else { throw JiraError.unexpectedResponse }
    var ids = Set<String>(); var cursor: String?; var cursors = Set<String>(); var finished = false
    for _ in 0..<1000 {
      var body: [String: JSONValue] = ["first": .number(50)]; if let cursor { body["after"] = .string(cursor) }
      let page = try await timeRequest("POST", path + "/members", body: .object(body))
      guard case .array(let values) = page["results"], case .bool(let hasNext) = page["pageInfo"]["hasNextPage"] else { throw JiraError.unexpectedResponse }
      for value in values { guard let id = value["accountId"].string, !id.isEmpty else { throw JiraError.unexpectedResponse }; ids.insert(id) }
      if !hasNext { finished = true; break }
      guard !values.isEmpty, let next = page["pageInfo"]["endCursor"].string, !next.isEmpty, cursors.insert(next).inserted else { throw JiraError.paginationIncomplete }; cursor = next
    }
    guard finished else { throw JiraError.paginationIncomplete }
    var team = summary; team.members = []; team.warnings = []; team.name = raw["displayName"].plainText
    for batchStart in stride(from: 0, to: ids.count, by: 4) {
      let ordered = ids.sorted(); let batch = Array(ordered[batchStart..<min(batchStart + 4, ids.count)])
      let members = try await withThrowingTaskGroup(of: (JiraUser, String?).self) { group in
        for id in batch { group.addTask {
          do {
            let raw = try await timeRequest("GET", "/rest/api/3/user", query: [.init(name: "accountId", value: id)])
            let user = try JSONDecoder().decode(JiraUser.self, from: JSONEncoder().encode(raw))
            guard user.accountId == id else { throw JiraError.unexpectedResponse }; return (user, nil)
          } catch is CancellationError { throw CancellationError() }
          catch let error as TimeTrackingError where error == .unavailable(401) { throw error }
          catch { return (JiraUser(accountId: id, displayName: id), "Name unavailable for a team member; this person remains included.") }
        } }
        var values: [(JiraUser, String?)] = []; for try await value in group { values.append(value) }; return values
      }
      for (member, warning) in members { team.members.append(member); if let warning { team.warnings.append(warning) } }
    }
    try await verifyTimeUser(viewer); team.members.sort { $0.displayName < $1.displayName }; return team
  }
}
public struct DayOffConfiguration: Decodable, Sendable {
  public var owner: String; public var repo: String; public var branch: String; public var root: String
  fileprivate var token: String
  public init(owner: String, repo: String, branch: String, root: String, token: String) { self.owner = owner; self.repo = repo; self.branch = branch; self.root = root; self.token = token }
}
public struct SharedDayOff: Sendable {
  public var dates: [String: Set<String>] = [:]; public var warnings: [String] = []
  public var complete: Bool { warnings.isEmpty }
}
public actor GitHubTimeCalendar {
  private let config: DayOffConfiguration; private let transport: any JiraTransport
  private var cache: [String: (sha: String, etag: String?, data: JSONValue)] = [:]
  public init(configuration: DayOffConfiguration, transport: any JiraTransport = JiraURLTransport()) throws {
    guard configuration.owner.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
      configuration.repo.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil,
      ![".", ".."].contains(configuration.repo), !configuration.branch.isEmpty, !configuration.token.isEmpty,
      configuration.root.split(separator: "/", omittingEmptySubsequences: false).allSatisfy({ $0.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil }) else { throw TimeTrackingError.invalid("Day Off storage is not configured.") }
    config = configuration; self.transport = transport
  }
  public static func storageKey(_ value: String) -> String { value.utf8.map { String(format: "%02x", $0) }.joined() }
  private func base(_ value: String) throws -> String {
    guard let url = URL(string: value), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { throw JiraError.invalidOrigin }
    var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
    components.host = url.host!.lowercased(); if components.port == 443 { components.port = nil }
    components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    if !components.path.isEmpty { components.path = "/" + components.path }
    return components.url!.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  }
  private func path(_ base: String, _ account: String, _ day: String) throws -> String {
    guard !account.isEmpty, account.utf8.count <= 2048, TimeCalendar.validDay(day), day >= "1900-01-01" else { throw TimeTrackingError.invalid("Invalid Day Off identity or date.") }
    return "day-off/" + Self.storageKey(base) + "/" + Self.storageKey(account) + "/" + day.prefix(7) + ".json"
  }
  private func request(_ suffix: String, method: String = "GET", body: JSONValue? = nil, etag: String? = nil) async throws -> (JSONValue, HTTPURLResponse) {
    let url = URL(string: "https://api.github.com/repos/" + config.owner + "/" + config.repo + suffix)!
    var request = URLRequest(url: url); request.httpMethod = method
    request.setValue("Bearer " + config.token, forHTTPHeaderField: "Authorization")
    request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
    if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
    if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    let (data, response) = try await transport.send(request)
    guard response.url?.host == "api.github.com", response.url?.scheme == "https" else { throw JiraError.unexpectedResponse }
    let raw = data.isEmpty ? JSONValue.null : (try? JSONDecoder().decode(JSONValue.self, from: data)) ?? .null
    return (raw, response)
  }
  private func failure(_ response: HTTPURLResponse) -> TimeTrackingError {
    if response.statusCode == 429 || (response.statusCode == 403 && response.value(forHTTPHeaderField: "X-RateLimit-Remaining") == "0") { return .invalid("Day Off rate limit reached. Refresh later.") }
    if [401,403].contains(response.statusCode) { return .invalid("Day Off application access is unavailable. The owner must check its configured token.") }
    if response.statusCode == 404 { return .invalid("Day Off repository or branch unavailable. Calendar state is unknown.") }
    return .invalid("Day Off service unavailable (HTTP \(response.statusCode)).")
  }
  private func snapshot(_ path: String) async throws -> (sha: String?, data: JSONValue?) {
    let branch = config.branch.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+#?")))!
    let (file, response) = try await request("/contents/" + config.root + "/" + path + "?ref=" + branch, etag: cache[path]?.etag)
    if response.statusCode == 304, let cached = cache[path] { return (cached.sha, cached.data) }
    if response.statusCode == 404 {
      let escaped = config.branch.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#")))!
      let (branchData, branchResponse) = try await request("/branches/" + escaped)
      guard branchResponse.statusCode == 200 else { throw failure(branchResponse) }
      guard branchData["name"].string == config.branch, branchData["commit"]["sha"].string != nil else { throw JiraError.unexpectedResponse }
      cache[path] = nil; return (nil, nil)
    }
    guard response.statusCode == 200 else { throw failure(response) }
    guard file["type"].string == "file", let sha = file["sha"].string, !sha.isEmpty, file["encoding"].string == "base64",
      let content = file["content"].string, let data = Data(base64Encoded: content.components(separatedBy: .whitespacesAndNewlines).joined()),
      let raw = try? JSONDecoder().decode(JSONValue.self, from: data) else { throw TimeTrackingError.invalid("Invalid shared Day Off JSON. Nothing was overwritten.") }
    cache[path] = (sha, response.value(forHTTPHeaderField: "ETag"), raw); return (sha, raw)
  }
  private func month(_ raw: JSONValue?, base: String, account: String, day: String) throws -> JSONValue {
    let month = String(day.prefix(7))
    guard let raw else { return .object(["schemaVersion": .number(1), "jiraBaseUrl": .string(base), "jiraAccountId": .string(account), "month": .string(month), "dates": .array([]), "updatedAt": .string(ReportPeriod.iso(Date()))]) }
    let dates = raw["dates"].array.compactMap(\.string)
    guard raw["schemaVersion"].number == 1, raw["jiraBaseUrl"].string == base, raw["jiraAccountId"].string == account,
      raw["month"].string == month, case .array(let values) = raw["dates"], values.count == dates.count,
      Set(dates).count == dates.count, dates.allSatisfy({ TimeCalendar.validDay($0) && $0.hasPrefix(month + "-") }),
      TimeCalendar.instant(raw["updatedAt"].plainText) != nil else { throw TimeTrackingError.invalid("Invalid shared calendar identity or dates. Nothing was overwritten.") }
    return raw
  }
  public func read(baseURL: String, accounts: [String], days: [String]) async throws -> SharedDayOff {
    let base = try base(baseURL); var result = SharedDayOff()
    for account in Set(accounts) { for monthDay in Dictionary(grouping: days, by: { String($0.prefix(7)) }).values.compactMap(\.first) {
      try Task.checkCancellation()
      do {
        let file = try await snapshot(path(base, account, monthDay)); let record = try month(file.data, base: base, account: account, day: monthDay)
        result.dates[account, default: []].formUnion(record["dates"].array.compactMap(\.string).filter(days.contains))
      } catch is CancellationError { throw CancellationError() }
      catch { result.warnings.append(error.localizedDescription) }
    } }
    result.warnings = Array(Set(result.warnings)).sorted(); return result
  }
  private func put(_ path: String, data: JSONValue, sha: String?) async throws -> HTTPURLResponse {
    let content = try JSONEncoder().encode(data).base64EncodedString()
    var body: [String: JSONValue] = ["message": .string("Update PowerView calendar data"), "branch": .string(config.branch), "content": .string(content)]
    if let sha { body["sha"] = .string(sha) }
    return try await request("/contents/" + config.root + "/" + path, method: "PUT", body: .object(body)).1
  }
  public func set(baseURL: String, account: String, day: String, enabled: Bool, verify: @Sendable () async throws -> Void) async throws {
    let base = try base(baseURL), path = try path(base, account, day)
    var file = try await snapshot(path)
    let initial = try month(file.data, base: base, account: account, day: day)["dates"].array.contains(.string(day))
    for _ in 0..<3 {
      let record = try month(file.data, base: base, account: account, day: day)
      var dates = Set(record["dates"].array.compactMap(\.string)); let current = dates.contains(day)
      if current == enabled { return }; guard current == initial else { throw TimeTrackingError.conflict }
      if enabled { dates.insert(day) } else { dates.remove(day) }
      var updated = record.object; updated["dates"] = .array(dates.sorted().map(JSONValue.string)); updated["updatedAt"] = .string(ReportPeriod.iso(Date()))
      try await verify(); try Task.checkCancellation()
      let response: HTTPURLResponse
      do { response = try await put(path, data: .object(updated), sha: file.sha) }
      catch { return try await reconcile(path, base: base, account: account, day: day, enabled: enabled) }
      cache[path] = nil
      if (200..<300).contains(response.statusCode) { return }
      if response.statusCode >= 500 || response.statusCode == 408 { return try await reconcile(path, base: base, account: account, day: day, enabled: enabled) }
      guard [409,422].contains(response.statusCode) else { throw failure(response) }
      file = try await snapshot(path)
    }
    throw TimeTrackingError.conflict
  }
  private func reconcile(_ path: String, base: String, account: String, day: String, enabled: Bool) async throws {
    cache[path] = nil
    if let file = try? await snapshot(path), let record = try? month(file.data, base: base, account: account, day: day), record["dates"].array.contains(.string(day)) == enabled { return }
    throw TimeTrackingError.unknownOutcome
  }
  public func sync(baseURL: String, team: TimeTeam, verify: @Sendable () async throws -> Void = {}) async throws {
    let base = try base(baseURL)
    guard UUID(uuidString: team.id) != nil, !team.name.isEmpty, !team.members.contains(where: { $0.accountId.isEmpty }), Set(team.members.map(\.accountId)).count == team.members.count else { throw JiraError.unexpectedResponse }
    let path = "teams/" + Self.storageKey(base) + "/" + Self.storageKey(team.id) + ".json"
    let file = try await snapshot(path)
    let raw: JSONValue = .object(["schemaVersion": .number(1), "jiraBaseUrl": .string(base), "teamId": .string(team.id), "teamName": .string(team.name), "members": .array(team.members.map { .object(["accountId": .string($0.accountId), "displayName": .string($0.displayName)]) }), "updatedAt": .string(ReportPeriod.iso(Date()))])
    try await verify(); try Task.checkCancellation()
    do {
      let response = try await put(path, data: raw, sha: file.sha); cache[path] = nil
      if (200..<300).contains(response.statusCode) { return }
      if [409,422].contains(response.statusCode) { throw TimeTrackingError.conflict }
      if response.statusCode < 500 && response.statusCode != 408 { throw failure(response) }
    } catch let error as TimeTrackingError { throw error } catch { }
    cache[path] = nil
    if let latest = try? await snapshot(path), latest.data == raw { return }
    throw TimeTrackingError.unknownOutcome
  }
}
public struct TimeEmployeeMetrics: Sendable {
  public var worklogCounts: [String: Int] = [:]
  public var issueWorklogCounts: [String: [String: Int]] = [:]
  public var user: JiraUser; public var days: [String: Int]; public var issueDays: [String: [String: Int]]
  public var dayOffs: Set<String>; public var logged: Int; public var expected: Int?
  public var utilization: Double? { expected.flatMap { $0 > 0 ? Double(logged) / Double($0) * 100 : nil } }
  public var missing: Int? { expected.map { max(0, $0 - logged) } }
  public var overtime: Int? { expected.map { max(0, logged - $0) } }
  public enum DayStyle: String, Sendable { case normal, dayOff, conflict, deficit }
  public func style(on day: String, issue: String? = nil) -> DayStyle {
    let count = issue.map { issueWorklogCounts[$0]?[day] ?? 0 } ?? worklogCounts[day, default: 0]
    if dayOffs.contains(day) { return count > 0 ? .conflict : .dayOff }
    if issue == nil, expected != nil, let date = TimeCalendar.instant(day + "T12:00:00Z") {
      var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
      let weekday = calendar.component(.weekday, from: date)
      if weekday != 1 && weekday != 7 && days[day, default: 0] < 8 * 3600 { return .deficit }
    }
    return .normal
  }
}
public enum TimeReportCalculator {
  public static func build(users: [JiraUser], worklogs: [TimeWorklog], query: TimeQuery, calendar: SharedDayOff?, worklogsComplete: Bool) throws -> [TimeEmployeeMetrics] {
    try query.validate(); guard Set(users.map(\.accountId)).count == users.count, !users.contains(where: { $0.accountId.isEmpty }) else { throw TimeTrackingError.identity }
    var unique: [String: TimeWorklog] = [:]
    for log in worklogs { if let previous = unique[log.id], previous != log { throw TimeTrackingError.conflict }; unique[log.id] = log }
    return users.map { user in
      let off = calendar?.dates[user.accountId] ?? []
      var days: [String: Int] = [:]; var issues: [String: [String: Int]] = [:]
      var counts: [String: Int] = [:]; var issueCounts: [String: [String: Int]] = [:]
      for log in unique.values where log.authorID == user.accountId {
        guard let date = TimeCalendar.instant(log.started) else { continue }; let day = TimeCalendar.text(date, zone: query.zone)
        guard query.days.contains(day) else { continue }; days[day, default: 0] += log.seconds; issues[log.issueKey, default: [:]][day, default: 0] += log.seconds
        counts[day, default: 0] += 1; issueCounts[log.issueKey, default: [:]][day, default: 0] += 1
      }
      var expected = 0
      var weekdayCalendar = Calendar(identifier: .gregorian); weekdayCalendar.timeZone = TimeZone(secondsFromGMT: 0)!
      for day in query.days where !off.contains(day) {
        let weekday = weekdayCalendar.component(.weekday, from: TimeCalendar.instant(day + "T12:00:00Z")!)
        if weekday != 1 && weekday != 7 { expected += 8 * 3600 }
      }
      return TimeEmployeeMetrics(worklogCounts: counts, issueWorklogCounts: issueCounts, user: user, days: days, issueDays: issues, dayOffs: off, logged: days.values.reduce(0,+), expected: calendar?.complete == true && worklogsComplete ? expected : nil)
    }
  }
}
