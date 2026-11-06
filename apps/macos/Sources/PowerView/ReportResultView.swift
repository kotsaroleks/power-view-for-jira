import PowerViewCore
import SwiftUI

struct NativeReportResultView: View {
  let snapshot: JSONValue
  let language: String
  var printMode = false
  @State private var expanded = Set<String>()
  @State private var showFinished = Set<String>()
  private var result: JSONValue { snapshot["result"] }
  private var summary: JSONValue { result["executiveSummary"] }
  private var events: [JSONValue] { result["activity"].array }
  private var issues: [JSONValue] {
    result["people"].array.flatMap { $0["assignedIssues"].array }
      + result["unassigned"]["issues"].array
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), alignment: .top)], spacing: 14) {
        metric(
          "Issues in scope", "totalIssues", summary["incompleteIssues"].plainText + " still open")
        metric(
          "Completed",
          snapshot["request"]["type"].string == "sprint"
            ? "completedIssues" : "completedDuringPeriod",
          summary["completedIssues"].plainText + " completed in scope")
        metric("Created", "createdIssues", "Added during this period")
        ProductMetric(
          label: "Worklog", value: hours(summary["worklogSeconds"]),
          note: "Logged during this period")
        metric("Unassigned", "unassignedIssues", "Issues without an owner")
      }
      panel(
        "Changed issues",
        subtitle:
          "Story → Task → Subtask/Bug hierarchy for issues that changed during this period, with who changed what and when. Faded rows are unchanged ancestors shown for context."
      ) {
        let rows = ReportPresentation.changedTree(issues: issues, events: events)
        if rows.isEmpty { empty("No tracked changes in this period.") }
        ForEach(rows) { row in changedIssue(row.issue).padding(.leading, CGFloat(row.depth * 22)) }
      }
      HStack(alignment: .top, spacing: 20) {
        panel("Period activity", subtitle: "Changes recorded in Jira during the selected period.") {
          let counts = Dictionary(grouping: events, by: { $0["type"].plainText }).map {
            ($0.key, $0.value.count)
          }.sorted { $0.1 > $1.1 }
          if counts.isEmpty { empty("No activity recorded") }
          ForEach(counts, id: \.0) { item in
            VStack(spacing: 6) {
              HStack {
                Text(eventName(item.0))
                Spacer()
                Text(item.1.formatted()).bold()
              }
              ProgressView(value: Double(item.1), total: Double(counts.first?.1 ?? 1)).tint(
                PV.accent)
            }.font(.system(size: 12))
          }
        }
        panel("Delivery pulse", subtitle: "How work moved through the period.") {
          pulse("Completed", summary["completedDuringPeriod"].plainText)
          pulse("Reopened", summary["reopenedDuringPeriod"].plainText)
          pulse("Created", summary["createdIssues"].plainText)
          pulse("Time spent", hours(summary["totalTimeSpentSeconds"]))
        }
      }
      panel("People", subtitle: "Ownership and contribution for this report.") {
        HStack {
          Text("Person").frame(maxWidth: .infinity, alignment: .leading)
          Text("Assigned work").frame(width: 110)
          Text("Completed").frame(width: 100)
          Text("Worklog").frame(width: 100)
        }.font(.system(size: 11, weight: .semibold)).foregroundStyle(PV.secondary)
        ForEach(result["people"].array, id: \.self) { person in personView(person) }
        HStack {
          Text("Unassigned").fontWeight(.bold).frame(maxWidth: .infinity, alignment: .leading)
          Text(result["unassigned"]["issues"].array.count.formatted()).frame(width: 110)
          Text("—").frame(width: 100)
          Text("—").frame(width: 100)
        }.font(.system(size: 12)).padding(.vertical, 10)
      }
    }
  }
  private func changedIssue(_ issue: JSONValue) -> some View {
    let entries = ReportPresentation.activity(events).filter { $0.issueKey == issue["key"].string }
    let changed = events.contains { $0["issueId"] == issue["id"] }
    return VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        Text(issue["issueType"]["name"].plainText).font(.system(size: 10, weight: .semibold))
          .padding(5).background(PV.subtle, in: RoundedRectangle(cornerRadius: 4))
        issueLink(issue["key"].plainText)
        Text(issue["summary"].plainText).frame(maxWidth: .infinity, alignment: .leading)
        Text(issue["status"]["name"].plainText).font(.system(size: 11, weight: .semibold))
          .foregroundStyle(finished(issue) ? PV.green : PV.secondary)
        if let assignee = issue["assignee"]["displayName"].string {
          Text(assignee).foregroundStyle(PV.secondary)
        }
      }.font(.system(size: 12)).opacity(changed ? 1 : 0.6)
      if !entries.isEmpty {
        HStack {
          Text("Time").frame(width: 160, alignment: .leading)
          Text("Who did the change").frame(width: 150, alignment: .leading)
          Text("What changed").frame(maxWidth: .infinity, alignment: .leading)
        }.font(.system(size: 10, weight: .semibold)).foregroundStyle(PV.secondary)
        ForEach(entries) { entry in
          HStack(alignment: .top) {
            Text(displayTime(entry.occurredAt)).frame(width: 160, alignment: .leading)
            Text(entry.actor).frame(width: 150, alignment: .leading)
            Text(entry.change).frame(maxWidth: .infinity, alignment: .leading)
          }.font(.system(size: 11)).padding(.vertical, 3)
        }
      }
      Divider()
    }.padding(.vertical, 8)
  }
  private func displayTime(_ value: String) -> String { ReportPresentation.formatDate(value) }
  private func personView(_ person: JSONValue) -> some View {
    let id = person["user"]["id"].plainText
    let assigned = person["assignedIssues"].array
    return VStack(alignment: .leading, spacing: 12) {
      Button {
        toggle(&expanded, id)
      } label: {
        HStack {
          Image(systemName: expanded.contains(id) ? "chevron.down" : "chevron.right")
          Text(person["user"]["displayName"].plainText).frame(
            maxWidth: .infinity, alignment: .leading)
          Text(
            (printMode || showFinished.contains(id)
              ? assigned.count : assigned.filter { !finished($0) }.count)
              .formatted() + " of " + assigned.count.formatted()
          ).frame(width: 110)
          Text(person["completedIssues"].array.count.formatted()).frame(width: 100)
          Text(hours(person["worklogSeconds"])).frame(width: 100)
        }.font(.system(size: 13)).padding(.vertical, 10).contentShape(Rectangle())
      }.buttonStyle(.plain)
      if printMode || expanded.contains(id) {
        if !printMode {
          Toggle(
            "Show finished",
            isOn: Binding(
              get: { showFinished.contains(id) },
              set: { value in if value { showFinished.insert(id) } else { showFinished.remove(id) }
              })
          ).font(.system(size: 12))
        }
        let visible = assigned.filter { printMode || showFinished.contains(id) || !finished($0) }
        if visible.isEmpty { empty("No issues matching this filter") }
        ForEach(visible, id: \.self) { issue in issueRow(issue) }
      }
      Divider()
    }
  }
  private func toggle(_ values: inout Set<String>, _ id: String) {
    if !values.insert(id).inserted { values.remove(id) }
  }
  private func finished(_ issue: JSONValue) -> Bool {
    let mapping = snapshot["statusMapping"]
    return issue["status"]["id"] != .null
      ? mapping["completedStatusIds"].array.contains(issue["status"]["id"])
      : mapping["completedStatusNames"].array.contains(issue["status"]["name"])
  }
  @ViewBuilder private func issueRow(_ issue: JSONValue) -> some View {
    let content = HStack(alignment: .top, spacing: 12) {
      Text(issue["key"].plainText).fontWeight(.semibold).foregroundStyle(PV.accent).frame(
        width: 100, alignment: .leading)
      Text(issue["summary"].plainText).frame(maxWidth: .infinity, alignment: .leading)
      Text(issue["status"]["name"].plainText).font(.system(size: 11)).foregroundStyle(
        finished(issue) ? PV.green : PV.secondary
      ).padding(5).background(PV.background, in: RoundedRectangle(cornerRadius: 4))
    }.font(.system(size: 12)).padding(.vertical, 10).contentShape(Rectangle())
    if let url = issue["browseUrl"].string.flatMap(URL.init(string:)) {
      Link(destination: url) { content }.buttonStyle(.plain)
    } else {
      content
    }
  }
  @ViewBuilder private func issueLink(_ key: String) -> some View {
    if let origin = snapshot["jira"]["baseUrl"].string ?? snapshot["board"]["jiraBaseUrl"].string
      ?? snapshot["request"]["jiraBaseUrl"].string,
      let url = URL(
        string: origin.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/browse/" + key)
    {
      Link(key, destination: url).foregroundStyle(PV.accent)
    } else {
      Text(key).foregroundStyle(PV.accent)
    }
  }
  private func metric(_ title: String, _ key: String, _ note: String) -> some View {
    ProductMetric(
      label: title, value: summary[key].plainText, note: note,
      color: title == "Completed"
        ? PV.green
        : title == "Unassigned" && (summary[key].number ?? 0) > 0 ? Color(hex: 0x7f5f01) : PV.ink)
  }
  private func hours(_ value: JSONValue) -> String {
    value.number.map { ReportPresentation.hours($0) } ?? "N/A"
  }
  private func pulse(_ title: String, _ value: String) -> some View {
    HStack {
      Text(title).foregroundStyle(PV.secondary)
      Spacer()
      Text(value).bold()
    }.padding(.vertical, 8)
  }
  private func empty(_ text: String) -> some View {
    Text(text).font(.system(size: 12)).foregroundStyle(PV.secondary).padding(.vertical, 12)
  }
  private func eventName(_ type: String) -> String {
    [
      "issue-created": "Created", "issue-completed": "Completed", "issue-reopened": "Reopened",
      "status-changed": "Status changed", "assignee-changed": "Assignee changed",
      "story-points-changed": "Story points changed",
      "original-estimate-changed": "Original estimate changed", "sprint-added": "Added to sprint",
      "sprint-removed": "Removed from sprint",
    ][type] ?? type
  }
  private func panel<Content: View>(
    _ title: String, subtitle: String, @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(title).font(.system(size: 18, weight: .bold))
      Text(subtitle).font(.system(size: 12)).foregroundStyle(PV.secondary)
      content()
    }.padding(20).frame(maxWidth: .infinity, alignment: .leading).productCard(12)
  }
}
