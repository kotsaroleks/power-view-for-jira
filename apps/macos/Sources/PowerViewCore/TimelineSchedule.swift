import Foundation

public struct TimelineScheduleEntry: Codable, Equatable, Sendable {
  public let start: String
  public let end: String
  public let state: String
  public let startSource: String
  public let endSource: String
  public let progress: Double
  public let progressSource: String
  public let warnings: [String]
  public var isInferred: Bool { !["confirmed", "milestone", "local"].contains(state) }
}
/// Date resolution and progress rules ported from the existing domain/schedule.ts.
/// Forecasts are explicit; an issue without either date stays unscheduled.
public enum TimelineSchedule {
  private static let calendar: Calendar = {
    var value = Calendar(identifier: .gregorian)
    value.timeZone = TimeZone(secondsFromGMT: 0)!
    return value
  }()
  public static func build(
    issues: [WorkspaceIssue], plans: [String: LocalIssuePlan] = [:],
    today: String = TimelineDates.string(Date()), nonWorkingDays: Set<Int> = [0, 6],
    defaultDurations: [String: Double] = [:]
  ) -> [String: TimelineScheduleEntry] {
    let lookup = Dictionary(uniqueKeysWithValues: issues.map { ($0.key, $0) })
    var parents = Dictionary(
      uniqueKeysWithValues: issues.compactMap { issue -> (String, String)? in
        guard let parent = issue.parentKey, parent != issue.key, lookup[parent] != nil else {
          return nil
        }
        return (issue.key, parent)
      })
    var cycles = Set(issues.filter { $0.parentKey == $0.key }.map(\.key))
    for issue in issues {
      var chain: [String] = []
      var positions: [String: Int] = [:]
      var current: String? = issue.key
      while let key = current {
        if let index = positions[key] {
          cycles.formUnion(chain[index...])
          break
        }
        positions[key] = chain.count
        chain.append(key)
        current = parents[key]
      }
    }
    for key in cycles { parents[key] = nil }
    let children = Dictionary(
      grouping: issues.filter { parents[$0.key] != nil }, by: { parents[$0.key]! })
    let safeToday =
      TimelineDates.parse(today).map(TimelineDates.string) ?? TimelineDates.string(Date())
    let excluded = Set(nonWorkingDays.filter { (0...6).contains($0) })
    let working = excluded.count == 7 ? Set([0, 6]) : excluded
    var resolved: [String: TimelineScheduleEntry] = [:]
    func resolve(_ issue: WorkspaceIssue) -> TimelineScheduleEntry {
      if let cached = resolved[issue.key] { return cached }
      let childIssues = children[issue.key] ?? []
      let childValues = childIssues.map(resolve)
      let scheduled = childValues.filter { $0.state != "unscheduled" }
      let local = plans[issue.key]
      let rawStart = local == nil ? issue.start : local?.start
      let rawEnd = local == nil ? issue.due : local?.due
      let explicitStart = TimelineDates.parse(rawStart).map(TimelineDates.string)
      let explicitEnd = TimelineDates.parse(rawEnd).map(TimelineDates.string)
      let rollupStart = scheduled.map(\.start).min()
      let rollupEnd = scheduled.map(\.end).max()
      let estimate =
        issue.estimateSeconds.map { $0 / 28_800 }
        ?? defaultDuration(issue, overrides: defaultDurations)
      let duration = estimate.isFinite ? max(1, Int(ceil(min(36_600, max(0, estimate))))) : 3
      var start = rollupStart ?? explicitStart ?? explicitEnd ?? safeToday
      var end = rollupEnd ?? explicitEnd ?? explicitStart ?? safeToday
      var startSource =
        rollupStart != nil
        ? "children" : explicitStart != nil ? (local == nil ? "jira" : "local") : "today"
      var endSource =
        rollupEnd != nil
        ? "children" : explicitEnd != nil ? (local == nil ? "jira" : "local") : "default-duration"
      var state =
        rollupStart != nil
        ? "rollup"
        : explicitStart != nil && explicitEnd != nil
          ? (local != nil
            ? "local" : explicitStart == explicitEnd && estimate == 0 ? "milestone" : "confirmed")
          : explicitStart != nil ? "planned" : explicitEnd != nil ? "forecast" : "unscheduled"
      var warnings: [String] = []
      if rawStart != nil && explicitStart == nil { warnings.append("INVALID_START_DATE") }
      if rawEnd != nil && explicitEnd == nil { warnings.append("INVALID_END_DATE") }
      if cycles.contains(issue.key) { warnings.append("HIERARCHY_CYCLE") }
      if state == "planned" { end = addWorkingDays(start, days: duration - 1, excluding: working) }
      if state == "forecast" {
        start = addWorkingDays(end, days: -(duration - 1), excluding: working)
        startSource = "today"
      }
      if !scheduled.isEmpty
        && ((explicitStart != nil && explicitStart != rollupStart)
          || (explicitEnd != nil && explicitEnd != rollupEnd))
      {
        warnings.append("PARENT_DATE_MISMATCH")
      }
      if state != "unscheduled" && end < start {
        end = addWorkingDays(start, days: duration - 1, excluding: working)
        endSource = "corrected"
        state = "planned"
        warnings.append("END_BEFORE_START")
      }
      let progress: Double
      let source: String
      if issue.progressSource == "jira-progress",
        let value = validProgress(issue.progressPercentage)
      {
        progress = value.rounded()
        source = "jira-progress"
      } else {
        let subtasks = childIssues.enumerated().filter { $0.element.isSubtask == true }
        if !subtasks.isEmpty {
          let done = subtasks.filter {
            $0.element.category == "done" || childValues[$0.offset].progress == 100
          }.count
          progress = (Double(done) / Double(subtasks.count) * 100).rounded()
          source = "subtasks"
        } else if issue.progressSource == "subtasks",
          let value = validProgress(issue.progressPercentage)
        {
          progress = value.rounded()
          source = "subtasks"
        } else if !childValues.isEmpty {
          let weighted = childValues.map { child -> (Double, Double) in
            let duration = max(
              1,
              TimelineDates.dayOffset(
                TimelineDates.parse(child.end)!, from: TimelineDates.parse(child.start)!))
            return (Double(duration), child.progress)
          }
          progress = (weighted.reduce(0) { $0 + $1.0 * $1.1 } / weighted.reduce(0) { $0 + $1.0 })
            .rounded()
          source = "children"
        } else if let value = validProgress(issue.progressPercentage) {
          progress = value.rounded()
          source = issue.progressSource ?? "none"
        } else {
          progress =
            issue.category == "done"
            ? 100 : ["in-progress", "indeterminate"].contains(issue.category) ? 50 : 0
          source = issue.category == "unknown" ? "none" : "status"
        }
      }
      let entry = TimelineScheduleEntry(
        start: start, end: end, state: state, startSource: startSource, endSource: endSource,
        progress: progress, progressSource: source, warnings: warnings)
      resolved[issue.key] = entry
      return entry
    }
    for issue in issues { _ = resolve(issue) }
    return resolved
  }
  private static func validProgress(_ value: Double?) -> Double? {
    guard let value, value.isFinite, value >= 0, value <= 100 else { return nil }
    return value
  }
  private static func defaultDuration(_ issue: WorkspaceIssue, overrides: [String: Double])
    -> Double
  {
    let name =
      issue.issueTypeName?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    let kind =
      issue.isSubtask == true
      ? "subtask"
      : name.contains("epic")
        ? "epic"
        : name.contains("story")
          ? "story"
          : name.contains("bug")
            ? "bug" : (name == "task" || name.hasSuffix(" task")) ? "task" : "unknown"
    let fallback: Double = kind == "subtask" ? 1 : kind == "epic" ? 10 : kind == "story" ? 5 : 3
    guard let value = overrides[kind], value.isFinite, value >= 1, value <= 365 else {
      return fallback
    }
    return value
  }
  private static func addWorkingDays(_ start: String, days: Int, excluding: Set<Int>) -> String {
    var value = TimelineDates.parse(start)!
    let step = days >= 0 ? 1.0 : -1.0
    var remaining = abs(days)
    while remaining > 0 {
      value.addTimeInterval(step * 86_400)
      if !excluding.contains(calendar.component(.weekday, from: value) - 1) { remaining -= 1 }
    }
    return TimelineDates.string(value)
  }
}
