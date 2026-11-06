import Foundation

/// Swift port of the Chrome printable report template; CSS is copied from the same product.
public enum ReportHTML {
  public static func build(_ snapshot: JSONValue, language: String, css: String) -> String {
    func e(_ value: String) -> String {
      value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }
    func text(_ value: JSONValue) -> String { e(value.plainText) }
    func date(_ value: JSONValue) -> String { e(ReportPresentation.formatDate(value.plainText)) }
    func hours(_ value: JSONValue) -> String {
      String(
        format: "%.1fh", (((value.number ?? 0) / 3600) * 10).rounded(.toNearestOrAwayFromZero) / 10)
    }
    let result = snapshot["result"]
    let summary = result["executiveSummary"]
    let isSprint = snapshot["request"]["type"].string == "sprint"
    var metrics: [(String, String, String, String)] = [
      (
        "Issues in scope", summary["totalIssues"].plainText,
        summary["incompleteIssues"].plainText + " still open", ""
      ),
      (
        "Completed",
        (isSprint ? summary["completedIssues"] : summary["completedDuringPeriod"]).plainText,
        summary["completedIssues"].plainText + " completed in scope", "report-metric-success"
      ),
      ("Created", summary["createdIssues"].plainText, "Added during this period", ""),
      ("Worklog", hours(summary["worklogSeconds"]), "Logged during this period", ""),
      (
        "Unassigned", summary["unassignedIssues"].plainText, "Issues without an owner",
        (summary["unassignedIssues"].number ?? 0) > 0 ? "report-metric-warning" : ""
      ),
    ]
    if isSprint {
      metrics[2] = (
        "Sprint completion",
        (result["sprint"]["completion"]["percentage"].number.map { String(format: "%.1f%%", $0) }
          ?? "Unavailable"), result["sprint"]["completion"]["unit"].plainText, ""
      )
    }
    let kpis = metrics.map {
      "<article class=\"report-metric \($0.3)\"><span>\(e($0.0))</span><strong>\(e($0.1))</strong><small>\(e($0.2))</small></article>"
    }.joined()
    let inputIssues =
      snapshot["issues"].array.isEmpty
      ? result["people"].array.flatMap { $0["assignedIssues"].array }
        + result["unassigned"]["issues"].array : snapshot["issues"].array
    let scope = snapshot["request"]["scope"]
    let issues =
      scope["kind"].string == "assignee"
      ? inputIssues.filter { $0["assignee"]["id"] == scope["userId"] } : inputIssues
    let events = result["activity"].array
    let changed = Set(events.map { $0["issueId"].plainText })
    let rows = ReportPresentation.changedTree(issues: issues, events: events)
    let log = Dictionary(grouping: ReportPresentation.activity(events), by: \.issueKey)
    func finished(_ issue: JSONValue) -> Bool {
      SprintPresentation.category(
        issue, completedIDs: snapshot["statusMapping"]["completedStatusIds"].array,
        completedNames: snapshot["statusMapping"]["completedStatusNames"].array) == "done"
    }
    func link(_ issue: JSONValue) -> String {
      let origin = snapshot["jira"]["baseUrl"].plainText.trimmingCharacters(
        in: CharacterSet(charactersIn: "/"))
      let raw = issue["browseUrl"].string ?? origin + "/browse/" + issue["key"].plainText
      guard let url = URL(string: raw), ["https", "http"].contains(url.scheme ?? "") else {
        return "#"
      }
      return e(raw)
    }
    var index = 0
    func tree(_ depth: Int) -> String {
      var html = "<ul class=\"\(depth == 0 ? "report-issue-tree" : "report-issue-tree-children")\">"
      while index < rows.count && rows[index].depth == depth {
        let issue = rows[index].issue
        index += 1
        let type = issue["issueType"]["name"].plainText
        let normalized = type.lowercased()
        let accent =
          normalized.contains("story")
          ? "report-issue-tree-type-story"
          : (normalized.contains("sub-task") || normalized.contains("subtask"))
            ? "report-issue-tree-type-subtask"
            : normalized.contains("bug")
              ? "report-issue-tree-type-bug"
              : normalized.contains("task")
                ? "report-issue-tree-type-task" : "report-issue-tree-type-other"
        let context = changed.contains(issue["id"].plainText) ? "" : "report-issue-tree-row-context"
        html +=
          "<li\(depth == 0 ? " class=\"report-issue-tree-root\"" : "")><div class=\"report-issue-tree-row \(context)\"><span class=\"report-issue-tree-type \(accent)\">\(e(type))</span><a class=\"report-issue-tree-key\" href=\"\(link(issue))\">\(text(issue["key"]))</a><span class=\"report-issue-tree-summary\">\(text(issue["summary"]))</span><span class=\"report-issue-tree-status \(finished(issue) ? "report-issue-tree-status-done" : "")\">\(text(issue["status"]["name"]))</span>"
        if issue["assignee"] != .null {
          html +=
            "<span class=\"report-issue-tree-assignee\">\(text(issue["assignee"]["displayName"]))</span>"
        }
        html += "</div>"
        let entries = log[issue["key"].plainText] ?? []
        if !entries.isEmpty {
          html +=
            "<table class=\"report-issue-tree-changes\"><thead><tr><th>Time</th><th>Who did the change</th><th>What changed</th></tr></thead><tbody>"
          for item in entries {
            html +=
              "<tr><td>\(e(ReportPresentation.formatDate(item.occurredAt)))</td><td>\(e(item.actor))</td><td>\(e(item.change))</td></tr>"
          }
          html += "</tbody></table>"
        }
        if index < rows.count && rows[index].depth > depth { html += tree(rows[index].depth) }
        html += "</li>"
      }
      return html + "</ul>"
    }
    let issueTree =
      rows.isEmpty
      ? "<div class=\"report-unavailable\"><strong>No issues changed</strong><p>There were no tracked changes in this period.</p></div>"
      : tree(0)
    var people = ""
    for person in result["people"].array {
      people +=
        "<div class=\"people-report-row\"><strong>\(text(person["user"]["displayName"]))</strong><span>\(person["assignedIssues"].array.count)</span><span>\(person["completedIssues"].array.count)</span><span>\(hours(person["worklogSeconds"]))</span></div>"
    }
    people +=
      "<div class=\"people-report-row\"><strong>Unassigned</strong><span>\(result["unassigned"]["issues"].array.count)</span><span>—</span><span>—</span></div>"
    let title =
      text(snapshot["board"]["name"]) + " · " + text(snapshot["request"]["type"]).uppercased()
    let warnings = snapshot["completeness"]["warnings"].array.map {
      "<p class=\"report-warning\">\(text($0["message"]))</p>"
    }.joined()
    return """
      <!doctype html><html lang="\(e(language))"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>\(text(snapshot["board"]["name"])) report</title><style>\(css)
      body { padding: 32px; max-width: 960px; margin: 0 auto; background: white; } @media print { body { padding: 0; } .report-metric, tr, .people-report-row { break-inside: avoid; } }
      .report-issue-tree { max-height: none; overflow: visible; } .people-report-table { overflow: visible; }
      </style></head><body><header class="reporting-output-header"><div><p class="report-eyebrow">\(text(snapshot["request"]["type"]).uppercased()) REPORT</p><h3>\(title)</h3><p>\(date(snapshot["request"]["period"]["start"])) — \(date(snapshot["request"]["period"]["end"])) · Data as of \(date(snapshot["request"]["period"]["dataCutoff"]))</p></div></header>\(warnings)<div class="report-kpis">\(kpis)</div><section class="reporting-people daily-weekly-people"><div class="people-report-heading"><div><h3>Changed issues</h3><p>Story → Task → Subtask/Bug hierarchy for issues that changed during this period, with who changed what and when. Faded rows are unchanged ancestors shown for context.</p></div><span>\(changed.count) changed</span></div>\(issueTree)</section><section class="reporting-people daily-weekly-people"><div class="people-report-heading"><div><h3>People</h3><p>Ownership and contribution for this report.</p></div><span>\(result["people"].array.count) contributors</span></div><div class="people-report-table"><div class="people-report-row people-report-header"><span>Person</span><span>Assigned work</span><span>Completed</span><span>Worklog</span></div>\(people)</div></section></body></html>
      """
  }
}
