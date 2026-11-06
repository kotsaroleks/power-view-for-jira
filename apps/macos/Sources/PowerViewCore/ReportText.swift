import Foundation

public enum ReportTextRenderer {
  public static func render(_ snapshot: JSONValue, language: String) -> String {
    if snapshot["request"]["type"].string == "board-health" {
      return boardHealth(snapshot, language: language)
    }
    let uk = language == "uk"
    let result = snapshot["result"]
    let summary = result["executiveSummary"]
    func date(_ value: JSONValue) -> String {
      guard let date = value.string.flatMap(ReportPeriod.date) else { return "N/A" }
      let formatter = DateFormatter()
      formatter.locale = Locale(identifier: uk ? "uk_UA" : "en_GB")
      formatter.timeZone = TimeZone(identifier: "Europe/Kyiv")
      formatter.dateStyle = .medium
      formatter.timeStyle = .short
      return formatter.string(from: date)
    }
    func count(_ value: JSONValue) -> String { String(Int(value.number ?? 0)) }
    let worklogUnavailable = snapshot["completeness"]["warnings"].array.contains {
      $0["code"].string == "WORKLOG_UNAVAILABLE"
    }
    let changesUnavailable = snapshot["completeness"]["warnings"].array.contains {
      $0["code"].string == "CHANGELOG_UNAVAILABLE"
    }
    func hours(_ value: JSONValue) -> String {
      worklogUnavailable
        ? "N/A" : String(format: "%.1f", (value.number ?? 0) / 3600) + (uk ? " год" : "h")
    }
    var lines = [
      "\(uk ? "Звіт" : "Report"): \((snapshot["request"]["type"].string ?? "").uppercased()) · \(snapshot["board"]["name"].string ?? "")",
      "\(uk ? "Період" : "Period"): \(date(snapshot["request"]["period"]["start"])) — \(date(snapshot["request"]["period"]["end"]))",
      "\(uk ? "Станом на" : "Data as of"): \(date(snapshot["request"]["period"]["dataCutoff"]))",
      "", "Executive Summary",
      "- \(uk ? "Задачі" : "Issues"): \(count(summary["totalIssues"]))",
      "- \(uk ? "Виконано" : "Completed"): \(count(summary["completedIssues"]))",
      "- \(uk ? "Створено за період" : "Created in period"): \(count(summary["createdIssues"]))",
      "- \(uk ? "Завершено за період" : "Completed in period"): \(changesUnavailable ? "N/A" : count(summary["completedDuringPeriod"]))",
      "- Worklog: \(hours(summary["worklogSeconds"]))",
      "- \(uk ? "Без виконавця" : "Unassigned"): \(count(summary["unassignedIssues"]))",
    ]
    if result["sprint"] != .null {
      let sprint = result["sprint"]
      let percent =
        sprint["completion"]["percentage"].number.map { String(format: "%.1f%%", $0) } ?? "N/A"
      lines += [
        "- \(uk ? "Виконання спринту" : "Sprint completion"): \(percent)",
        "- \(uk ? "Додано після старту" : "Added after start"): \(changesUnavailable ? "N/A" : String(sprint["addedAfterStart"].array.count))",
        "- \(uk ? "Виключено після старту" : "Removed after start"): \(changesUnavailable ? "N/A" : String(sprint["removedAfterStart"].array.count))",
      ]
    }
    lines += ["", uk ? "Учасники" : "People"]
    for person in result["people"].array {
      lines += [
        person["user"]["displayName"].string ?? "",
        "- \(uk ? "Виконано" : "Done"): \(changesUnavailable ? "N/A" : String(person["completedIssues"].array.count))",
        "- \(uk ? "Поточні задачі" : "Current tasks"): \(person["assignedIssues"].array.count)",
        "- \(uk ? "Залоговано" : "Logged"): \(hours(person["worklogSeconds"]))",
      ]
      let activity = activity(person["changes"].array)
      if !activity.isEmpty {
        lines.append("- \(uk ? "Змінені задачі" : "Changed issues"):")
        for entry in activity {
          lines.append("  - \(entry.key): \(entry.change) (\(date(.string(entry.date))))")
        }
      }
      lines.append("")
    }
    lines += [
      "Unassigned", "- \(uk ? "Задачі" : "Issues"): \(result["unassigned"]["issues"].array.count)",
    ]
    if !snapshot["completeness"]["warnings"].array.isEmpty {
      lines += ["", uk ? "Попередження" : "Warnings"]
      lines += snapshot["completeness"]["warnings"].array.map {
        "- " + ($0["message"].string ?? "")
      }
    }
    return lines.joined(separator: "\n")
  }
  public static func boardHealth(_ snapshot: JSONValue, language: String) -> String {
    let uk = language == "uk"
    let health = snapshot["result"]["boardHealth"]
    func n(_ value: JSONValue) -> String { value.number.map { $0.formatted() } ?? "N/A" }
    var lines = [
      "Board Health · " + (snapshot["board"]["name"].string ?? ""),
      (uk ? "Станом на: " : "Data as of: ") + (snapshot["generatedAt"].string ?? ""),
      (uk ? "Усього: " : "Total: ") + n(health["total"]),
      (uk ? "Відкрито: " : "Open: ") + n(health["open"]),
      (uk ? "Готово: " : "Done: ") + n(health["done"]),
      (uk ? "Завершено за останні 30 днів: " : "Done in last 30 days: ") + n(health["recentDone"]),
      (uk ? "Без виконавця серед відкритих: " : "Unassigned open: ") + n(health["unassignedOpen"]),
    ]
    let planning = health["planning"]
    lines += [
      (uk ? "Поточний спринт: " : "Current sprint: ") + n(planning["currentSprint"]),
      (uk ? "Майбутній спринт: " : "Future sprint: ") + n(planning["futureSprint"]),
      (uk ? "Без спринту: " : "Unscheduled: ") + n(planning["unscheduled"]),
    ]
    for sprint in snapshot["result"]["sprintHealth"].array {
      lines += [
        "", sprint["sprint"]["name"].string ?? "Sprint",
        (uk ? "Задачі / готово: " : "Issues / done: ") + n(sprint["issues"]["total"]) + " / "
          + n(sprint["issues"]["done"]),
        "Story Points / Done: " + n(sprint["storyPoints"]["total"]) + " / "
          + n(sprint["storyPoints"]["done"]),
        (uk ? "Покриття Story Points: " : "Story Points coverage: ")
          + ((sprint["storyPointsCoverage"].number ?? 0) * 100).formatted() + "%",
        (uk ? "Заблоковані задачі: " : "Blocked issues: ")
          + (snapshot["result"]["blockedAvailable"].boolean ? n(sprint["blocked"]) : "N/A"),
      ]
      for person in sprint["people"].array {
        lines.append(
          (person["name"].string ?? "") + ": " + n(person["issues"]["total"]) + " / "
            + n(person["issues"]["done"]))
      }
    }
    lines += snapshot["completeness"]["warnings"].array.compactMap { $0["message"].string }
    return lines.joined(separator: "\n")
  }
  private struct Activity {
    let key: String
    let date: String
    let change: String
  }
  private static func activity(_ events: [JSONValue]) -> [Activity] {
    var created: [Activity] = []
    var groups: [String: [JSONValue]] = [:]
    var order: [String] = []
    for event in events {
      let type = event["type"].string ?? ""
      if ["issue-completed", "issue-reopened"].contains(type) { continue }
      if type == "issue-created" {
        created.append(
          .init(
            key: event["issueKey"].string ?? "", date: event["occurredAt"].string ?? "",
            change: "Issue created"))
        continue
      }
      let key =
        (event["issueId"].string ?? "") + "|" + (event["occurredAt"].string ?? "") + "|"
        + (event["actor"]["id"].string ?? "unknown")
      if groups[key] == nil { order.append(key) }
      groups[key, default: []].append(event)
    }
    let grouped: [Activity] = order.compactMap { key in
      guard let events = groups[key], let first = events.first else { return nil }
      let fragments: [String] = events.compactMap { event in
        let value =
          event["to"].string ?? event["to"].number.map { $0.formatted(.number.grouping(.never)) }
        switch event["type"].string {
        case "status-changed": return value.map { "set status to \"" + $0 + "\"" }
        case "assignee-changed":
          return value.map { "reassigned to " + $0 } ?? "unassigned the issue"
        case "story-points-changed": return value.map { "updated story points to " + $0 }
        case "original-estimate-changed": return value.map { "updated original estimate to " + $0 }
        case "sprint-added": return "added the issue to the sprint"
        case "sprint-removed": return "removed the issue from the sprint"
        default: return nil
        }
      }
      guard !fragments.isEmpty else { return nil }
      let change =
        fragments.count == 1
        ? fragments[0] : fragments.dropLast().joined(separator: ", ") + " and " + fragments.last!
      return .init(
        key: first["issueKey"].string ?? "", date: first["occurredAt"].string ?? "", change: change)
    }
    return (created + grouped).sorted { $0.date < $1.date }
  }
}
