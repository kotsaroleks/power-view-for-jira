import Foundation
import PowerViewCore
import SwiftUI

struct NativePendingWorklogResult: Identifiable, Sendable {
  let id: String
  let attempt = UUID()
  let issue: TimeIssue
  let day: String
  let zone: String
  let deleting: Bool
  var records: [TimeWorklog]?
  var reading = false
  var error = ""
}

struct NativeWorklogRecoveryNotice: View {
  @ObservedObject var model: NativeTimesheetModel
  let id: String
  @State private var checked = false
  var body: some View {
    if let pending = model.recoveries[id] {
      VStack(alignment: .leading, spacing: 8) {
        Text(pending.issue.key + " · " + pending.day + " · " + pending.zone + (pending.deleting ? " · Deletion result unknown" : " · Save result unknown")).font(.caption.bold())
        Text("Your input is retained. Compare the current Jira records before allowing another attempt.").font(.caption)
        if let records = pending.records {
          if records.isEmpty { Text("No own worklogs were returned for this date.").font(.caption) }
          ForEach(records) { record in
            VStack(alignment: .leading, spacing: 3) {
              Text("Worklog " + record.id + " · " + TimeCalendar.duration(record.seconds) + " · " + (TimeCalendar.instant(record.started).map { TimeCalendar.text($0, zone: pending.zone, pattern: "yyyy-MM-dd HH:mm:ss") } ?? record.started))
              if !record.commentText.isEmpty { Text(record.commentText) }
            }.font(.caption).textSelection(.enabled)
          }
          Toggle("I checked these records and the result in Jira", isOn: $checked).font(.caption)
          Button("Allow another attempt") { model.allowWorklogRetry(id) }.disabled(!checked || pending.reading)
        }
        if !pending.error.isEmpty { Text(pending.error).font(.caption).foregroundStyle(.red) }
        Button(pending.reading ? "Reading Jira records…" : "Refresh records") { Task { await model.reloadUnknownRecords(id) } }.disabled(pending.reading)
      }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: 0xfff7d6), in: RoundedRectangle(cornerRadius: 8))
        .onChange(of: pending.records) { _, _ in checked = false }
    }
  }
}
