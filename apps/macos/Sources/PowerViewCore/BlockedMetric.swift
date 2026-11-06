import Foundation

/// Read-only port of the legacy report's dependency/status blocking calculation; no scheduling or Jira links are created.
public enum BlockedMetric {
  public static func calculate(
    _ issues: [JSONValue], blockedStatusNames: [String] = ["blocked", "impeded", "on hold"]
  ) -> Set<String> {
    var byKey: [String: JSONValue] = [:]
    var dependencies: [String: Set<String>] = [:]
    for issue in issues { if let key = issue["key"].string { byKey[key] = issue } }
    func add(dependent: String, prerequisite: String) {
      guard dependent != prerequisite, byKey[dependent] != nil, byKey[prerequisite] != nil else {
        return
      }
      dependencies[dependent, default: []].insert(prerequisite)
    }
    for issue in issues {
      let key = issue["key"].string ?? ""
      for link in issue["issueLinks"].array {
        let linked = link["linkedIssueKey"].string ?? ""
        switch link["semanticType"].string {
        case "is-blocked-by": add(dependent: key, prerequisite: linked)
        case "blocks": add(dependent: linked, prerequisite: key)
        case "depends-on", "finish-to-finish":
          if link["direction"].string == "outward" {
            add(dependent: key, prerequisite: linked)
          } else {
            add(dependent: linked, prerequisite: key)
          }
        default: break
        }
      }
    }
    let blockedNames = Set(
      blockedStatusNames.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
    return Set(
      issues.compactMap { issue in
        let key = issue["key"].string ?? ""
        let hasOpenPrerequisite = (dependencies[key] ?? []).contains {
          byKey[$0]?["status"]["category"].string != "done"
        }
        let flagged = blockedNames.contains(
          issue["status"]["name"].string?.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? "")
        return hasOpenPrerequisite || flagged ? issue["id"].string : nil
      })
  }
  public static func normalizeJiraLinks(_ raw: JSONValue) -> [JSONValue] {
    raw.array.compactMap { link in
      let outward = link["outwardIssue"] != .null
      let target = outward ? link["outwardIssue"] : link["inwardIssue"]
      guard let key = target["key"].string else { return nil }
      let phrase = link["type"][outward ? "outward" : "inward"].string ?? ""
      let value = ((link["type"]["name"].string ?? "") + " " + phrase + " " + phrase).lowercased()
      let semantic: String
      if value.contains("block")
        || value.range(of: "finish[- ]?start", options: .regularExpression) != nil
        || value.contains("done before") || value.contains("done after")
      {
        semantic = outward ? "blocks" : "is-blocked-by"
      } else if value.range(of: "finish[- ]?finish", options: .regularExpression) != nil
        || value.contains("finished together")
      {
        semantic = "finish-to-finish"
      } else if value.contains("duplicate") {
        semantic = outward ? "duplicates" : "is-duplicated-by"
      } else if value.contains("depend") {
        semantic = "depends-on"
      } else if value.contains("relate") {
        semantic = "relates-to"
      } else {
        semantic = "unknown"
      }
      return .object([
        "linkedIssueKey": .string(key), "direction": .string(outward ? "outward" : "inward"),
        "semanticType": .string(semantic),
      ])
    }
  }
}
