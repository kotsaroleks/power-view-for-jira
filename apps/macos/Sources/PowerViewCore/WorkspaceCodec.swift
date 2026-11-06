import Foundation

public enum WorkspaceCodec {
  public static func decode(_ data: Data) throws -> WorkspaceSnapshot {
    guard data.count <= 20 * 1024 * 1024 else { throw ExcelError.tooLarge }
    if let native = try? JSONDecoder().decode(WorkspaceSnapshot.self, from: data) {
      guard Set(native.issues.map(\.key)).count == native.issues.count else {
        throw JiraError.unexpectedResponse
      }
      return native
    }
    let root = try JSONDecoder().decode(JSONValue.self, from: data)
    guard let id = root["board"]["id"].identifier, let name = root["board"]["name"].string,
      case .array(let entries) = root["issues"]
    else { throw JiraError.unexpectedResponse }
    var rawIssues: [JSONValue] = []
    var dependencies: [String: Set<String>] = [:]
    var kinds: [String: [String: TimelineLinkKind]] = [:]
    for entry in entries {
      guard let key = entry["key"].string else { throw JiraError.unexpectedResponse }
      if entry["fields"] != .null {
        rawIssues.append(entry)
        continue
      }
      let category = entry["status"]["category"].string ?? "unknown"
      let jiraCategory =
        category == "to-do" ? "new" : category == "in-progress" ? "indeterminate" : category
      let parent = entry["parentKey"].string ?? entry["epicKey"].string
      var fields: [String: JSONValue] = [
        "summary": entry["summary"],
        "status": .object([
          "id": entry["status"]["id"], "name": entry["status"]["name"],
          "statusCategory": .object(["key": .string(jiraCategory)]),
        ]),
        "assignee": entry["assignee"], "customfield_10015": entry["startDate"],
        "issuetype": entry["issueType"], "normalizedProgress": entry["progress"],
        "duedate": entry["dueDate"],
        "timeoriginalestimate": entry["originalEstimateSeconds"],
      ]
      if let parent { fields["parent"] = .object(["key": .string(parent)]) }
      rawIssues.append(.object(["key": .string(key), "fields": .object(fields)]))
      for link in entry["issueLinks"].array {
        guard let target = link["linkedIssueKey"].string else { continue }
        switch link["semanticType"].string {
        case "is-blocked-by":
          dependencies[key, default: []].insert(target)
          kinds[key, default: [:]][target] = .FS
        case "blocks":
          dependencies[target, default: []].insert(key)
          kinds[target, default: [:]][key] = .FS
        case "depends-on", "finish-to-finish":
          if link["direction"].string == "outward" {
            dependencies[key, default: []].insert(target)
            kinds[key, default: [:]][target] =
              link["semanticType"].string == "finish-to-finish" ? .FF : .FS
          } else {
            dependencies[target, default: []].insert(key)
            kinds[target, default: [:]][key] =
              link["semanticType"].string == "finish-to-finish" ? .FF : .FS
          }
        default: break
        }
      }
    }
    let issues = try rawIssues.map { original -> WorkspaceIssue in
      guard case .object(var raw) = original, case .object(var fields) = raw["fields"],
        let key = raw["key"]?.string
      else { throw JiraError.unexpectedResponse }
      if let previous = dependencies[key] {
        fields["normalizedDependencyKinds"] = .object(
          (kinds[key] ?? [:]).mapValues { .string($0.rawValue) })
        fields["issuelinks"] = .array(
          previous.sorted().map { target in
            .object([
              "type": .object(["inward": .string("is blocked by")]),
              "inwardIssue": .object(["key": .string(target)]),
            ])
          })
      }
      raw["fields"] = .object(fields)
      return try WorkspaceIssue(raw: .object(raw))
    }
    guard Set(issues.map(\.key)).count == issues.count else { throw JiraError.unexpectedResponse }
    return .init(boardID: id, boardName: name, jql: root["jql"].string ?? "", issues: issues)
  }
  public static func encode(_ snapshot: WorkspaceSnapshot) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return try encoder.encode(snapshot)
  }
}
