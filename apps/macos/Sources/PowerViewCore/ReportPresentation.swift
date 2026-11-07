import Foundation

public enum ReportPresentation {
  public static func hours(_ seconds: Double) -> String {
    String(format: "%.1fh", (seconds / 3600 * 10).rounded(.toNearestOrAwayFromZero) / 10)
  }
  public static func formatDate(_ value: String) -> String {
    guard let date = ReportPeriod.date(value) else { return value }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "uk_UA")
    formatter.timeZone = TimeZone(identifier: "Europe/Kyiv")
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: date)
  }
  public struct Activity: Identifiable, Equatable, Sendable {
    public let id: String
    public let occurredAt: String
    public let issueKey: String
    public let actor: String
    public let change: String
  }
  public struct IssueRow: Identifiable, Sendable {
    public var id: String { issue["id"].string ?? issue["key"].plainText }
    public let issue: JSONValue
    public let depth: Int
  }
  public static func activity(_ events: [JSONValue]) -> [Activity] {
    var created: [Activity] = []
    var groups: [String: [JSONValue]] = [:]
    var order: [String] = []
    for event in events {
      let type = event["type"].string ?? ""
      if type == "issue-completed" || type == "issue-reopened" { continue }
      if type == "issue-created" {
        created.append(
          Activity(
            id: event["id"].plainText, occurredAt: event["occurredAt"].plainText,
            issueKey: event["issueKey"].plainText, actor: "—", change: "Issue created"))
        continue
      }
      let key =
        event["issueId"].plainText + "|" + event["occurredAt"].plainText + "|"
        + (event["actor"]["id"].string ?? "unknown")
      if groups[key] == nil { order.append(key) }
      groups[key, default: []].append(event)
    }
    for key in order {
      guard let group = groups[key], let first = group.first else { continue }
      let fragments = group.compactMap { event -> String? in
        let to = event["to"]
        switch event["type"].string {
        case "description-changed": return "updated the description"
        case "status-changed":
          return to == .null || to.string == "" ? nil : "set status to \"" + to.plainText + "\""
        case "assignee-changed":
          return to == .null || to.string == ""
            ? "unassigned the issue" : "reassigned to " + to.plainText
        case "story-points-changed":
          return to == .null ? nil : "updated story points to " + to.plainText
        case "original-estimate-changed":
          return to == .null ? nil : "updated original estimate to " + to.plainText
        case "sprint-added": return "added the issue to the sprint"
        case "sprint-removed": return "removed the issue from the sprint"
        default: return nil
        }
      }
      guard let last = fragments.last else { continue }
      let text =
        fragments.count == 1 ? last : fragments.dropLast().joined(separator: ", ") + " and " + last
      created.append(
        Activity(
          id: key, occurredAt: first["occurredAt"].plainText, issueKey: first["issueKey"].plainText,
          actor: first["actor"]["displayName"].string ?? "Someone", change: text))
    }
    return created.enumerated().sorted { a, b in
      a.element.occurredAt == b.element.occurredAt
        ? a.offset < b.offset : a.element.occurredAt < b.element.occurredAt
    }.map(\.element)
  }
  public static func changedTree(issues: [JSONValue], events: [JSONValue]) -> [IssueRow] {
    let changed = Set(events.compactMap { $0["issueId"].string })
    let ids = Set(issues.compactMap { $0["id"].string })
    var children: [String: [JSONValue]] = [:]
    var roots: [JSONValue] = []
    for issue in issues {
      if let parent = issue["parentId"].string, ids.contains(parent), parent != issue["id"].string {
        children[parent, default: []].append(issue)
      } else {
        roots.append(issue)
      }
    }
    func walk(_ values: [JSONValue], depth: Int, ancestors: Set<String>) -> [IssueRow] {
      values.sorted {
        $0["key"].plainText.compare($1["key"].plainText, options: .numeric) == .orderedAscending
      }.flatMap { issue -> [IssueRow] in
        let id = issue["id"].plainText
        guard !ancestors.contains(id) else { return [] }
        let descendants = walk(
          children[id] ?? [], depth: depth + 1, ancestors: ancestors.union([id]))
        guard changed.contains(id) || !descendants.isEmpty else { return [] }
        return [IssueRow(issue: issue, depth: depth)] + descendants
      }
    }
    return walk(roots, depth: 0, ancestors: [])
  }
}
