import Foundation

public struct ChromeSetup: Equatable, Sendable {
  public let raw: JSONValue
  public let archive: JSONValue
  public let origin: String
  public let project: String
  public let boardID: String
  public let boardName: String
  public let jql: String
  public let startField: String
  public let dueField: String
  public let preferences: TimelinePreferences
  public let unsupportedFields: [String]
  public let links: [TimelineLink]
  public let reconciledDates: [String: LocalIssuePlan]
  public static func decode(_ data: Data) throws -> Self {
    let archive = try JSONDecoder().decode(JSONValue.self, from: data)
    let portable = archive["kind"].string == "power-view-board-configuration"
    if portable && archive["version"].number != 1 { throw ReleaseError.unsupportedFormat }
    let raw = portable ? archive["configuration"]["setup"] : archive
    guard let address = raw["jiraBaseUrl"].string, let url = URL(string: address),
      url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil, ["", "/"].contains(url.path),
      let project = raw["project"]["key"].string,
      project.range(of: "^[A-Z][A-Z0-9_]*$", options: .regularExpression) != nil,
      let board = raw["board"]["id"].identifier, let boardNumber = Int(board), boardNumber > 0,
      let jql = raw["jql"].string, jql.count <= 10_000
    else { throw ReleaseError.unsupportedFormat }
    let origin = address.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    if portable {
      guard
        archive["board"]["jiraBaseUrl"].string?.trimmingCharacters(
          in: CharacterSet(charactersIn: "/")) == origin,
        archive["board"]["projectKey"].string == project,
        archive["board"]["boardId"].identifier == board
      else { throw ReleaseError.unsupportedFormat }
    }
    func dateField(_ name: String, fallback: String) throws -> String {
      guard let value = raw["fieldMapping"][name].string, !value.isEmpty else { return fallback }
      guard
        value.range(of: "^[A-Za-z][A-Za-z0-9_]*$", options: .regularExpression)
          != nil
      else { throw ReleaseError.unsupportedFormat }
      return value
    }
    var preferences = ProductWorkspace.defaultPreferences
    let days = raw["nonWorkingDays"].array.compactMap(\.number)
    guard days.count == raw["nonWorkingDays"].array.count,
      days.allSatisfy({ $0 >= 0 && $0 <= 6 && $0.rounded() == $0 }), Set(days).count < 7
    else { throw ReleaseError.unsupportedFormat }
    if raw["nonWorkingDays"] != .null {
      preferences.nonWorkingDays = Set(days.map(Int.init)).sorted()
    }
    var durations: [String: Double] = [:]
    for (key, value) in raw["defaultDurations"].object {
      guard let number = value.number, number >= 1, number <= 365, number.rounded() == number,
        ["subtask", "task", "bug", "story", "epic", "unknown"].contains(key)
      else {
        throw ReleaseError.unsupportedFormat
      }
      durations[key] = number
    }
    if !durations.isEmpty { preferences.defaultDurations = durations }
    let configuration = archive["configuration"]
    if portable {
      preferences.search = configuration["ganttFilters"]["search"].string ?? ""
      preferences.hideDone = configuration["ganttFilters"]["excludeDone"].boolean
      let view = configuration["ganttViewPreferences"]
      preferences.dayWidth =
        view["zoom"].string == "day" ? 40 : view["zoom"].string == "month" ? 10 : 24
      let sorts: [String: TimelineSort] = [
        "default": .rank, "startDate": .start, "endDate": .due, "name": .name, "status": .status,
        "assignee": .assignee, "issueKey": .key,
      ]
      preferences.sort = sorts[view["sortBy"].string ?? "default"] ?? .rank
      preferences.ascending = view["sortDirection"].string != "desc"
    }
    var links: [TimelineLink] = []
    var graph: [String: Set<String>] = [:]
    for item in configuration["ganttBoardState"]["dependencies"].array {
      guard let predecessor = item["predecessorIssueKey"].string,
        let successor = item["successorIssueKey"].string,
        ChromeEstimationBoard.parseKeys(predecessor) == [predecessor],
        ChromeEstimationBoard.parseKeys(successor) == [successor], predecessor != successor,
        let kind = item["type"].string.flatMap(TimelineLinkKind.init),
        let lag = item["lagWorkingDays"].number, lag.rounded() == lag, abs(lag) <= 365
      else { throw ReleaseError.unsupportedFormat }
      graph[predecessor, default: []].insert(successor)
      links.append(
        .init(
          predecessor: predecessor, successor: successor, kind: kind,
          id: item["id"].string ?? UUID().uuidString, lagWorkingDays: Int(lag)))
    }
    var visiting: Set<String> = []
    var visited: Set<String> = []
    func acyclic(_ key: String) -> Bool {
      if visiting.contains(key) { return false }
      if visited.contains(key) { return true }
      visiting.insert(key)
      for next in graph[key] ?? [] { if !acyclic(next) { return false } }
      visiting.remove(key)
      visited.insert(key)
      return true
    }
    guard graph.keys.allSatisfy(acyclic) else { throw ReleaseError.unsupportedFormat }
    var plans: [String: LocalIssuePlan] = [:]
    for (key, item) in configuration["ganttBoardState"]["reconciledDates"].object {
      let start = item["startDate"].string
      let end = item["dueDate"].string
      guard ChromeEstimationBoard.parseKeys(key) == [key],
        [start, end].compactMap({ $0 }).allSatisfy({
          $0.count == 10 && TimelineDates.parse($0) != nil
        }),
        start == nil || end == nil || start! <= end!
      else { throw ReleaseError.unsupportedFormat }
      plans[key] = .init(start: start, due: end, dependencies: [])
    }

    return .init(
      raw: raw, archive: archive, origin: origin, project: project, boardID: board,
      boardName: raw["board"]["name"].string ?? board, jql: jql,
      startField: try dateField("startDateFieldId", fallback: ""),
      dueField: try dateField("endDateFieldId", fallback: ""), preferences: preferences,
      unsupportedFields: [], links: links, reconciledDates: plans)
  }
}
