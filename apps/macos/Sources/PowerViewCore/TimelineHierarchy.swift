import Foundation

public enum TimelineSort: String, Codable, CaseIterable, Sendable {
  case rank, key, start, assignee, due, name, status
}
public struct TimelineRow: Identifiable, Equatable, Sendable {
  public var id: String { issue.key }
  public let issue: WorkspaceIssue
  public let depth: Int
}
public enum TimelineHierarchy {
  public static func rows(
    issues: [WorkspaceIssue], plans: [String: LocalIssuePlan], collapsed: Set<String>,
    query: String, hideDone: Bool, sort: TimelineSort, ascending: Bool = true,
    resolved: [String: TimelineScheduleEntry] = [:]
  ) -> [TimelineRow] {
    let lookup = Dictionary(uniqueKeysWithValues: issues.map { ($0.key, $0) })
    let order = Dictionary(
      uniqueKeysWithValues: issues.enumerated().map { ($0.element.key, $0.offset) })
    func category(_ issue: WorkspaceIssue) -> Int {
      switch issue.category {
      case "new", "to-do": return 1
      case "indeterminate", "in-progress": return 2
      case "done": return 3
      default: return 0
      }
    }
    func value(_ issue: WorkspaceIssue) -> String {
      switch sort {
      case .rank, .key: return issue.key
      case .start: return resolved[issue.key]?.start ?? plans[issue.key]?.start ?? issue.start ?? ""
      case .due: return resolved[issue.key]?.end ?? plans[issue.key]?.due ?? issue.due ?? ""
      case .assignee: return issue.assignee ?? ""
      case .name: return issue.title
      case .status: return issue.status
      }
    }
    func compare(_ a: WorkspaceIssue, _ b: WorkspaceIssue) -> Bool {
      if sort == .rank { return (order[a.key] ?? 0) < (order[b.key] ?? 0) }
      if sort == .status, category(a) != category(b) {
        return ascending ? category(a) < category(b) : category(a) > category(b)
      }
      let left =
        sort == .status ? value(a) : value(a).trimmingCharacters(in: .whitespacesAndNewlines)
      let right =
        sort == .status ? value(b) : value(b).trimmingCharacters(in: .whitespacesAndNewlines)
      let leftEmpty = left.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      let rightEmpty = right.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      if leftEmpty != rightEmpty { return ascending ? !leftEmpty : leftEmpty }
      let options: String.CompareOptions =
        [.name, .status, .assignee].contains(sort) ? [.caseInsensitive, .diacriticInsensitive] : []
      let result =
        leftEmpty
        ? ComparisonResult.orderedSame : left.compare(right, options: options, locale: .current)
      if result == .orderedSame {
        return ascending
          ? (order[a.key] ?? 0) < (order[b.key] ?? 0) : (order[a.key] ?? 0) > (order[b.key] ?? 0)
      }
      return ascending ? result == .orderedAscending : result == .orderedDescending
    }
    var children: [String: [WorkspaceIssue]] = [:]
    var roots: [WorkspaceIssue] = []
    for issue in issues {
      if let parent = issue.parentKey, lookup[parent] != nil, parent != issue.key {
        children[parent, default: []].append(issue)
      } else {
        roots.append(issue)
      }
    }
    var visited = Set<String>()
    var ordered: [TimelineRow] = []
    func visit(_ issue: WorkspaceIssue, depth: Int, hidden: Bool) {
      guard visited.insert(issue.key).inserted else { return }
      if !hidden { ordered.append(.init(issue: issue, depth: depth)) }
      for child in (children[issue.key] ?? []).sorted(by: compare) {
        visit(child, depth: depth + 1, hidden: hidden || collapsed.contains(issue.key))
      }
    }
    for issue in roots.sorted(by: compare) { visit(issue, depth: 0, hidden: false) }
    for issue in issues where !visited.contains(issue.key) { visit(issue, depth: 0, hidden: false) }
    let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return ordered.filter { row in
      (!hideDone || row.issue.category != "done")
        && (search.isEmpty
          || (row.issue.key + " " + row.issue.title + " " + (row.issue.assignee ?? ""))
            .localizedCaseInsensitiveContains(search))
    }
  }
}
