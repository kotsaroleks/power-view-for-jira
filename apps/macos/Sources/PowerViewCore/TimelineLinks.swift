import Foundation

public enum TimelineLinkKind: String, Codable, CaseIterable, Sendable { case FS, SS, FF, SF }
public struct TimelineLink: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let predecessor: String
  public let successor: String
  public let kind: TimelineLinkKind
  public let lagWorkingDays: Int?
  public init(
    predecessor: String, successor: String, kind: TimelineLinkKind, id: String = UUID().uuidString,
    lagWorkingDays: Int? = nil
  ) {
    self.id = id
    self.predecessor = predecessor
    self.successor = successor
    self.kind = kind
    self.lagWorkingDays = lagWorkingDays
  }
}
public enum TimelineLinks {
  public static func validate(
    _ link: TimelineLink, existing: [TimelineLink], issues: [WorkspaceIssue],
    plans: [String: LocalIssuePlan]
  ) -> String? {
    let keys = Set(issues.map(\.key))
    guard link.predecessor != link.successor, keys.contains(link.predecessor),
      keys.contains(link.successor)
    else { return "Choose two different issues on this board." }
    guard
      !existing.contains(where: {
        $0.predecessor == link.predecessor && $0.successor == link.successor && $0.kind == link.kind
      })
    else { return "This dependency already exists." }
    var graph: [String: Set<String>] = [:]
    for issue in issues {
      for key in plans[issue.key]?.dependencies ?? issue.dependencies {
        graph[key, default: []].insert(issue.key)
      }
    }
    for edge in existing { graph[edge.predecessor, default: []].insert(edge.successor) }
    var seen: Set<String> = []
    func reachesPredecessor(_ key: String) -> Bool {
      if key == link.predecessor { return true }
      guard seen.insert(key).inserted else { return false }
      return (graph[key] ?? []).contains(where: reachesPredecessor)
    }
    return reachesPredecessor(link.successor) ? "This dependency would create a cycle." : nil
  }
  public static func conflicts(_ links: [TimelineLink], schedule: [String: TimelineScheduleEntry])
    -> [String]
  {
    links.compactMap { link in
      guard let previous = schedule[link.predecessor], let next = schedule[link.successor],
        previous.state != "unscheduled", next.state != "unscheduled"
      else { return nil }
      let broken: Bool
      switch link.kind {
      case .FS: broken = next.start <= previous.end
      case .SS: broken = next.start < previous.start
      case .FF: broken = next.end < previous.end
      case .SF: broken = next.end < previous.start
      }
      return broken
        ? "\(link.predecessor) → \(link.successor) (\(link.kind.rawValue)): dates conflict with this dependency."
        : nil
    }
  }
}
public struct TimelinePreferences: Codable, Equatable, Sendable {
  public var search = ""
  public var hideDone = true
  public var sort = TimelineSort.rank
  public var ascending = true
  public var dayWidth = 10.0
  public var showDependencies = true
  public var collapsed: [String] = []
  public var nonWorkingDays: [Int]?
  public var defaultDurations: [String: Double]?
  public init() {}
}
