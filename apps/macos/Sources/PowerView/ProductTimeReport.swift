import PowerViewCore
import SwiftUI

struct NativeTimeReportView: View {
  @ObservedObject var jira: JiraSession
  var active = true
  @StateObject private var model: NativeTimeReportModel
  private let loadsAutomatically: Bool
  init(jira: JiraSession, active: Bool = true, model: NativeTimeReportModel? = nil, loadsAutomatically: Bool = true) {
    self.jira = jira; self.active = active; _model = StateObject(wrappedValue: model ?? NativeTimeReportModel()); self.loadsAutomatically = loadsAutomatically
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 6) {
        PV.eyebrow("TEAM WORKLOGS")
        Text("Time Report").font(.title2.bold())
        Text("Review your team’s logged time across Jira by week or month.").foregroundStyle(PV.secondary)
      }
      ViewThatFits(in: .horizontal) {
        teamControls
        ScrollView(.horizontal) { teamControls }
      }
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 18) { periodControls; zoneControl }
        VStack(alignment: .leading, spacing: 12) { periodControls; zoneControl }
      }.disabled(model.syncing)
      Text("Searches the selected team’s time across all accessible projects. Jira search can omit older worklogs on heavily used issues.").font(.caption).foregroundStyle(PV.secondary)
      HStack {
        Button("Load Time Report") { Task { await model.load() } }.buttonStyle(ProductButton(primary: true)).disabled(!model.canLoad)
        if model.loading { ProgressView().controlSize(.small); Text(model.progress).font(.caption); Button("Cancel loading") { model.cancelLoading() } }
        if model.teamsLoading { ProgressView().controlSize(.small); Text("Finding your teams…").font(.caption) }
      }
      if model.syncing || (!model.progress.isEmpty && !model.loading && !model.teamsLoading) { Text(model.progress).font(.caption).foregroundStyle(PV.secondary) }
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red).textSelection(.enabled) }
      ForEach(model.team?.warnings ?? [], id: \.self) { Text($0).font(.caption).foregroundStyle(.orange) }
      ForEach(model.snapshot?.warnings ?? [], id: \.self) { Text($0).font(.caption).foregroundStyle(.orange) }
      ForEach(model.calendar?.warnings ?? [], id: \.self) { Text($0).font(.caption).foregroundStyle(.orange) }
      if let snapshot = model.snapshot {
        Text(model.team?.name ?? "").font(.title3.bold())
        Text(TimeSnapshot.coverageNotice).font(.caption).foregroundStyle(PV.secondary)
        if snapshot.complete { result }
        else { Text("Incomplete report: \(snapshot.failedIssueIDs.count) issue requests failed. Full totals are unavailable. Load again to retry.").foregroundStyle(.red) }
      } else if !model.loading && !model.teamsLoading && model.error.isEmpty {
        Text(model.teams.isEmpty ? "No teams were found for your account. Check your Atlassian team membership, then refresh teams." : "Choose a team and load its time report.").foregroundStyle(PV.secondary)
      }
    }.padding(24).productCard(14)
      .task(id: jira.timeScope + String(active)) { if loadsAutomatically { model.attach(jira); if active { await model.discoverTeams() } else { model.cancel() } } }
      .onDisappear { if loadsAutomatically { model.cancel() } }
  }
  private var teamControls: some View {
    HStack(spacing: 12) {
      Picker("My teams", selection: $model.teamID) { Text(model.teamsLoading ? "Loading your teams…" : "Choose a team").tag(""); ForEach(model.teams) { Text($0.name).tag($0.id) } }.frame(width: 300).disabled(model.teamsLoading || model.syncing)
      Button("Refresh teams") { Task { await model.discoverTeams() } }.disabled(model.teamsLoading || model.syncing)
      Button(model.syncing ? "Syncing…" : "Sync Jira team") { Task { await model.sync() } }.disabled(model.teamID.isEmpty || model.teamsLoading || model.syncing || !model.calendarConfigured)
    }
  }
  private var periodControls: some View {
    HStack(spacing: 10) {
      Picker("Period", selection: $model.month) { Text("Weekly").tag(false); Text("Monthly").tag(true) }.pickerStyle(.segmented).labelsHidden().frame(width: 180)
      DatePicker(model.month ? "Month" : "Week containing", selection: Binding(get: { TimeCalendar.instant(model.anchor + "T12:00:00Z") ?? Date() }, set: { model.anchor = TimeCalendar.text($0, zone: "UTC") }), displayedComponents: .date).environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
    }
  }
  private var zoneControl: some View {
    Picker("Report time zone", selection: $model.zone) { ForEach(Array(Set(TimeZone.knownTimeZoneIdentifiers + [model.zone, "UTC"])).sorted(), id: \.self) { Text($0).tag($0) } }.frame(maxWidth: 360)
  }
  private var result: some View {
    VStack(alignment: .leading, spacing: 14) {
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 10) { resultPeriod; Spacer(); employeeFilter }
        VStack(alignment: .leading, spacing: 10) { resultPeriod; employeeFilter }
      }
      Text("Time zone: \(model.zone). " + (model.month ? "Monthly capacity: 8h per weekday, excluding weekday Day Off dates." : "Base capacity: 40h per week; each weekday Day Off subtracts 8h.") + " Weekend worklogs count toward logged time.").font(.caption).foregroundStyle(PV.secondary)
      HStack {
        Text(model.calendar?.complete == true ? "Day Off synced with GitHub" : "Complete Day Off data is unavailable. Capacity and deficit indicators are unavailable.").font(.caption).foregroundStyle(model.calendar?.complete == true ? PV.secondary : .orange)
        if model.calendarConfigured { Button(model.calendarLoading ? "Refreshing…" : "Refresh Day Off") { Task { await model.refreshCalendar() } }.disabled(model.calendarLoading || model.loading) }
      }
      Picker("Time Report view", selection: $model.individual) { Text("Team View").tag(false); Text("Individual View").tag(true) }.pickerStyle(.segmented).labelsHidden().frame(width: 280).disabled(model.selected.isEmpty)
      if let person = model.person {
        Picker("Individual", selection: Binding(get: { person.user.accountId }, set: { model.individualID = $0 })) { ForEach(model.selected, id: \.user.accountId) { Text($0.user.displayName).tag($0.user.accountId) } }.frame(maxWidth: 350)
        Text(person.user.displayName + " · Logged " + TimeCalendar.duration(person.logged) + " · Expected " + expected(person.expected) + " · Utilization " + percent(person.utilization)).font(.caption)
        individualTable(person)
      } else { teamTable }
    }
  }
  private var resultPeriod: some View {
    HStack {
      Button("‹") { model.anchor = TimeCalendar.adjacent(model.anchor, month: model.month, direction: -1) }.accessibilityLabel("Previous period")
      Text("\(model.days.first ?? "") — \(model.days.last ?? "")").font(.caption.bold())
      Button("›") { model.anchor = TimeCalendar.adjacent(model.anchor, month: model.month, direction: 1) }.accessibilityLabel("Next period")
    }
  }
  private var employeeFilter: some View {
    Picker("Employee", selection: $model.employee) { Text("All employees").tag(""); ForEach(model.metrics.sorted { $0.user.displayName.localizedStandardCompare($1.user.displayName) == .orderedAscending }, id: \.user.accountId) { Text($0.user.displayName).tag($0.user.accountId) } }.frame(maxWidth: 320)
  }
  private var teamTable: some View {
    ScrollView(.horizontal) {
      VStack(alignment: .leading, spacing: 0) {
        Text("Team View").font(.headline).padding(12)
        HStack(spacing: 0) { Text("Employee").frame(width: 200, alignment: .leading); dayHeadings; tail("Logged", "Expected", "Util.") }.font(.caption.bold()).padding(.vertical, 12).background(PV.subtle)
        ForEach(model.selected, id: \.user.accountId) { person in
          HStack(spacing: 0) {
            Button(person.user.displayName) { model.showIndividual(person.user.accountId) }.buttonStyle(.plain).foregroundStyle(PV.accent).frame(width: 200, alignment: .leading)
            ForEach(model.days, id: \.self) { day in dayCell(person, day: day) }
            tail(TimeCalendar.duration(person.logged), expected(person.expected), percent(person.utilization))
          }.font(.caption).overlay(alignment: .bottom) { PV.border.frame(height: 1) }
        }
        let rows = model.selected
        let logged = rows.reduce(0) { $0 + $1.logged }
        let capacity = !rows.isEmpty && rows.allSatisfy { $0.expected != nil } ? rows.reduce(0) { $0 + ($1.expected ?? 0) } : nil
        HStack(spacing: 0) {
          Text("TEAM").frame(width: 200, alignment: .leading)
          ForEach(model.days, id: \.self) { day in Text(TimeCalendar.duration(rows.reduce(0) { $0 + $1.days[day, default: 0] })).frame(width: 84, height: 44) }
          tail(TimeCalendar.duration(logged), expected(capacity), percent(capacity.flatMap { $0 > 0 ? Double(logged) / Double($0) * 100 : nil }))
        }.font(.caption.bold()).background(PV.subtle)
      }.padding(.horizontal, 8)
    }.overlay(RoundedRectangle(cornerRadius: 8).stroke(PV.border))
  }
  private func individualTable(_ person: TimeEmployeeMetrics) -> some View {
    ScrollView(.horizontal) {
      VStack(alignment: .leading, spacing: 0) {
        Text("Individual View · " + person.user.displayName).font(.headline).padding(12)
        HStack(spacing: 0) { Text("Jira Issue").frame(width: 200, alignment: .leading); dayHeadings; Text("Total").frame(width: 84) }.font(.caption.bold()).padding(.vertical, 12).background(PV.subtle)
        ForEach(person.issueDays.keys.sorted(), id: \.self) { key in
          HStack(spacing: 0) {
            if let origin = jira.client?.connection.origin, let url = URL(string: origin.absoluteString + "/browse/" + key) { Link(key, destination: url).frame(width: 200, alignment: .leading) }
            ForEach(model.days, id: \.self) { day in dayCell(person, day: day, issue: key) }
            Text(TimeCalendar.duration(person.issueDays[key]?.values.reduce(0,+) ?? 0)).frame(width: 84)
          }.font(.caption).overlay(alignment: .bottom) { PV.border.frame(height: 1) }
        }
        HStack(spacing: 0) { Text("Total").frame(width: 200, alignment: .leading); ForEach(model.days, id: \.self) { day in dayCell(person, day: day) }; Text(TimeCalendar.duration(person.logged)).frame(width: 84) }.font(.caption.bold()).background(PV.subtle)
      }.padding(.horizontal, 8)
    }.overlay(RoundedRectangle(cornerRadius: 8).stroke(PV.border))
  }
  private var dayHeadings: some View { ForEach(model.days, id: \.self) { Text(String($0.suffix(5))).frame(width: 84) } }
  private func tail(_ logged: String, _ expected: String, _ utilization: String) -> some View { Group { Text(logged).frame(width: 88); Text(expected).frame(width: 90); Text(utilization).frame(width: 78) } }
  private func expected(_ value: Int?) -> String { value.map(TimeCalendar.duration) ?? "Unavailable" }
  private func percent(_ value: Double?) -> String { value.map { String(format: "%.1f%%", $0) } ?? "N/A" }
  private func dayCell(_ person: TimeEmployeeMetrics, day: String, issue: String? = nil) -> some View {
    let style = person.style(on: day, issue: issue)
    let seconds = issue.map { person.issueDays[$0]?[day] ?? 0 } ?? person.days[day, default: 0]
    return Text(style == .dayOff ? "Day Off" : style == .conflict ? "Day Off · " + TimeCalendar.duration(seconds) : TimeCalendar.duration(seconds))
      .font(.caption).frame(width: 84, height: 44)
      .foregroundStyle(style == .conflict ? Color(hex: 0xae2e24) : style == .deficit ? Color(hex: 0x974f0c) : PV.ink)
      .background(style == .conflict ? Color(hex: 0xffebe6) : style == .deficit ? Color(hex: 0xfff7d6) : .clear)
  }
}

