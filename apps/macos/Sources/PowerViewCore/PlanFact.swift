import Foundation

public struct StoryPlanFact: Equatable, Sendable {
  public let developmentPlannedSeconds: Double
  public let qaPlannedSeconds: Double
  public let developmentActualSeconds: Double?
  public let qaActualSeconds: Double?
  public init(story: Story, worklogSecondsByKey: [String: Double]) {
    developmentPlannedSeconds = story.developmentDays * 28_800
    qaPlannedSeconds = story.qaDays * 28_800
    let keys = story.development.compactMap(\.jiraKey)
    // Parent story worklogs are deliberately excluded; QA is identified by its stored Jira key.
    if keys.count == story.development.count, !keys.isEmpty,
      keys.allSatisfy({ worklogSecondsByKey[$0] != nil })
    {
      developmentActualSeconds = Set(keys).reduce(0) { $0 + (worklogSecondsByKey[$1] ?? 0) }
    } else {
      developmentActualSeconds = nil
    }
    qaActualSeconds = story.qaTask?.jiraKey.flatMap { worklogSecondsByKey[$0] }
  }
}
extension JiraClient {
  public func worklogTotalSeconds(_ key: String) async throws -> Double {
    try validate(key)
    var cursor = 0
    var total: Double = 0
    var seen: Set<String> = []
    for _ in 0..<1000 {
      let page: JSONValue = try await get(
        "/rest/api/3/issue/" + key + "/worklog",
        query: [
          .init(name: "startAt", value: String(cursor)), .init(name: "maxResults", value: "100"),
        ])
      guard let count = page["total"].number, page["startAt"].number == Double(cursor),
        case .array(let logs) = page["worklogs"]
      else { throw JiraError.unexpectedResponse }
      for log in logs {
        guard let id = log["id"].identifier, let seconds = log["timeSpentSeconds"].number,
          seconds >= 0
        else { throw JiraError.unexpectedResponse }
        if seen.insert(id).inserted { total += seconds }
      }
      if Double(cursor + logs.count) >= count { return total }
      guard !logs.isEmpty else { throw JiraError.paginationIncomplete }
      cursor += logs.count
    }
    throw JiraError.paginationIncomplete
  }
}
