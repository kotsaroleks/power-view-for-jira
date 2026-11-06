import Foundation

extension JSONValue {
  public subscript(_ key: String) -> JSONValue {
    if case .object(let object) = self { return object[key] ?? .null }
    return .null
  }
  public var array: [JSONValue] {
    if case .array(let value) = self { return value }
    return []
  }
  public var string: String? {
    if case .string(let value) = self { return value }
    return nil
  }
  public var number: Double? {
    if case .number(let value) = self { return value }
    return nil
  }
  public var object: [String: JSONValue] {
    if case .object(let value) = self { return value }
    return [:]
  }
  public var boolean: Bool {
    if case .bool(let value) = self { return value }
    return false
  }
  public var prettyJSON: String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return String(decoding: (try? encoder.encode(self)) ?? Data(), as: UTF8.self)
  }
}
public struct ReportPeriod: Codable, Equatable, Sendable {
  public let timeZone: String
  public let start: String
  public let end: String
  public let dataCutoff: String
  public static func date(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) { return date }
    return ISO8601DateFormatter().date(from: value)
  }
  public static func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }
  public func contains(_ value: JSONValue) -> Bool {
    guard let value = value.string.flatMap(Self.date), let start = Self.date(start),
      let cutoff = Self.date(dataCutoff)
    else { return false }
    return value >= start && value < cutoff
  }
  public static func build(type: String, localDate: String, generatedAt: String) throws -> Self {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Kyiv")!
    let parts = localDate.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3, let generated = date(generatedAt),
      let day = calendar.date(
        from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 8))
    else { throw JiraError.unexpectedResponse }
    let start: Date
    let end: Date
    if type == "daily" {
      end = day
      start = calendar.date(byAdding: .day, value: -1, to: day)!
    } else if type == "weekly" {
      let offset = (calendar.component(.weekday, from: day) + 5) % 7
      start = calendar.date(byAdding: .day, value: -offset, to: day)!
      end = calendar.date(byAdding: .day, value: 7, to: start)!
    } else {
      throw JiraError.unexpectedResponse
    }
    return .init(
      timeZone: "Europe/Kyiv", start: iso(start), end: iso(end),
      dataCutoff: generated < end ? generatedAt : iso(end))
  }
  public static func sprint(_ sprint: JSONValue, generatedAt: String) throws -> Self {
    guard let start = sprint["startDate"].string.flatMap(date), let generated = date(generatedAt)
    else { throw JiraError.unexpectedResponse }
    let end =
      sprint["state"].string == "active"
      ? generated
      : (sprint["completeDate"].string.flatMap(date) ?? sprint["endDate"].string.flatMap(date)
        ?? generated)
    return .init(
      timeZone: "Europe/Kyiv", start: iso(start), end: iso(end),
      dataCutoff: iso(min(end, generated)))
  }
}
public struct ReportingInput: Codable, Sendable {
  public var issues: [JSONValue]
  public var changes: [JSONValue]
  public var worklogs: [JSONValue]
  public var period: ReportPeriod
  public var type: String
  public var scope: JSONValue
  public var statusMapping: JSONValue
}
/// Port of packages/domain/src/reporting-calculations.ts, compared against its golden outputs.
public enum ReportCalculator {
  private static func done(_ issue: JSONValue, _ mapping: JSONValue) -> Bool {
    if let id = issue["status"]["id"].string {
      return mapping["completedStatusIds"].array.contains(.string(id))
    }
    return mapping["completedStatusNames"].array.contains(issue["status"]["name"])
  }
  private static func metric(
    _ numerator: Double, _ denominator: Double, _ unit: String, _ estimated: Int, _ unestimated: Int
  ) -> JSONValue {
    .object([
      "percentage": denominator > 0 ? .number(numerator / denominator * 100) : .null,
      "numerator": .number(numerator), "denominator": .number(denominator), "unit": .string(unit),
      "estimatedIssueCount": .number(Double(estimated)),
      "unestimatedIssueCount": .number(Double(unestimated)),
    ])
  }
  public static func completion(_ issues: [JSONValue], mapping: JSONValue, mode: String)
    -> JSONValue
  {
    if mode == "issue-count" {
      return metric(
        Double(issues.filter { done($0, mapping) }.count), Double(issues.count), "issues",
        issues.count, 0)
    }
    let points = mode == "story-points"
    let field = points ? "storyPoints" : "originalEstimateSeconds"
    let estimated = issues.filter { issue in
      guard let number = issue[field].number else { return false }
      return points ? number >= 0 : number > 0
    }
    return metric(
      estimated.filter { done($0, mapping) }.reduce(0) { $0 + ($1[field].number ?? 0) },
      estimated.reduce(0) { $0 + ($1[field].number ?? 0) }, points ? "story-points" : "seconds",
      estimated.count, issues.count - estimated.count)
  }
  public static func calculate(_ input: ReportingInput, progressMode: String? = nil) -> JSONValue {
    let selected = input.scope["kind"].string == "assignee" ? input.scope["userId"].string : nil
    let issues = input.issues.filter { selected == nil || $0["assignee"]["id"].string == selected }
    let ids = Set(issues.compactMap { $0["id"].string })
    let changes = input.changes.filter {
      (selected == nil || ids.contains($0["issueId"].string ?? "")
        || $0["actor"]["id"].string == selected) && input.period.contains($0["occurredAt"])
    }
    let worklogs = input.worklogs.filter {
      selected == nil || $0["author"]["id"].string == selected
    }
    var users: [String: JSONValue] = [:]
    var order: [String] = []
    for user in issues.map({ $0["assignee"] }) + worklogs.map({ $0["author"] }) {
      if let id = user["id"].string {
        if users[id] == nil { order.append(id) }
        users[id] = user
      }
    }
    order.sort {
      (users[$0]?["displayName"].string ?? "").compare(
        users[$1]?["displayName"].string ?? "", options: [], locale: Locale(identifier: "en_US"))
        == .orderedAscending
    }
    let people: [JSONValue] = order.map { id in
      let assigned = issues.filter { $0["assignee"]["id"].string == id }
      let assignedIDs = Set(assigned.compactMap { $0["id"].string })
      let userChanges = changes.filter {
        assignedIDs.contains($0["issueId"].string ?? "") || $0["actor"]["id"].string == id
      }
      let logs = worklogs.filter {
        $0["author"]["id"].string == id && input.period.contains($0["startedAt"])
      }
      func keys(_ type: String) -> JSONValue {
        .array(userChanges.filter { $0["type"].string == type }.map { $0["issueKey"] })
      }
      return .object([
        "user": users[id]!, "assignedIssues": .array(assigned), "changes": .array(userChanges),
        "createdIssues": keys("issue-created"), "completedIssues": keys("issue-completed"),
        "reopenedIssues": keys("issue-reopened"),
        "authoredWorklogs": .array(logs),
        "worklogSeconds": .number(logs.reduce(0) { $0 + ($1["timeSpentSeconds"].number ?? 0) }),
      ])
    }
    let unassigned = issues.filter { $0["assignee"] == .null }
    let unassignedIDs = Set(unassigned.compactMap { $0["id"].string })
    func count(_ value: Int) -> JSONValue { .number(Double(value)) }
    func changeCount(_ type: String) -> JSONValue {
      count(
        Set(changes.filter { $0["type"].string == type }.compactMap { $0["issueId"].string }).count)
    }
    let doneCount = issues.filter { done($0, input.statusMapping) }.count
    var result: [String: JSONValue] = [
      "executiveSummary": .object([
        "totalIssues": count(issues.count), "completedIssues": count(doneCount),
        "incompleteIssues": count(issues.count - doneCount),
        "createdIssues": changeCount("issue-created"),
        "completedDuringPeriod": changeCount("issue-completed"),
        "reopenedDuringPeriod": changeCount("issue-reopened"),
        "totalTimeSpentSeconds": .number(
          issues.reduce(0) { $0 + ($1["timeSpentSeconds"].number ?? 0) }),
        "worklogSeconds": .number(
          worklogs.filter { input.period.contains($0["startedAt"]) }.reduce(0) {
            $0 + ($1["timeSpentSeconds"].number ?? 0)
          }), "unassignedIssues": count(unassigned.count),
      ]),
      "people": .array(people),
      "unassigned": .object([
        "issues": .array(unassigned),
        "changes": .array(changes.filter { unassignedIDs.contains($0["issueId"].string ?? "") }),
      ]),
      "activity": .array(
        changes.enumerated().sorted { a, b in
          let left = a.element["occurredAt"].string ?? ""
          let right = b.element["occurredAt"].string ?? ""
          return left == right ? a.offset < b.offset : left < right
        }.map(\.element)),
    ]
    if input.type == "sprint", let mode = progressMode {
      func group(_ type: String) -> JSONValue {
        var order: [String] = []
        var groups: [String: [JSONValue]] = [:]
        for event in changes where event["type"].string == type {
          let id = event["issueId"].string ?? ""
          if groups[id] == nil { order.append(id) }
          groups[id, default: []].append(event)
        }
        return .array(
          order.compactMap { id in
            guard let issue = issues.first(where: { $0["id"].string == id }) else { return nil }
            return .object(["issue": issue, "events": .array(groups[id]!)])
          })
      }
      let estimated = issues.filter { ($0["originalEstimateSeconds"].number ?? 0) > 0 }
      let unestimated = issues.filter {
        mode == "story-points"
          ? $0["storyPoints"] == .null : ($0["originalEstimateSeconds"].number ?? 0) <= 0
      }
      let unestimatedDone = unestimated.filter { done($0, input.statusMapping) }.count
      result["sprint"] = .object([
        "progressMode": .string(mode),
        "completion": completion(issues, mapping: input.statusMapping, mode: mode),
        "timeUtilization": metric(
          estimated.reduce(0) { $0 + ($1["timeSpentSeconds"].number ?? 0) },
          estimated.reduce(0) { $0 + ($1["originalEstimateSeconds"].number ?? 0) }, "seconds",
          estimated.count, issues.count - estimated.count),
        "addedAfterStart": group("sprint-added"), "removedAfterStart": group("sprint-removed"),
        "unestimated": .object([
          "total": count(unestimated.count), "completed": count(unestimatedDone),
          "incomplete": count(unestimated.count - unestimatedDone),
        ]),
      ])
    }
    return .object(result)
  }
}