struct NativeSectionSettings: View {
  @Binding var settings: String
  static let defaults: [String: Bool] = ["timesheet": true, "gantt": true, "status": true, "reports": false, "estimation": false]
  static func values(_ raw: String) -> [String: Bool] {
    let decoded = raw.data(using: .utf8).flatMap { try? JSONDecoder().decode([String: Bool].self, from: $0) } ?? [:]
    return defaults.merging(decoded) { _, next in next }
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("App sections").font(.title3.bold())
      Text("Choose what appears in navigation and Workspace. Changes save automatically on this Mac.").font(.caption).foregroundStyle(PV.secondary)
      ForEach([("timesheet", "Timesheet", "Log your time and manage Day Off."), ("gantt", "Gantt", "Plan schedules and dependencies."), ("status", "Status chart", "See issue statuses across your board."), ("reports", "Reports", "Team updates and time reports."), ("estimation", "Estimation board", "Estimate scope and prepare handoffs.")], id: \.0) { item in
        Toggle(isOn: Binding(get: { Self.values(settings)[item.0] == true }, set: { enabled in
          var values = Self.values(settings); values[item.0] = enabled
          if let data = try? JSONEncoder().encode(values), let text = String(data: data, encoding: .utf8) { settings = text }
        })) { VStack(alignment: .leading, spacing: 4) { Text(item.1).fontWeight(.semibold); Text(item.2).font(.caption).foregroundStyle(PV.secondary) } }.toggleStyle(.switch)
      }
    }.padding(24).productCard(14)
  }
}
