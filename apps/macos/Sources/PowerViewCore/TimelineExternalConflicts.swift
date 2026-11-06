import Foundation

public struct TimelineExternalConflict: Equatable, Identifiable, Sendable {
  public var id: String { issueKey }
  public let issueKey: String
  public let repairUpdates: [TimelineCascade.Update]
}
public enum TimelineExternalConflicts {
  /// The accepted dates are comparison baselines, never local overrides of current Jira dates.
  public static func find(
    schedule: [String: TimelineScheduleEntry], order: [String], links: [TimelineLink],
    reconciled: [String: LocalIssuePlan], nonWorkingDays: Set<Int> = [0, 6]
  ) throws -> [TimelineExternalConflict] {
    let predecessors = Set(links.map(\.predecessor))
    var result: [TimelineExternalConflict] = []
    for (key, expected) in reconciled.sorted(by: { $0.key < $1.key })
    where predecessors.contains(key) {
      guard let current = schedule[key], current.state != "unscheduled",
        expected.start != current.start || expected.due != current.end
      else { continue }
      let updates = try TimelineCascade.plan(
        schedule: schedule, order: order, links: links, changedKey: key, start: current.start,
        end: current.end, nonWorkingDays: nonWorkingDays
      ).filter { $0.source == "cascade" }
      if !updates.isEmpty { result.append(.init(issueKey: key, repairUpdates: updates)) }
    }
    return result
  }
}
