import Foundation
import PowerViewCore
import SwiftUI

struct NativeDescriptionChangesReport: View {
  @ObservedObject var jira: JiraSession
  let boardID: String
  var active = true
  @State private var date = ReportPeriod.date(DescriptionReportPeriod.latestDate() + "T12:00:00Z")!
  @State private var report: DescriptionReportSnapshot?
  @State private var error = ""
  @State private var stage = ""
  @State private var generation: Task<Void, Never>?
  @State private var generationID = UUID()
  init(
    jira: JiraSession, boardID: String, active: Bool = true,
    initialReport: DescriptionReportSnapshot? = nil
  ) {
    self.jira = jira
    self.boardID = boardID
    self.active = active
    _report = State(initialValue: initialReport)
    if let initialReport {
      _date = State(initialValue: ReportPeriod.date(initialReport.period.date + "T12:00:00Z")!)
    }
  }
  private var localDate: String { TimeCalendar.text(date, zone: "Europe/Kyiv") }
  private var context: String {
    [jira.timeScope, boardID, localDate, String(active)].joined(separator: "|")
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Description changes").font(.system(size: 24, weight: .bold))
      Text(
        "See which issue descriptions changed and who edited them. Each period ends at 21:00 Kyiv."
      ).foregroundStyle(PV.secondary)
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .bottom, spacing: 12) {
          dateControl
          previewControl
        }
        VStack(alignment: .leading, spacing: 12) {
          dateControl
          previewControl
        }
      }
      Text("This preview sends no messages to Google Chat.").font(.caption).foregroundStyle(
        PV.secondary)
      if boardID.isEmpty {
        Text("Choose a board in Settings to preview this report.").foregroundStyle(PV.secondary)
      }
      if !stage.isEmpty { Text(stage).font(.caption).foregroundStyle(PV.secondary) }
      if !error.isEmpty { Text(error).foregroundStyle(.red).textSelection(.enabled) }
      if let report { NativeDescriptionChangesResult(report: report) }
    }.padding(24).frame(maxWidth: .infinity, alignment: .leading).productCard(12)
      .onChange(of: context) { _, _ in
        cancel()
        report = nil
        error = ""
      }
      .onDisappear { cancel() }
  }
  private var dateControl: some View {
    DatePicker(
      "Report date", selection: $date,
      in: ...ReportPeriod.date(DescriptionReportPeriod.latestDate() + "T12:00:00Z")!,
      displayedComponents: .date
    )
    .environment(\.timeZone, TimeZone(identifier: "Europe/Kyiv")!).fixedSize()
  }
  private var previewControl: some View {
    HStack {
      Button("Preview description changes") { generate() }.buttonStyle(ProductButton(primary: true))
        .disabled(generation != nil || jira.client == nil || boardID.isEmpty)
      if generation != nil {
        ProgressView().controlSize(.small)
        Button("Cancel") { cancel() }
      }
    }
  }
  private func cancel() {
    generationID = UUID()
    generation?.cancel()
    generation = nil
    stage = ""
  }
  private func generate() {
    guard active, let client = jira.client, let userID = jira.user?.accountId else { return }
    cancel()
    let id = UUID()
    generationID = id
    let requestedContext = context
    let requestedDate = localDate
    report = nil
    error = ""
    generation = Task {
      defer {
        if generationID == id {
          generation = nil
          stage = ""
        }
      }
      do {
        let result = try await client.descriptionChangeReport(
          boardID: boardID, date: requestedDate, expectedUserID: userID
        ) { message in
          await MainActor.run {
            if generationID == id && context == requestedContext { stage = message }
          }
        }
        try Task.checkCancellation()
        if generationID == id && context == requestedContext { report = result }
      } catch is CancellationError {} catch {
        if generationID == id && context == requestedContext {
          self.error = error.localizedDescription + " No complete report was generated."
        }
      }
    }
  }
}
struct NativeDescriptionChangesResult: View {
  let report: DescriptionReportSnapshot
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(report.boardName).font(.headline)
      Text(
        TimeCalendar.text(
          ReportPeriod.date(report.period.start)!, zone: "Europe/Kyiv", pattern: "yyyy-MM-dd HH:mm")
          + " — "
          + TimeCalendar.text(
            ReportPeriod.date(report.period.end)!, zone: "Europe/Kyiv", pattern: "yyyy-MM-dd HH:mm")
          + " · Kyiv"
      ).font(.caption).foregroundStyle(PV.secondary)
      Text(
        "Changed issues: \(report.changedIssueCount) · Edits: \(report.changeCount)")
      if report.changedIssueCount == 0 {
        Text("No issue descriptions changed during this period.").foregroundStyle(PV.secondary)
      } else {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 0) {
          GridRow {
            Text("Issue and hierarchy").bold()
            Text("Changed by").bold()
          }.padding(10)
          ForEach(report.rows) { row in
            GridRow(alignment: .top) {
              VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                  if row.depth > 0 { Text("↳").foregroundStyle(PV.secondary) }
                  if let url = URL(string: report.jiraBaseUrl + "/browse/" + row.issueKey) {
                    Link(row.issueKey, destination: url)
                  }
                  Text("· " + row.issueType).foregroundStyle(PV.secondary)
                }
                Text(row.summary).font(.system(size: 13))
              }.padding(.leading, CGFloat(row.depth * 18)).frame(
                maxWidth: .infinity, alignment: .leading)
              Text(
                row.contextOnly
                  ? "— (context)" : row.authors.map(\.displayName).joined(separator: ", ")
              ).frame(maxWidth: .infinity, alignment: .leading)
            }.padding(10).background(row.contextOnly ? PV.subtle : Color.white)
            Divider().gridCellColumns(2)
          }
        }
      }
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}