extension ReportCalculator {
  /// Recalculate only display metrics from an existing immutable source snapshot. Scope history stays intact.
  public static func changingProgressMode(snapshot: JSONValue, to mode: String) throws -> JSONValue
  {
    guard ["issue-count", "story-points", "original-estimate"].contains(mode),
      snapshot["request"]["type"].string == "sprint",
      snapshot["result"]["sprint"] != .null
    else { throw JiraError.unexpectedResponse }
    let period = try JSONDecoder().decode(
      ReportPeriod.self, from: JSONEncoder().encode(snapshot["request"]["period"]))
    let input = ReportingInput(
      issues: snapshot["issues"].array, changes: snapshot["changes"].array,
      worklogs: snapshot["worklogs"].array,
      period: period, type: "sprint", scope: snapshot["request"]["scope"],
      statusMapping: snapshot["statusMapping"])
    let recalculated = calculate(input, progressMode: mode)["sprint"]
    var copy = snapshot.object
    var result = snapshot["result"].object
    var sprint = snapshot["result"]["sprint"].object
    var request = snapshot["request"].object
    for key in ["completion", "unestimated", "progressMode"] { sprint[key] = recalculated[key] }
    result["sprint"] = .object(sprint)
    request["progressMode"] = .string(mode)
    copy["result"] = .object(result)
    copy["request"] = .object(request)
    return .object(copy)
  }
}
