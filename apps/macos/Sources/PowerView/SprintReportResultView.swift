import PowerViewCore
import SwiftUI

struct NativeSprintReportResultView: View {
  let snapshot: JSONValue
  private var result: JSONValue { snapshot["result"] }
  private var summary: JSONValue { result["executiveSummary"] }
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), alignment: .top)], spacing: 14) {
        ProductMetric(label: "Issues", value: summary["totalIssues"].plainText, note: "")
        ProductMetric(label: "Completed", value: summary["completedIssues"].plainText, note: "")
        ProductMetric(label: "Worklog", value: hours(summary["worklogSeconds"]), note: "")
        ProductMetric(label: "Unassigned", value: summary["unassignedIssues"].plainText, note: "")
        ProductMetric(
          label: "Sprint completion",
          value: result["sprint"]["completion"]["percentage"].number.map {
            $0.formatted(.number.precision(.fractionLength(1))) + "%"
          } ?? "N/A", note: "")
      }
      VStack(alignment: .leading, spacing: 10) {
        Text("Sprint scope changes").font(.system(size: 16, weight: .bold))
        Text(
          "Added after start: " + result["sprint"]["addedAfterStart"].array.count.formatted()
            + " · Removed after start: "
            + result["sprint"]["removedAfterStart"].array.count.formatted()
        ).font(.system(size: 13)).foregroundStyle(PV.secondary)
      }.padding(20).frame(maxWidth: .infinity, alignment: .leading).productCard(12)
      VStack(alignment: .leading, spacing: 16) {
        Text("People").font(.system(size: 16, weight: .bold))
        ForEach(result["people"].array, id: \.self) { person in
          VStack(alignment: .leading, spacing: 6) {
            Text(person["user"]["displayName"].plainText).font(.system(size: 13, weight: .bold))
            Text(
              "Tasks: " + person["assignedIssues"].array.count.formatted() + " · Completed: "
                + person["completedIssues"].array.count.formatted() + " · Worklog: "
                + hours(person["worklogSeconds"])
            ).font(.system(size: 12)).foregroundStyle(PV.secondary)
          }.padding(16).frame(maxWidth: .infinity, alignment: .leading).productCard(8)
        }
        VStack(alignment: .leading, spacing: 6) {
          Text("Unassigned").font(.system(size: 13, weight: .bold))
          Text("Tasks: " + result["unassigned"]["issues"].array.count.formatted()).font(
            .system(size: 12)
          ).foregroundStyle(PV.secondary)
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).productCard(8)
      }
      if !snapshot["completeness"]["warnings"].array.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          Text("Warnings").fontWeight(.bold)
          ForEach(snapshot["completeness"]["warnings"].array, id: \.self) { warning in
            Text(warning["message"].plainText)
          }
        }.font(.system(size: 12)).padding(16).frame(maxWidth: .infinity, alignment: .leading)
          .background(Color(hex: 0xfff7d6), in: RoundedRectangle(cornerRadius: 8))
      }
    }
  }
  private func hours(_ value: JSONValue) -> String {
    ReportPresentation.hours(value.number ?? 0)
  }
}
