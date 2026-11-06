import Foundation

/// Port of packages/domain/src/report.ts. Inputs use the legacy normalized issue shape.
public enum BoardHealthCalculator {
  private static func category(_ issue: JSONValue, _ options: JSONValue) -> String {
    if (issue["status"]["id"] != .null
      && options["completedStatusIds"].array.contains(issue["status"]["id"]))
      || options["completedStatusNames"].array.contains(issue["status"]["name"])
    {
      return "done"
    }
    return issue["status"]["category"].string ?? "unknown"
  }
  private static func activeSprints(_ issues: [JSONValue], options: JSONValue) -> [JSONValue] {
    var sprints: [String: JSONValue] = [:]
    for sprint in issues.flatMap({ $0["sprints"].array }) {
      let id = sprint["id"].identifier ?? ""
      if sprints[id] == nil || sprints[id]?["state"].string == "unknown" { sprints[id] = sprint }
    }
    let active = sprints.values.filter { $0["state"].string == "active" }.sorted {
      ($0["name"].string ?? "").compare(
        $1["name"].string ?? "", locale: Locale(identifier: "en_US")) == .orderedAscending
    }
    if let id = options["preferredSprintId"].string,
      let sprint = active.first(where: { $0["id"].identifier == id })
    {
      return [sprint]
    }
    if let id = options["preferredBoardId"].string {
      let onBoard = active.filter { $0["boardId"].identifier == id }
      if !onBoard.isEmpty { return onBoard }
    }
    return active
  }
  public static func board(_ issues: [JSONValue], options: JSONValue) -> JSONValue {
    func n(_ value: Int) -> JSONValue { .number(Double(value)) }
    let done = issues.filter { category($0, options) == "done" }
    let open = issues.filter { category($0, options) != "done" }
    let now = options["now"].string.flatMap(ReportPeriod.date) ?? Date()
    let threshold = now.addingTimeInterval(-(options["recentDoneDays"].number ?? 30) * 86_400)
    var result: [String: JSONValue] = [
      "total": n(issues.count), "open": n(open.count), "done": n(done.count),
      "recentDone": n(
        done.filter {
          ($0["resolvedAt"].string.flatMap(ReportPeriod.date) ?? .distantPast) >= threshold
        }.count),
      "unassignedOpen": n(open.filter { $0["assignee"] == .null }.count),
      "statuses": .object([
        "total": n(issues.count),
        "toDo": n(issues.filter { category($0, options) == "to-do" }.count),
        "inProgress": n(issues.filter { category($0, options) == "in-progress" }.count),
        "done": n(done.count),
        "unknown": n(issues.filter { category($0, options) == "unknown" }.count),
      ]),
      "activeSprints": .array(activeSprints(issues, options: options)),
    ]
    if options["sprintDataAvailable"].boolean {
      var planning = [
        "totalOpen": open.count, "currentSprint": 0, "futureSprint": 0, "unscheduled": 0,
      ]
      for issue in open {
        let states = issue["sprints"].array.compactMap { $0["state"].string }
        let bucket =
          states.contains("active")
          ? "currentSprint" : states.contains("future") ? "futureSprint" : "unscheduled"
        planning[bucket, default: 0] += 1
      }
      result["planning"] = .object(planning.mapValues { n($0) })
    }
    return .object(result)
  }
  public static func sprint(
    _ issues: [JSONValue], sprint: JSONValue, blockedIDs: Set<String>, options: JSONValue
  ) -> JSONValue {
    let issues = issues.filter {
      $0["sprints"].array.isEmpty || $0["sprints"].array.contains { $0["id"] == sprint["id"] }
    }
    func buckets(_ issues: [JSONValue], points: Bool) -> JSONValue {
      var values: [String: Double] = [
        "total": 0, "done": 0, "inProgress": 0, "notStarted": 0, "unknown": 0,
      ]
      for issue in issues {
        guard let value = points ? issue["storyPoints"].number : 1 else { continue }
        values["total", default: 0] += value
        let category = category(issue, options)
        let key =
          category == "done"
          ? "done"
          : category == "in-progress"
            ? "inProgress" : category == "to-do" ? "notStarted" : "unknown"
        values[key, default: 0] += value
      }
      return .object(values.mapValues(JSONValue.number))
    }
    func userKey(_ issue: JSONValue) -> String {
      issue["assignee"]["accountId"].string ?? issue["assignee"]["username"].string ?? issue[
        "assignee"]["displayName"].string ?? "__unassigned__"
    }
    var people: [JSONValue] = []
    for key in Set(issues.map(userKey)) {
      let assigned = issues.filter { userKey($0) == key }
      let user = issues.first { userKey($0) == key }!["assignee"]
      var person: [String: JSONValue] = [
        "key": .string(key), "name": .string(user["displayName"].string ?? "Unassigned"),
        "issues": buckets(assigned, points: false), "storyPoints": buckets(assigned, points: true),
      ]
      if user["avatarUrl"] != .null { person["avatarUrl"] = user["avatarUrl"] }
      people.append(.object(person))
    }
    people.sort {
      if $0["key"].string == "__unassigned__" { return false }
      if $1["key"].string == "__unassigned__" { return true }
      return ($0["name"].string ?? "").compare(
        $1["name"].string ?? "", locale: Locale(identifier: "en_US")) == .orderedAscending
    }
    return .object([
      "sprint": sprint, "issues": buckets(issues, points: false),
      "storyPoints": buckets(issues, points: true),
      "storyPointsCoverage": .number(
        issues.isEmpty
          ? 0 : Double(issues.filter { $0["storyPoints"] != .null }.count) / Double(issues.count)),
      "people": .array(people),
      "unassigned": .number(Double(issues.filter { $0["assignee"] == .null }.count)),
      "blocked": .number(
        Double(issues.filter { blockedIDs.contains($0["id"].string ?? "") }.count)),
    ])
  }
}
