import Combine
import Foundation
import PowerViewCore

@MainActor final class NativeTimeReportModel: ObservableObject {
  @Published private(set) var teams: [TimeTeam] = []
  @Published var teamID = "" { didSet { if oldValue != teamID { cancelSync(); employee = ""; team = nil; selectionChanged() } } }
  @Published private(set) var team: TimeTeam?
  @Published var anchor = TimeCalendar.text(Date(), zone: "UTC") { didSet { if oldValue != anchor { selectionChanged() } } }
  @Published var month = false { didSet { if oldValue != month { selectionChanged() } } }
  @Published var zone = "UTC" { didSet { if oldValue != zone { selectionChanged() } } }
  @Published var employee = "" { didSet { if oldValue != employee { individual = false; individualID = "" } } }
  @Published var individual = false
  @Published var individualID = ""
  @Published private(set) var snapshot: TimeSnapshot?
  @Published private(set) var calendar: SharedDayOff?
  @Published private(set) var loading = false
  @Published private(set) var teamsLoading = false
  @Published private(set) var syncing = false
  @Published private(set) var calendarLoading = false
  @Published private(set) var stale = false
  private var discoveryComplete = false
  @Published private(set) var error = ""
  @Published private(set) var progress = ""
  private weak var session: JiraSession?
  private var client: JiraClient?
  private var viewer = ""
  private var scope = ""
  private let calendarStore: GitHubTimeCalendar?
  private var generation = UUID()
  private var discoveryGeneration = UUID()
  private var readTask: Task<Void, Never>?
  private var discoveryTask: Task<Void, Never>?
  private var calendarTask: Task<Void, Never>?
  private var syncTask: Task<Void, Never>?
  private var syncGeneration = UUID()
  init(calendarStore: GitHubTimeCalendar? = TimeServices.calendar) { self.calendarStore = calendarStore }
  var calendarConfigured: Bool { calendarStore != nil }
  var days: [String] { TimeCalendar.days(anchor: anchor, month: month) }
  var query: TimeQuery { TimeQuery(days: days, zone: zone) }
  var queryKey: String { [scope, teamID, anchor, String(month), zone].joined(separator: "|") }
  var metrics: [TimeEmployeeMetrics] { (try? TimeReportCalculator.build(users: team?.members ?? [], worklogs: snapshot?.worklogs ?? [], query: query, calendar: calendar, worklogsComplete: snapshot?.complete == true)) ?? [] }
  var selected: [TimeEmployeeMetrics] {
    metrics.filter { employee.isEmpty || $0.user.accountId == employee }.sorted {
      let order = $0.user.displayName.localizedStandardCompare($1.user.displayName)
      return order == .orderedSame ? $0.user.accountId < $1.user.accountId : order == .orderedAscending
    }
  }
  var person: TimeEmployeeMetrics? { individual ? selected.first(where: { $0.user.accountId == individualID }) ?? selected.first : nil }
  var canLoad: Bool { discoveryComplete && !teamID.isEmpty && teams.contains { $0.id == teamID } && !loading && !teamsLoading && !syncing }
  var completeResult: Bool { snapshot?.complete == true }
  func showIndividual(_ account: String) { guard selected.contains(where: { $0.user.accountId == account }) else { return }; individualID = account; individual = true }
  func attach(_ jira: JiraSession) {
    guard scope != jira.timeScope else { return }
    cancel(); discoveryComplete = false; teams = []; teamID = ""; team = nil; snapshot = nil; calendar = nil; employee = ""; individual = false; individualID = ""
    session = jira; client = jira.client; viewer = jira.user?.accountId ?? ""; scope = jira.timeScope
    zone = TimeZone.current.identifier
    anchor = TimeCalendar.text(Date(), zone: zone)
  }
  private func requireSession(_ expected: String) throws {
    try Task.checkCancellation()
    guard session?.timeScope == expected, scope == expected, !viewer.isEmpty else { throw TimeTrackingError.identity }
  }
  private func selectionChanged() {
    generation = UUID(); readTask?.cancel(); readTask = nil; calendarTask?.cancel(); calendarTask = nil; calendarLoading = false; loading = false; snapshot = nil; calendar = nil; stale = false; error = ""; progress = ""
  }
  func cancelLoading() { selectionChanged(); error = "Loading cancelled. Load again to retry." }
  func cancel() {
    cancelSync()
    generation = UUID(); discoveryGeneration = UUID(); readTask?.cancel(); discoveryTask?.cancel(); calendarTask?.cancel()
    readTask = nil; discoveryTask = nil; calendarTask = nil; loading = false; teamsLoading = false; calendarLoading = false
  }
  private func cancelSync() { syncGeneration = UUID(); syncTask?.cancel(); syncTask = nil; syncing = false }
  func discoverTeams() async {
    guard let client else { return }; discoveryTask?.cancel()
    let id = UUID(); discoveryGeneration = id; let scope = scope; let viewer = viewer
    selectionChanged(); team = nil; teamID = ""; teams = []
    teamsLoading = true; discoveryComplete = false; stale = false; error = ""; progress = "Reading your Atlassian teams…"
    let job = Task { @MainActor [weak self] in
      guard let self else { return }; defer { if discoveryGeneration == id { teamsLoading = false; discoveryTask = nil } }
      do {
        try requireSession(scope)
        let result = try await client.myTimeTeams(viewer: viewer)
        try requireSession(scope); guard discoveryGeneration == id else { return }
        discoveryComplete = true; teams = result; teamID = teams.count == 1 ? teams[0].id : ""; progress = ""
      } catch { if !Task.isCancelled, discoveryGeneration == id { self.error = error.localizedDescription } }
    }
    discoveryTask = job
    await withTaskCancellationHandler { await job.value } onCancel: { job.cancel() }
  }
  func load() async {
    guard discoveryComplete, let client, let chosen = teams.first(where: { $0.id == teamID }), !syncing else { return }
    readTask?.cancel(); let id = UUID(); generation = id
    let scope = scope; let expected = queryKey; let query = query; let viewer = viewer
    employee = ""; individual = false; individualID = ""
    snapshot = nil; calendar = nil; loading = true; error = ""; progress = "Reading Jira team membership…"
    let job = Task { @MainActor [weak self] in
      guard let self else { return }; defer { if generation == id { loading = false; readTask = nil } }
      do {
        try requireSession(scope)
        let loaded = try await client.timeTeam(chosen, viewer: viewer)
        try requireSession(scope); guard generation == id, queryKey == expected else { return }
        team = loaded
        guard !loaded.members.isEmpty else { throw TimeTrackingError.invalid("This team has no members.") }
        let logs = try await client.loadTime(query, viewer: viewer, authors: loaded.members.map(\.accountId))
        let off = try await calendarStore?.read(baseURL: client.connection.origin.absoluteString, accounts: loaded.members.map(\.accountId), days: query.days)
        _ = try TimeReportCalculator.build(users: loaded.members, worklogs: logs.worklogs, query: query, calendar: off, worklogsComplete: logs.complete)
        try requireSession(scope); guard generation == id, queryKey == expected else { return }
        snapshot = logs; calendar = off; stale = false; progress = ""
      } catch { if !Task.isCancelled, generation == id { self.error = error.localizedDescription } }
    }
    readTask = job
    await withTaskCancellationHandler { await job.value } onCancel: { job.cancel() }
  }
  func refresh() async { await discoverTeams(); if !Task.isCancelled && discoveryComplete { await load() } }
  func refreshCalendar() async {
    guard let client, let team, let store = calendarStore, !calendarLoading, !loading else { return }
    let scope = scope; let expected = queryKey; let ticket = generation; let days = days
    calendarLoading = true
    let task = Task { @MainActor [weak self] in
      guard let self else { return }; defer { if generation == ticket { calendarLoading = false; calendarTask = nil } }
      do {
        try requireSession(scope); try await client.verifyTimeUser(viewer)
        let result = try await store.read(baseURL: client.connection.origin.absoluteString, accounts: team.members.map(\.accountId), days: days)
        try requireSession(scope); guard generation == ticket, queryKey == expected else { return }; calendar = result
      } catch { if generation == ticket && !(error is CancellationError) { self.error = error.localizedDescription; calendar = nil } }
    }
    calendarTask = task; await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
  }
  func sync() async {
    guard let client, let chosen = teams.first(where: { $0.id == teamID }), let store = calendarStore, !syncing else { return }
    let scope = scope; let viewer = viewer; let expectedTeam = teamID
    let ticket = UUID(); syncGeneration = ticket
    syncing = true; error = ""; progress = "Reading live Jira team membership…"
    let task = Task { @MainActor [weak self] in
      guard let self else { return }; defer { if syncGeneration == ticket { syncing = false; syncTask = nil } }
      do {
        try requireSession(scope)
        let fresh = try await client.timeTeam(chosen, viewer: viewer)
        try requireSession(scope); guard syncGeneration == ticket, teamID == expectedTeam else { throw CancellationError() }
        try await store.sync(baseURL: client.connection.origin.absoluteString, team: fresh) { [weak self] in
          guard let self else { throw TimeTrackingError.identity }
          try await self.requireSession(scope); try await client.verifyTimeUser(viewer); try await self.requireSession(scope)
          guard await self.teamID == expectedTeam, await self.syncGeneration == ticket else { throw CancellationError() }
        }
        try requireSession(scope); guard syncGeneration == ticket, teamID == expectedTeam else { return }; progress = "Team roster synced to shared storage."
      } catch { if syncGeneration == ticket && self.scope == scope && teamID == expectedTeam && !(error is CancellationError) { self.error = error.localizedDescription } }
      }
    syncTask = task; await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
  }
}
