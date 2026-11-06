import Foundation

public enum WorkspaceReportMapping {
  public static func sprints(_ value: JSONValue) -> [JSONValue] {
    let values: [JSONValue] = value == .null ? [] : value.array.isEmpty ? [value] : value.array
    var mapped: [String: JSONValue] = [:]
    var order: [String] = []
    for candidate in values {
      var object = candidate.object
      if let text = candidate.string {
        let pattern = try! NSRegularExpression(pattern: "\\[([^\\]]+)]")
        guard
          let match = pattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let range = Range(match.range(at: 1), in: text)
        else { continue }
        let details = String(text[range])
        let delimiter = try! NSRegularExpression(pattern: ",(?=[A-Za-z][A-Za-z0-9]*=)")
        let parts = delimiter.stringByReplacingMatches(
          in: details, range: NSRange(details.startIndex..., in: details), withTemplate: "\u{1f}"
        ).split(separator: "\u{1f}")
        object = [:]
        for part in parts {
          guard let equal = part.firstIndex(of: "=") else { continue }
          object[String(part[..<equal])] = .string(String(part[part.index(after: equal)...]))
        }
      }
      guard let id = object["id"]?.identifier, let name = object["name"]?.string, !id.isEmpty,
        !name.isEmpty
      else { continue }
      let state = object["state"]?.string?.lowercased() ?? "unknown"
      var result: [String: JSONValue] = [
        "id": .string(id), "name": .string(name),
        "state": .string(["active", "future", "closed"].contains(state) ? state : "unknown"),
      ]
      if let board = object["boardId"]?.identifier ?? object["rapidViewId"]?.identifier {
        result["boardId"] = .string(board)
      }
      for key in ["startDate", "endDate", "completeDate"] {
        if let value = object[key]?.string, !value.isEmpty { result[key] = .string(value) }
      }
      if mapped[id] == nil { order.append(id) }
      mapped[id] = .object(result)
    }
    return order.compactMap { mapped[$0] }
  }
  public static func normalized(_ issue: WorkspaceIssue, mapping: [String: String]) -> JSONValue {
    let fields = issue.rawSource?["fields"] ?? .null
    let category =
      issue.category == "new"
      ? "to-do" : issue.category == "indeterminate" ? "in-progress" : issue.category
    var value: [String: JSONValue] = [
      "id": issue.rawSource?["id"] ?? .string(issue.key), "key": .string(issue.key),
      "summary": .string(issue.title),
      "status": .object([
        "id": .string(issue.statusID), "name": .string(issue.status), "category": .string(category),
      ]), "issueType": fields["issuetype"],
    ]
    if let id = issue.assigneeID {
      value["assignee"] = .object([
        "id": .string(id), "accountId": .string(id), "displayName": .string(issue.assignee ?? id),
      ])
    } else if let name = issue.assignee {
      value["assignee"] = .object(["displayName": .string(name)])
    }
    for (from, to) in [
      ("created", "createdAt"), ("updated", "updatedAt"), ("resolutiondate", "resolvedAt"),
    ] { if let text = fields[from].string { value[to] = .string(text) } }
    if let key = mapping["storyPointsFieldId"], let points = fields[key].number {
      value["storyPoints"] = .number(points)
    }
    let sprintField = mapping["sprintFieldId"] ?? "sprint"
    value["sprints"] = .array(sprints(fields[sprintField]))
    value["sprintIds"] = .array(sprints(fields[sprintField]).map { $0["id"] })
    if let seconds = issue.estimateSeconds { value["originalEstimateSeconds"] = .number(seconds) }
    if let seconds = fields["timetracking"]["timeSpentSeconds"].number ?? fields["timespent"].number
    {
      value["timeSpentSeconds"] = .number(seconds)
    }
    if let parent = issue.parentKey { value["parentKey"] = .string(parent) }
    return .object(value)
  }
}
