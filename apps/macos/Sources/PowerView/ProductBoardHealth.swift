import PowerViewCore
import SwiftUI

struct ProductBoardHealth: View {
  let state: ProductWorkspace
  @State private var expandedSegment: String?
  private var mapping: [String: String] {
    state.snapshot?.fieldMapping ?? state.setup?["fieldMapping"].object.compactMapValues(\.string)
      ?? [:]
  }
  private var issues: [JSONValue] {
    (state.snapshot?.issues ?? []).map { WorkspaceReportMapping.normalized($0, mapping: mapping) }
  }
  private var sprintAvailable: Bool {
    guard let field = mapping["sprintFieldId"] else { return false }
    return state.snapshot?.issues.contains {
      $0.rawSource?["fields"].object.keys.contains(field) == true
    } == true
  }
  private var report: JSONValue {
    BoardHealthCalculator.board(
      issues,
      options: .object([
        "completedStatusIds": state.setup?["reporting"]["completedStatusIds"] ?? .array([]),
        "completedStatusNames": state.setup?["reporting"]["completedStatusNames"] ?? .array([]),
        "sprintDataAvailable": .bool(sprintAvailable),
      ]))
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 8) {
          PV.eyebrow("BOARD HEALTH")
          Text(
            state.setup?["project"]["name"].string ?? state.snapshot?.boardName ?? "Board Health"
          ).font(.system(size: 28, weight: .bold))
          Text(
            (state.setup?["project"]["key"].string ?? "") + " · Loaded JQL scope · Updated "
              + (state.snapshot?.loadedAt.formatted(date: .abbreviated, time: .shortened) ?? "—")
          ).font(.system(size: 12)).foregroundStyle(PV.secondary)
        }
        Spacer()
        DisclosureGroup("View scope") {
          Text(state.snapshot?.jql ?? "").font(.system(size: 12, design: .monospaced))
            .textSelection(.enabled)
        }.frame(maxWidth: 280)
      }
      if state.snapshot?.truncated == true {
        Text(
          "This report uses up to 5,000 matching issues. Narrow the JQL before using percentages for decisions."
        ).font(.system(size: 13)).padding(12).background(Color(hex: 0xfff7d6))
      }
      let total = report["total"].number ?? 0
      let open = report["open"].number ?? 0
      let planning = report["planning"]
      let planned = (planning["currentSprint"].number ?? 0) + (planning["futureSprint"].number ?? 0)
      HStack(spacing: 14) {
        ProductMetric(
          label: "Open now", value: report["open"].plainText,
          note: percent(open, total) + " of loaded scope")
        ProductMetric(
          label: "Done", value: report["done"].plainText,
          note: report["recentDone"].plainText + " completed in the last 30 days", color: PV.green)
        ProductMetric(
          label: "Planned", value: sprintAvailable ? planned.formatted() : "—",
          note: sprintAvailable
            ? percent(planned, open) + " of open work" : "Sprint field is not mapped")
        ProductMetric(
          label: "Unscheduled", value: sprintAvailable ? planning["unscheduled"].plainText : "—",
          note: sprintAvailable
            ? percent(planning["unscheduled"].number ?? 0, open) + " of open work"
            : "Planning data unavailable", color: Color(hex: 0x7f5f01))
        ProductMetric(
          label: "Unassigned", value: report["unassignedOpen"].plainText,
          note: "Open issues without an owner", color: Color(hex: 0x7f5f01))
      }
      HStack(alignment: .top, spacing: 20) {
        VStack(alignment: .leading, spacing: 18) {
          Text("Work status").font(.system(size: 18, weight: .bold))
          Text("Current Jira status category across the loaded scope.").font(.system(size: 12))
            .foregroundStyle(PV.secondary)
          segments(
            [
              ("To do", report["statuses"]["toDo"].number ?? 0, Color(hex: 0x8794a9)),
              ("In progress", report["statuses"]["inProgress"].number ?? 0, PV.accent),
              ("Done", report["statuses"]["done"].number ?? 0, PV.green),
              ("Unknown", report["statuses"]["unknown"].number ?? 0, PV.secondary),
            ], total: total)
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading).productCard(12)
        VStack(alignment: .leading, spacing: 18) {
          Text("Planning coverage").font(.system(size: 18, weight: .bold))
          Text("Active and future sprint allocation among open issues only.").font(
            .system(size: 12)
          ).foregroundStyle(PV.secondary)
          if sprintAvailable {
            segments(
              [
                ("Current sprint", planning["currentSprint"].number ?? 0, PV.accent),
                ("Future sprint", planning["futureSprint"].number ?? 0, PV.purple),
                ("Unscheduled", planning["unscheduled"].number ?? 0, Color(hex: 0xf5cd47)),
              ], total: open)
          } else {
            Text("Sprint data unavailable").fontWeight(.semibold)
            Text("Map the Jira Sprint field in Project setup, then reload the issue scope.").font(
              .system(size: 12)
            ).foregroundStyle(PV.secondary)
          }
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading).productCard(12)
      }
      if let selected = expandedSegment {
        VStack(alignment: .leading, spacing: 10) {
          Text(selected).fontWeight(.bold)
          ForEach(filtered(selected), id: \.self) { issue in
            if let origin = state.snapshot?.origin ?? state.setup?["jiraBaseUrl"].string,
              let key = issue["key"].string,
              let url = URL(
                string: origin.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/browse/"
                  + key)
            {
              Link(key + " · " + (issue["summary"].string ?? ""), destination: url).foregroundStyle(
                PV.accent)
            }
          }
        }.padding(20).productCard(12)
      }
    }.padding(28).productCard(20)
  }
  private func percent(_ value: Double, _ total: Double) -> String {
    (total == 0 ? 0 : value / total * 100).formatted(.number.precision(.fractionLength(0))) + "%"
  }
  private func segments(_ values: [(String, Double, Color)], total: Double) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      GeometryReader { geometry in
        HStack(spacing: 0) {
          ForEach(Array(values.enumerated()), id: \.offset) { _, item in
            item.2.frame(width: total == 0 ? 0 : geometry.size.width * item.1 / total)
          }
        }.clipShape(Capsule())
      }.frame(height: 16)
      ForEach(Array(values.enumerated()), id: \.offset) { _, item in
        Button {
          expandedSegment = expandedSegment == item.0 ? nil : item.0
        } label: {
          HStack {
            Circle().fill(item.2).frame(width: 8, height: 8)
            Text(item.0)
            Spacer()
            Text(percent(item.1, total)).fontWeight(.bold)
            Text(item.1.formatted()).foregroundStyle(PV.secondary)
          }
        }.buttonStyle(.plain).font(.system(size: 12))
      }
    }
  }
  private func filtered(_ segment: String) -> [JSONValue] {
    issues.filter { issue in
      let done =
        (state.setup?["reporting"]["completedStatusIds"].array ?? []).contains(
          issue["status"]["id"])
        || (state.setup?["reporting"]["completedStatusNames"].array ?? []).contains(
          issue["status"]["name"])
        || issue["status"]["category"].string == "done"
      let states = issue["sprints"].array.compactMap { $0["state"].string }
      switch segment {
      case "Done": return done
      case "To do": return !done && issue["status"]["category"].string == "to-do"
      case "In progress": return !done && issue["status"]["category"].string == "in-progress"
      case "Unknown": return !done && issue["status"]["category"].string == "unknown"
      case "Current sprint": return !done && states.contains("active")
      case "Future sprint": return !done && !states.contains("active") && states.contains("future")
      default: return !done && !states.contains("active") && !states.contains("future")
      }
    }
  }
}
struct ProductMetric: View {
  let label: String, value: String, note: String
  var color = PV.ink
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(label).font(.system(size: 12)).foregroundStyle(PV.secondary)
      Text(value).font(.system(size: 32, weight: .bold)).foregroundStyle(color)
      Text(note).font(.system(size: 11)).foregroundStyle(PV.secondary).lineLimit(2)
    }.padding(18).frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading).productCard(12)
  }
}
