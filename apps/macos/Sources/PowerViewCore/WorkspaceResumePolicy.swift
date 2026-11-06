import Foundation

/// A saved board may reconnect only to its own Jira instance.
public enum WorkspaceResumePolicy {
  public static let pages = ["Workspace", "Timesheet", "Reports", "Gantt", "Status", "Estimation"]
  public static func page(_ saved: String?) -> String {
    guard let saved, pages.contains(saved) else { return "Workspace" }
    return saved
  }
  public static func mayReconnect(savedOrigin: String, workspaceOrigin: String?) -> Bool {
    guard let saved = normalized(savedOrigin) else { return false }
    guard let workspaceOrigin else { return true }
    return normalized(workspaceOrigin) == saved
  }
  private static func normalized(_ value: String) -> String? {
    guard let url = URL(string: value), let host = url.host,
      ["https", "http"].contains(url.scheme?.lowercased() ?? "")
    else { return nil }
    let scheme = url.scheme!.lowercased()
    let port = url.port ?? (scheme == "https" ? 443 : 80)
    let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return "\(scheme)://\(host.lowercased()):\(port)/\(path)"
  }
}
