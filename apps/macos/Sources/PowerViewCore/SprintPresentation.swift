import Foundation

public enum SprintPresentation {
  public static func owner(_ issue: JSONValue) -> String {
    let user = issue["assignee"]
    return user["accountId"].string ?? user["username"].string ?? user["id"].string
      ?? user["displayName"].string ?? "__unassigned__"
  }
  public static func category(
    _ issue: JSONValue, completedIDs: [JSONValue], completedNames: [JSONValue]
  ) -> String {
    if (issue["status"]["id"] != .null && completedIDs.contains(issue["status"]["id"]))
      || completedNames.contains(issue["status"]["name"])
    {
      return "done"
    }
    return issue["status"]["category"].string ?? "unknown"
  }
}
