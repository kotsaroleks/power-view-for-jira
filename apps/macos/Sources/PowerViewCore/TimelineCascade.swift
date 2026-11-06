import Foundation

/// Port of gantt-v2/cascade-schedule.ts. Plans changes first; transport is separate.
public enum TimelineCascade {
  public struct Update: Codable, Equatable, Sendable {
    public let issueKey: String
    public let startDate: String
    public let dueDate: String
    public let source: String
  }
  public enum Failure: Error { case cycle, missingTask, invalidDates }
  public static func plan(
    schedule: [String: TimelineScheduleEntry], order: [String], links: [TimelineLink],
    changedKey: String, start: String, end: String, nonWorkingDays: Set<Int> = [0, 6]
  ) throws -> [Update] {
    guard schedule[changedKey] != nil else { throw Failure.missingTask }
    guard let a = TimelineDates.parse(start), let b = TimelineDates.parse(end), a <= b else {
      throw Failure.invalidDates
    }
    let excluded = Set(nonWorkingDays.filter { (0...6).contains($0) })
    let days = excluded.count == 7 ? Set([0, 6]) : excluded
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    func working(_ date: Date) -> Bool {
      !days.contains(calendar.component(.weekday, from: date) - 1)
    }
    func shift(_ value: String, _ delta: Int) -> String {
      var date = TimelineDates.parse(value)!
      var remaining = abs(delta)
      while remaining > 0 {
        date.addTimeInterval(delta < 0 ? -86400 : 86400)
        if working(date) { remaining -= 1 }
      }
      return TimelineDates.string(date)
    }
    func next(_ value: String) -> String {
      var date = TimelineDates.parse(value)!
      while !working(date) { date.addTimeInterval(86400) }
      return TimelineDates.string(date)
    }
    func duration(_ entry: TimelineScheduleEntry) -> Int {
      guard var date = TimelineDates.parse(entry.start), let last = TimelineDates.parse(entry.end)
      else { return 1 }
      var total = 0
      while date <= last {
        if working(date) { total += 1 }
        date.addTimeInterval(86400)
      }
      return max(1, total)
    }
    var incoming: [String: [TimelineLink]] = [:]
    var outgoing: [String: [String]] = [:]
    var indegree = Dictionary(uniqueKeysWithValues: schedule.keys.map { ($0, 0) })
    for link in links {
      incoming[link.successor, default: []].append(link)
      outgoing[link.predecessor, default: []].append(link.successor)
      if schedule[link.predecessor] != nil && schedule[link.successor] != nil {
        indegree[link.successor, default: 0] += 1
      }
    }
    var queue = order.filter { indegree[$0] == 0 }
    queue += schedule.keys.sorted().filter { !order.contains($0) && indegree[$0] == 0 }
    var topological: [String] = []
    while !queue.isEmpty {
      let key = queue.removeFirst()
      topological.append(key)
      for successor in outgoing[key] ?? [] where indegree[successor] != nil {
        indegree[successor]! -= 1
        if indegree[successor] == 0 { queue.append(successor) }
      }
    }
    guard topological.count == schedule.count else { throw Failure.cycle }
    var reachable: Set<String> = []
    var pending = [changedKey]
    while !pending.isEmpty {
      for successor in outgoing[pending.removeFirst()] ?? []
      where reachable.insert(successor).inserted { pending.append(successor) }
    }
    var planned = schedule.mapValues { ($0.start, $0.end) }
    planned[changedKey] = (start, end)
    var updates = [Update(issueKey: changedKey, startDate: start, dueDate: end, source: "direct")]
    for key in topological where reachable.contains(key) {
      guard let entry = schedule[key], let current = planned[key] else { continue }
      var requiredStart: String?
      var requiredEnd: String?
      for link in incoming[key] ?? [] {
        guard let previous = planned[link.predecessor] else { continue }
        let lag = link.lagWorkingDays ?? 0
        let anchor = link.kind == .FS || link.kind == .FF ? previous.1 : previous.0
        let boundary = next(shift(anchor, lag + (link.kind == .FS ? 1 : 0)))
        if link.kind == .FS || link.kind == .SS {
          requiredStart = max(requiredStart ?? boundary, boundary)
        } else {
          requiredEnd = max(requiredEnd ?? boundary, boundary)
        }
      }
      let length = duration(entry)
      var from = current.0
      var to = current.1
      if let requiredStart, from < requiredStart {
        from = requiredStart
        to = shift(from, length - 1)
      }
      if let requiredEnd, to < requiredEnd {
        to = requiredEnd
        from = shift(to, -(length - 1))
      }
      if from == current.0 && to == current.1 { continue }
      planned[key] = (from, to)
      updates.append(.init(issueKey: key, startDate: from, dueDate: to, source: "cascade"))
    }
    return updates
  }
}
