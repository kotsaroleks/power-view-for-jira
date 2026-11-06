import AppKit
import Combine
import PowerViewCore
import SwiftUI

extension JiraSession {
  var timeScope: String { [client?.connection.origin.absoluteString ?? "", user?.accountId ?? ""].joined(separator: "|") }
}
enum TimeServices {
  static let calendar: GitHubTimeCalendar? = {
    guard let url = Bundle.main.url(forResource: "day-off-github", withExtension: "json"),
      let data = try? Data(contentsOf: url), let config = try? JSONDecoder().decode(DayOffConfiguration.self, from: data) else { return nil }
    return try? GitHubTimeCalendar(configuration: config)
  }()
}
@MainActor final class NativeTimesheetModel: ObservableObject {
  @Published var anchor = TimeCalendar.text(Date(), zone: "UTC") { didSet { if oldValue != anchor { selectionChanged() } } }
  @Published var month = false { didSet { if oldValue != month { selectionChanged() } } }
  @Published var zone = "UTC" { didSet { if oldValue != zone { selectionChanged() } } }
  @Published private(set) var zoneSource = "jira"
  @Published private(set) var profileZone: String?
  @Published var projects: [String] = [] { didSet { if oldValue != projects { selectionChanged() } } }
  @Published var explicitJQL = "" { didSet { if oldValue != explicitJQL { selectionChanged() } } }
  @Published var boardID = ""
  @Published var pins: [String] = []
  @Published var priorities: [String] = []
  @Published var boardIssues: [TimeIssue] = []
  @Published var boards: [JiraBoardChoice] = []
  @Published private(set) var boardLoading = false
  @Published private(set) var boardError = ""
  @Published private(set) var unavailablePins: [String] = []
  @Published var snapshot: TimeSnapshot?
  @Published var calendar: SharedDayOff?
  @Published var loading = false
  @Published var writing = false
  @Published var progress = ""
  @Published var error = ""
  @Published var stale = false
  @Published private(set) var uncertain = Set<String>()
  @Published private(set) var recoveries: [String: NativePendingWorklogResult] = [:]
  @Published private(set) var calendarLoading = false
  @Published var lastSaved: TimeWorklog?
  @Published private(set) var successMessage = ""
  @Published var expanded = Set<String>()
  @Published private(set) var savingCells: [String: UUID] = [:]
  private var inlineTail: Task<Void, Never>?
  @Published private(set) var copying = false
  @Published private(set) var copyMessage = ""
  private let defaults: UserDefaults
  private let calendarStore: GitHubTimeCalendar?
  private var readTask: Task<Void, Never>?
  private var calendarReadTask: Task<Void, Never>?
  private var copyTask: Task<Void, Never>?
  private var copyGeneration = UUID()
  init(calendarStore: GitHubTimeCalendar? = TimeServices.calendar, defaults: UserDefaults = .standard) {
    self.calendarStore = calendarStore; self.defaults = defaults
  }
  var calendarConfigured: Bool { calendarStore != nil }
  var zoneWarning: String? { TimeCalendar.profileWarning(zone: profileZone, days: days) }
  func chooseZone(_ value: String) {
    if value == "jira" { zoneSource = "jira"; zone = profileZone ?? "UTC" }
    else if TimeZone(identifier: value) != nil { zoneSource = "custom"; zone = value }
    preferences()
  }
  private func selectionChanged() {
    generation = UUID(); readTask?.cancel(); calendarReadTask?.cancel(); calendarReadTask = nil; calendarLoading = false; loading = false; snapshot = nil; calendar = nil; stale = false
    cancelCopy(); error = ""; progress = ""
  }
  func cancelLoading() {
    generation = UUID(); readTask?.cancel(); readTask = nil; calendarReadTask?.cancel(); calendarReadTask = nil; calendarLoading = false; loading = false; stale = snapshot != nil
    error = "Loading cancelled. Refresh to retry; no completed selection is claimed."; progress = ""
  }
  func cancelCopy() { copyGeneration = UUID(); copyTask?.cancel(); copyTask = nil; copying = false }

  private var client: JiraClient?
  private weak var session: JiraSession?
  private var viewer = ""
  private var scope = ""
  private var prefsKey = ""
  private var known: [TimeIssue] = []
  private var boardExtras: [TimeIssue] = []
  private var pinsByBoard: [String: [String]] = [:]
  private var generation = UUID()
  private var loadedQuery = ""
  var days: [String] { TimeCalendar.days(anchor: anchor, month: month) }
  var query: TimeQuery { TimeQuery(days: days, zone: zone, projects: projects, jql: explicitJQL) }
  private var weeklyReadIssues: [TimeIssue] {
    let selected = Set(pins + priorities)
    return boardIssues.filter { $0.assigneeID == viewer || selected.contains($0.key) } + boardExtras
  }
  var queryKey: String { [scope, days.first ?? "", String(month), zone, projects.sorted().joined(separator: ","), explicitJQL, month ? "" : Set(weeklyReadIssues.map(\.id)).sorted().joined(separator: ",")].joined(separator: "|") }
  var accountID: String { viewer }
  var queryBusy: Bool { loading || writing || copying || calendarLoading || !savingCells.isEmpty }
  var records: [TimeWorklog] { snapshot?.worklogs ?? [] }
  var allIssues: [TimeIssue] {
    let included = Set((known + (month ? [] : boardIssues + boardExtras)).map(\.id))
    let logged = Set(records.map(\.issueID))
    var issues = Dictionary((snapshot?.issues ?? []).filter { logged.contains($0.id) || included.contains($0.id) }.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let permitted = Set((snapshot?.issues ?? []).map(\.id))
    let unfiltered = projects.isEmpty && TimeCalendar.filterJQL(explicitJQL).isEmpty
    for issue in (month ? [] : boardIssues + boardExtras) + known where unfiltered || permitted.contains(issue.id) { issues[issue.id] = issue }
    return issues.values.sorted { $0.key.localizedStandardCompare($1.key) == .orderedAscending }
  }
  func configure(_ jira: JiraSession) async {
    guard let client = jira.client, let user = jira.user, client.connection.deployment == .cloud else { return }
    if scope != jira.timeScope {
      selectionChanged(); known = []; boardExtras = []; boardIssues = []; boards = []; pins = []; pinsByBoard = [:]
      priorities = []; expanded = []; savingCells = [:]; uncertain = []; recoveries = [:]; lastSaved = nil; successMessage = ""; loadedQuery = ""
    }
    self.client = client; session = jira; viewer = user.accountId; scope = jira.timeScope
    prefsKey = "time.preferences." + GitHubTimeCalendar.storageKey(scope)
    let prefs = defaults.dictionary(forKey: prefsKey) ?? [:]
    profileZone = user.timeZone.flatMap { TimeZone(identifier: $0) != nil ? $0 : nil }
    let savedZone = (prefs["zone"] as? String).flatMap { TimeZone(identifier: $0) != nil ? $0 : nil }
    zoneSource = prefs["zoneSource"] as? String ?? (savedZone == nil || savedZone == profileZone || ["Europe/Kyiv", "Europe/Kiev"].contains(savedZone ?? "") ? "jira" : "custom")
    zone = zoneSource == "jira" ? profileZone ?? "UTC" : savedZone ?? profileZone ?? "UTC"
    month = false; projects = prefs["projects"] as? [String] ?? []; explicitJQL = prefs["jql"] as? String ?? ""
    boardID = prefs["board"] as? String ?? ""; pinsByBoard = prefs["pinsByBoard"] as? [String: [String]] ?? [:]
    pins = pinsByBoard[boardID] ?? prefs["pins"] as? [String] ?? []
    pinsByBoard[boardID] = pins
    priorities = prefs["priorities"] as? [String] ?? (client.connection.origin.host == "stryker-emergencycare.atlassian.net" ? ["LBR-68393"] : [])
    anchor = TimeCalendar.text(Date(), zone: zone)
    do { boards = try await client.timeBoards(); try requireSession() } catch { if !Task.isCancelled { boardError = error.localizedDescription }; return }
    await loadBoard()
  }
  func preferences() {
    guard !prefsKey.isEmpty else { return }
    pinsByBoard[boardID] = pins
    defaults.set(["zone": zone, "zoneSource": zoneSource, "month": month, "projects": projects, "jql": explicitJQL, "board": boardID, "pinsByBoard": pinsByBoard, "priorities": priorities] as [String: Any], forKey: prefsKey)
  }
  func requireSession() throws {
    try Task.checkCancellation()
    guard session?.timeScope == scope, client != nil, !viewer.isEmpty else { throw TimeTrackingError.identity }
  }
  func loadBoard() async {
    boardIssues = []; boardExtras = []; unavailablePins = []; boardError = ""
    pins = pinsByBoard[boardID] ?? []
    guard let client else { return }
    let expected = boardID; boardLoading = true
    defer { if boardID == expected { boardLoading = false } }
    do {
      if !expected.isEmpty, !boards.contains(where: { $0.id == expected }) { throw TimeTrackingError.invalid("The remembered board is unavailable. Select another board.") }
      let loaded = expected.isEmpty ? [] : try await client.timeBoardIssues(expected); try requireSession()
      guard boardID == expected else { return }; boardIssues = loaded
      for key in Set(pins + priorities) where !loaded.contains(where: { $0.key == key }) {
        do {
          let issue = try await client.timeIssue(key); try requireSession(); guard boardID == expected else { return }
          if !boardExtras.contains(where: { $0.id == issue.id }) { boardExtras.append(issue) }
        } catch {
          try Task.checkCancellation(); guard boardID == expected else { return }
          if pins.contains(key) { unavailablePins.append(key) } else { boardError = "Priority issue could not be loaded: " + key }
        }
      }
    } catch { if !Task.isCancelled, boardID == expected { boardError = "Board tasks unavailable: " + error.localizedDescription } }
  }
  func load(allowWhileWriting: Bool = false) async {
    guard let client, !writing || allowWhileWriting else { return }
    calendarReadTask?.cancel(); calendarReadTask = nil; calendarLoading = false
    readTask?.cancel()
    let ticket = UUID(); generation = ticket; let expected = queryKey; let query = query; let viewer = viewer; let sessionScope = scope
    if loadedQuery != expected { snapshot = nil; calendar = nil }
    stale = snapshot != nil; loading = true; error = ""; progress = "Searching your worklogs…"
    let job = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { if generation == ticket { loading = false; readTask = nil } }
      do {
        try requireSession(); preferences()
        let result = try await client.loadTime(query, viewer: viewer, known: known + (month ? [] : weeklyReadIssues)) { [weak self] message in
          await self?.updateProgress(message, ticket: ticket)
        }
        try requireSession(); guard generation == ticket, queryKey == expected else { return }
        profileZone = result.user?.timeZone.flatMap { TimeZone(identifier: $0) != nil ? $0 : nil }
        if zoneSource == "jira", zone != profileZone ?? "UTC" { zone = profileZone ?? "UTC"; return }
        snapshot = result; loadedQuery = expected; stale = false; calendar = nil
        if let store = calendarStore {
          let result = try await store.read(baseURL: client.connection.origin.absoluteString, accounts: [viewer], days: query.days)
          try requireSession(); guard generation == ticket, queryKey == expected else { return }; calendar = result
        }
        progress = ""
      } catch is CancellationError { if generation == ticket { stale = snapshot != nil; error = "Loading cancelled. Refresh to retry."; progress = "" } }
      catch { if generation == ticket, queryKey == expected { self.error = error.localizedDescription; progress = "" } }
    }
    readTask = job
    await withTaskCancellationHandler { await job.value } onCancel: { job.cancel() }
    if !Task.isCancelled, scope == sessionScope, zone != query.zone { await load(allowWhileWriting: allowWhileWriting) }
  }
  private func updateProgress(_ message: String, ticket: UUID) { if generation == ticket { progress = message } }
  func copyPreviousTasks() async {
    guard let client, !queryBusy, !month else { return }
    cancelCopy(); let ticket = UUID(); copyGeneration = ticket; copying = true; copyMessage = ""
    let expected = queryKey; let viewer = viewer
    let previous = TimeQuery(days: TimeCalendar.days(anchor: TimeCalendar.shift(anchor, by: -7), month: false), zone: zone, projects: projects, jql: explicitJQL)
    let job = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { if copyGeneration == ticket { copying = false; copyTask = nil } }
      do {
        try requireSession()
        let result = try await client.loadTime(previous, viewer: viewer)
        try requireSession(); guard queryKey == expected, copyGeneration == ticket else { return }
        guard result.complete else { throw TimeTrackingError.invalid("Previous week could not be read completely. Try again.") }
        let ids = Set(result.worklogs.map(\.issueID)); let tasks = result.issues.filter { ids.contains($0.id) }
        for issue in tasks where !known.contains(where: { $0.id == issue.id }) { known.append(issue) }
        copyMessage = "Added \(tasks.count) task rows from last week. No hours were copied."
        copying = false
        await load()
      } catch { if !Task.isCancelled, copyGeneration == ticket { copyMessage = error.localizedDescription } }
    }
    copyTask = job
    await withTaskCancellationHandler { await job.value } onCancel: { job.cancel() }
  }
  func addKnown(_ key: String) async {
    guard let client else { return }
    do {
      let issue = try await client.timeIssue(key.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()); try requireSession()
      if !query.scope.isEmpty {
        let matches = try await client.timeSearch("id = " + issue.id + " AND " + query.scope)
        guard matches.contains(where: { $0.id == issue.id }) else { throw TimeTrackingError.invalid("This issue does not match your visible filters. Clear the filters, or use Log time without changing this view.") }
      }
      if !known.contains(where: { $0.id == issue.id }) { known.append(issue) }
      await load()
    } catch { self.error = error.localizedDescription }
  }
  func logs(_ issue: TimeIssue, day: String) -> [TimeWorklog] {
    records.filter { $0.issueID == issue.id && $0.authorID == viewer && TimeCalendar.instant($0.started).map { TimeCalendar.text($0, zone: zone) == day } == true }
  }
  struct Row {
    var issue: TimeIssue; var depth: Int; var group: Int; var hasChildren: Bool
    var withoutParent: Bool; var parentHeading: TimeIssue?
  }
  func rows(search: String) -> [Row] {
    let issues = allIssues; let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
    if month { return issues.filter { needle.isEmpty || ($0.key + " " + $0.summary).localizedCaseInsensitiveContains(needle) }.map { Row(issue: $0, depth: 0, group: 0, hasChildren: false, withoutParent: false) } }
    let metadata = Dictionary((boardIssues + boardExtras).map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
    var parents = metadata.compactMapValues(\.parentKey)
    for issue in boardIssues + boardExtras {
      var path = Set<String>(); var key: String? = issue.key
      while let current = key, path.insert(current).inserted { key = parents[current] }
      if let key { parents.removeValue(forKey: key) }
    }
    let children = Dictionary(grouping: issues.filter { parents[$0.key] != nil }, by: { parents[$0.key]! })
    let logged = Set(records.map(\.issueID)); let pinned = Set(pins); let priority = Set(priorities)
    var groups: [String: Int] = [:]
    for issue in issues {
      var key: String? = issue.key
      while let current = key, !priority.contains(current) { key = parents[current] }
      groups[issue.key] = pinned.contains(issue.key) ? 0 : logged.contains(issue.id) ? 1 : key != nil ? 2 : metadata[issue.key]?.assigneeID == viewer ? 3 : 4
    }
    var ordered: [TimeIssue] = []; var visited = Set<String>()
    func append(_ issue: TimeIssue, group: Int) {
      guard groups[issue.key] == group, visited.insert(issue.key).inserted else { return }
      ordered.append(issue)
      for child in children[issue.key] ?? [] { append(child, group: group) }
    }
    for group in 0...4 {
      let selected = issues.filter { groups[$0.key] == group }
      if group == 2 || group == 4 {
        for issue in selected where metadata[issue.key]?.hierarchy == 1 { append(issue, group: group) }
        for issue in selected { if let parent = parents[issue.key], metadata[parent] != nil, groups[parent] != group { append(issue, group: group) } }
        for issue in selected where parents[issue.key].flatMap({ metadata[$0] }) == nil { append(issue, group: group) }
      }
      for issue in selected { append(issue, group: group) }
    }
    var result: [Row] = []; var previousParent: String?
    for issue in ordered {
      let group = groups[issue.key]!; var depth = 0; var visible = true; var parent = parents[issue.key]
      if group == 2 || group == 4 {
        while let key = parent, groups[key] == group { depth += 1; if !expanded.contains(key) { visible = false }; parent = parents[key] }
      }
      if needle.isEmpty ? !visible : !(issue.key + " " + issue.summary).localizedCaseInsensitiveContains(needle) { continue }
      let direct = parents[issue.key]; let heading = group == 4 && depth == 0 ? direct.flatMap { metadata[$0] } : nil
      result.append(Row(issue: issue, depth: depth, group: group, hasChildren: children[issue.key] != nil,
        withoutParent: group == 4 && direct.flatMap({ metadata[$0] }) == nil && metadata[issue.key]?.hierarchy != 1,
        parentHeading: heading?.key == previousParent ? nil : heading))
      previousParent = heading?.key
    }
    return result
  }
  func setOff(_ day: String, enabled: Bool) async {
    guard let client, let store = calendarStore, !writing, !uncertain.contains("calendar:" + day) else { return }
    writing = true; error = ""; defer { writing = false }
    do {
      try requireSession()
      if enabled {
        let check = try await client.loadTime(TimeQuery(days: [day], zone: zone), viewer: viewer, known: allIssues)
        guard check.complete, check.worklogs.isEmpty else { throw TimeTrackingError.invalid("Day Off cannot be set while this date has worklogs or its time could not be checked.") }
      }
      try requireSession(); let viewer = viewer
      try await store.set(baseURL: client.connection.origin.absoluteString, account: viewer, day: day, enabled: enabled) { try await client.verifyTimeUser(viewer) }
      try requireSession(); calendar = try await store.read(baseURL: client.connection.origin.absoluteString, accounts: [viewer], days: days)
    } catch { self.error = error.localizedDescription; if error as? TimeTrackingError == .unknownOutcome { uncertain.insert("calendar:" + day); calendar = nil } }
  }
  func refreshDayOff() async {
    guard let client, let store = calendarStore, !queryBusy else { return }
    let expected = queryKey; let ticket = generation; let query = query; let viewer = viewer
    calendarLoading = true
    let task = Task { @MainActor [weak self] in
      guard let self else { return }; defer { if generation == ticket { calendarLoading = false; calendarReadTask = nil } }
      do {
        try requireSession(); try await client.verifyTimeUser(viewer)
        let result = try await store.read(baseURL: client.connection.origin.absoluteString, accounts: [viewer], days: query.days)
        try requireSession(); guard generation == ticket, queryKey == expected else { return }; calendar = result
      } catch { if generation == ticket && !(error is CancellationError) { self.error = error.localizedDescription; calendar = nil } }
    }
    calendarReadTask = task; await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
  }
  func allowCalendarRetry(_ day: String) {
    guard calendar?.complete == true, days.contains(day), !calendarLoading else { return }
    uncertain.remove("calendar:" + day)
  }
  func beforeLog(day: String) async throws {
    try requireSession(); guard let client else { throw TimeTrackingError.identity }
    guard let store = calendarStore else { return }
    let fresh = try await store.read(baseURL: client.connection.origin.absoluteString, accounts: [viewer], days: [day])
    try requireSession(); guard fresh.complete else { throw TimeTrackingError.invalid(fresh.warnings.joined(separator: "\n")) }
    guard fresh.dates[viewer]?.contains(day) != true else { throw TimeTrackingError.invalid("This date is Day Off. Cancel Day Off before logging time.") }
  }
  func save(issue: TimeIssue, original: TimeWorklog?, started: String, seconds: Int, comment: String?, refreshAfter: Bool = true, onSuccess: @MainActor () -> Void) async throws {
    guard let client else { throw TimeTrackingError.identity }
    guard !writing else { throw TimeTrackingError.invalid("Another time record is being saved. Try again after it finishes.") }
    let day = TimeCalendar.instant(started).map { TimeCalendar.text($0, zone: zone) } ?? ""
    let key = issue.id + ":" + day
    guard !uncertain.contains(key) else { throw TimeTrackingError.unknownOutcome }
    writing = true; successMessage = ""; defer { writing = false }
    do {
      try await beforeLog(day: day); try requireSession()
      let saved = try await client.saveTime(issue, started: started, seconds: seconds, comment: comment, expectedUser: viewer, original: original)
      try requireSession(); if !known.contains(where: { $0.id == issue.id }) { known.append(issue) }
      lastSaved = saved
      successMessage = "Worklog saved in Jira."
      if refreshAfter {
        progress = "Saved in Jira. Refreshing your timesheet…"
        await load(allowWhileWriting: true)
        if !error.isEmpty { error = "Saved in Jira, but the timesheet could not be refreshed. " + error }
      } else if var current = snapshot {
        current.worklogs.removeAll { $0.id == saved.id }
        if let date = TimeCalendar.instant(saved.started), days.contains(TimeCalendar.text(date, zone: zone)), saved.authorID == viewer { current.worklogs.append(saved) }
        if !current.issues.contains(where: { $0.id == issue.id }) { current.issues.append(issue) }
        current.readIssueIDs.insert(issue.id)
        snapshot = current; progress = "Saved in Jira."
      }
      onSuccess()
    } catch {
      if error as? TimeTrackingError == .unknownOutcome {
        uncertain.insert(key); recoveries[key] = NativePendingWorklogResult(id: key, issue: issue, day: day, zone: zone, deleting: false)
        await reloadUnknownRecords(key)
      }
      throw error
    }
  }
  func saveInline(issue: TimeIssue, day: String, text: String, originals: [TimeWorklog]) async {
    guard let client else { return }
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    let cell = issue.id + ":" + day
    guard savingCells[cell] == nil else { return }
    let id = UUID(); savingCells[cell] = id; let previous = inlineTail; let expected = queryKey
    let task = Task { @MainActor [weak self] in
      await previous?.value
      guard let self else { return }
      defer { if savingCells[cell] == id { savingCells.removeValue(forKey: cell) }; if savingCells.isEmpty { inlineTail = nil } }
      do {
        try requireSession(); guard queryKey == expected else { throw TimeTrackingError.conflict }
        guard let value = TimeCalendar.parseHours(text) else { throw TimeTrackingError.invalid("Enter hours, e.g. 1.5 or 1:30. Use details to delete time.") }
        guard originals.count <= 1 else { throw TimeTrackingError.invalid("Open details to edit individual worklogs.") }
        if originals.first?.seconds == value { return }
        let current = try await client.timeWorklogs(issue).filter { $0.authorID == self.viewer && TimeCalendar.instant($0.started).map { TimeCalendar.text($0, zone: self.zone) == day } == true }
        guard Set(current) == Set(originals) else { throw TimeTrackingError.conflict }
        let choices = TimeCalendar.localChoices(day: day, clock: "09:00", zone: zone)
        guard originals.first != nil || choices.count == 1 else { throw TimeTrackingError.invalid("Choose an explicit start time using Log time.") }
        try await save(issue: issue, original: originals.first, started: originals.first?.started ?? choices[0], seconds: value, comment: nil, refreshAfter: false, onSuccess: {})
      } catch { if queryKey == expected { self.error = issue.key + ": " + error.localizedDescription } }
    }
    inlineTail = task; await task.value
  }
  func delete(issue: TimeIssue, log: TimeWorklog) async throws {
    guard let client else { throw TimeTrackingError.identity }
    guard !writing else { throw TimeTrackingError.invalid("Another time record is being saved. Try again after it finishes.") }
    let key = issue.id + ":delete:" + log.id
    guard !uncertain.contains(key) else { throw TimeTrackingError.unknownOutcome }
    writing = true; successMessage = ""; defer { writing = false }
    do { try requireSession(); try await client.deleteTime(issue, original: log, expectedUser: viewer); try requireSession() }
    catch {
      if error as? TimeTrackingError == .unknownOutcome {
        uncertain.insert(key)
        let day = TimeCalendar.instant(log.started).map { TimeCalendar.text($0, zone: zone) } ?? ""
        recoveries[key] = NativePendingWorklogResult(id: key, issue: issue, day: day, zone: zone, deleting: true)
        await reloadUnknownRecords(key)
      }
      throw error
    }
    lastSaved = nil; successMessage = "Worklog deleted in Jira."
    await load(allowWhileWriting: true)
    if !error.isEmpty { error = "Deleted in Jira, but the timesheet could not be refreshed. " + error }
  }
  func reloadUnknownRecords(_ id: String) async {
    guard let client, var pending = recoveries[id], !pending.reading else { return }
    let expected = scope; let viewer = viewer; let zone = pending.zone
    pending.reading = true; pending.error = ""; recoveries[id] = pending
    do {
      try requireSession(); try await client.verifyTimeUser(viewer)
      let logs = try await client.timeWorklogs(pending.issue)
      try requireSession(); guard scope == expected, recoveries[id]?.attempt == pending.attempt else { return }
      pending.records = logs.filter { $0.authorID == viewer && TimeCalendar.instant($0.started).map { TimeCalendar.text($0, zone: zone) == pending.day } == true }
      pending.reading = false; recoveries[id] = pending
    } catch {
      guard scope == expected, recoveries[id]?.attempt == pending.attempt else { return }
      pending.records = nil; pending.reading = false; pending.error = "Jira could not be reread. Refresh records before allowing another attempt. " + error.localizedDescription; recoveries[id] = pending
    }
  }
  func allowWorklogRetry(_ id: String) {
    guard let pending = recoveries[id], pending.records != nil, !pending.reading else { return }
    recoveries.removeValue(forKey: id); uncertain.remove(id); error = ""
  }
}
struct NativeTimesheetView: View {
  @ObservedObject var jira: JiraSession
  var savedJQL = ""
  var onDirty: (Bool) -> Void = { _ in }
  var onBusy: (Bool) -> Void = { _ in }
  @StateObject private var model = NativeTimesheetModel()
  private let loadsAutomatically: Bool
  @State private var ready = false
  @State private var search = ""
  @State private var key = ""
  @State private var filterDraft = ""
  @State private var projectSearch = ""
  @State private var projectOptions: [JSONValue] = []
  @State private var editorDirty = false
  @StateObject private var presentation = NativeWorklogPresentation()
  @StateObject private var gridPosition: NativeTimeGridPosition
  @FocusState private var focusedCell: String?
  @State private var pendingCellFocus: String?
  @State private var inlineDirty = Set<String>()
  @State private var discardRefresh = false
  @State private var showFilters = false
  @State private var gridRevision = 0
  @State private var horizontalOffset: CGFloat = 0
  @State private var tableViewportWidth: CGFloat = 1087
  @State private var cellDrafts: [String: String] = [:]
  @State private var showEntryHelp = false
  @State private var showKnownIssue = false
  @State private var checkedCalendarDays = Set<String>()
  init(
    jira: JiraSession, savedJQL: String = "", onDirty: @escaping (Bool) -> Void = { _ in },
    model: NativeTimesheetModel? = nil, loadsAutomatically: Bool = true, position: NativeTimeGridPosition? = nil, onBusy: @escaping (Bool) -> Void = { _ in }
  ) {
    _jira = ObservedObject(wrappedValue: jira)
    self.savedJQL = savedJQL
    self.onDirty = onDirty; self.onBusy = onBusy
    _model = StateObject(wrappedValue: model ?? NativeTimesheetModel())
    _gridPosition = StateObject(wrappedValue: position ?? NativeTimeGridPosition())
    self.loadsAutomatically = loadsAutomatically
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      headerTitle
      periodControls
      if !model.month {
        ProductFlowLayout {
          boardControl.disabled(!model.uncertain.isEmpty)
          Button(model.copying ? "Reading previous week…" : "Copy last week's tasks") { Task { await model.copyPreviousTasks() } }.buttonStyle(.plain).foregroundStyle(PV.accent).disabled(model.queryBusy || !model.uncertain.isEmpty)
          entryHelp
          calendarStatus
        }.disabled(!inlineDirty.isEmpty || model.writing || !model.savingCells.isEmpty)
      } else { calendarStatus }
      lookupControls.disabled(!inlineDirty.isEmpty || model.writing || !model.savingCells.isEmpty || !model.uncertain.isEmpty)
      if !model.month && model.boardLoading { ProgressView("Loading your tasks…").controlSize(.small) }
      if !model.month && !model.boardError.isEmpty { HStack { Text(model.boardError).font(.caption).foregroundStyle(.orange); Button("Retry board tasks") { Task { await model.loadBoard() } } } }
      if !model.month { ForEach(model.unavailablePins, id: \.self) { key in HStack { Text(key + " could not be loaded").font(.caption); Button("Unpin") { model.pins.removeAll { $0 == key }; model.preferences(); Task { await model.loadBoard() } } } } }
      coverage
      if model.stale { Text("Previous results — refresh pending").font(.caption).foregroundStyle(.orange) }
      if model.loading { HStack { ProgressView().controlSize(.small); Text(model.progress).font(.caption); Button("Cancel loading") { model.cancelLoading() }.font(.caption) } }
      if !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        let visibleIDs = Set(model.rows(search: search).map(\.issue.id))
        Text("Visible rows: " + TimeCalendar.duration(model.records.filter { visibleIDs.contains($0.issueID) }.reduce(0) { $0 + $1.seconds }) + ". Full loaded selection: " + TimeCalendar.duration(model.records.reduce(0) { $0 + $1.seconds }) + ".").font(.caption).foregroundStyle(PV.secondary)
      }
      if !model.calendarConfigured { Text("Day Off storage is not configured.").font(.caption).foregroundStyle(.orange) }
      if let warning = model.zoneWarning { Text(warning).font(.caption).foregroundStyle(.orange) }
      if !model.copyMessage.isEmpty { Text(model.copyMessage).font(.caption) }
      if !model.error.isEmpty { Text(model.error).foregroundStyle(.red).textSelection(.enabled) }
      ForEach(model.snapshot?.warnings ?? [], id: \.self) { Text($0).font(.caption).foregroundStyle(.orange) }
      ForEach(model.calendar?.warnings ?? [], id: \.self) { Text($0).font(.caption).foregroundStyle(.orange) }
      if !model.successMessage.isEmpty {
        Text(model.successMessage).font(.system(size: 13)).foregroundStyle(PV.green).padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color(hex: 0xe5f6ee), in: RoundedRectangle(cornerRadius: 6)).overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0xb7dfcc)))
      }
      ForEach(model.recoveries.keys.sorted(), id: \.self) { id in NativeWorklogRecoveryNotice(model: model, id: id) }
      ForEach(model.uncertain.filter { $0.hasPrefix("calendar:") }.sorted(), id: \.self) { key in
        let day = String(key.dropFirst("calendar:".count))
        VStack(alignment: .leading, spacing: 6) {
          Text("Day Off result unknown for " + day + ". Refresh Day Off and check the date before enabling changes.").font(.caption)
          Toggle("I refreshed and checked this date", isOn: Binding(get: { checkedCalendarDays.contains(day) }, set: { if $0 { checkedCalendarDays.insert(day) } else { checkedCalendarDays.remove(day) } })).font(.caption)
          Button("Enable changes for " + day) { model.allowCalendarRetry(day) }.disabled(!checkedCalendarDays.contains(day) || model.calendar?.complete != true || model.calendarLoading)
        }.padding(10).background(Color(hex: 0xfff7d6), in: RoundedRectangle(cornerRadius: 8))
      }
      if let saved = model.lastSaved, !model.records.contains(where: { $0.id == saved.id }) {
        HStack {
          Text("Saved in Jira outside the current view.").font(.caption)
          Button("Show saved record") {
            if let instant = TimeCalendar.instant(saved.started) { model.anchor = TimeCalendar.text(instant, zone: model.zone) }
            model.projects = []; model.explicitJQL = ""; filterDraft = ""
          }
        }
      }
      if model.snapshot != nil { Text((model.snapshot?.complete == true ? "" : "Loaded records only · ") + "Personal worklogs · " + model.zone + (model.zoneSource == "jira" ? " · Jira profile" : "")).font(.caption).foregroundStyle(PV.secondary) }
      if model.snapshot != nil && !model.loading && model.rows(search: search).isEmpty && model.error.isEmpty {
        VStack(alignment: .leading, spacing: 8) {
          Text(search.isEmpty ? "No worklogs found for this selection." : "No loaded rows match this search.").font(.headline)
          if !search.isEmpty { Button("Clear search") { search = "" } }
          else { Text(model.boardID.isEmpty && !model.month ? "Choose your board to see its tasks, or add/check a known issue by key." : "Change the period or filters, or add/check a known issue by key.").font(.caption).foregroundStyle(PV.secondary) }
        }.frame(maxWidth: .infinity, minHeight: 160, alignment: .center).padding(16).productCard(8)
      } else { table.id(gridRevision) }
      DisclosureGroup("Selection details") {
        Text("Instance: \(jira.client?.connection.origin.absoluteString ?? "—")\nAccount: \(model.accountID)\nTimezone: \(model.zone)\nCandidates: \(model.snapshot?.issues.count ?? 0) · Read issues: \(model.snapshot?.readIssueCount ?? 0) · Received worklogs: \(model.snapshot?.readWorklogCount ?? 0)\nRead: \(model.snapshot?.loadedAt.formatted() ?? "—")\n\(model.snapshot?.discoveryJQL ?? "")").font(.caption).textSelection(.enabled)
      }
    }.font(.system(size: 13)).foregroundStyle(PV.ink)
      .task(id: jira.timeScope) { if loadsAutomatically { ready = false; await model.configure(jira); ready = true } }
      .task(id: ready ? model.queryKey : "not-ready") { if loadsAutomatically && ready { await model.load() } }
      .task(id: model.boardID) { if loadsAutomatically && ready { await model.loadBoard(); model.preferences() } }
      .onChange(of: model.writing) { _, _ in reportDirty() }
      .onChange(of: model.savingCells) { _, _ in reportDirty() }
      .onChange(of: model.uncertain) { _, _ in reportDirty() }
      .onChange(of: inlineDirty) { _, _ in reportDirty() }
      .onChange(of: presentation.editor?.id) { _, _ in editorDirty = false; reportDirty() }
      .onChange(of: model.loading) { _, loading in if !loading, let target = pendingCellFocus { pendingCellFocus = nil; restoreCellFocus(target) } }
      .sheet(item: $presentation.editor, onDismiss: { restoreCellFocus(presentation.editorDismissed()) }) { request in NativeWorklogEditor(jira: jira, model: model, request: request, onDirty: { editorDirty = $0; reportDirty() }) { presentation.closeEditor() } }
      .sheet(item: $presentation.details, onDismiss: { restoreCellFocus(presentation.detailsDismissed()) }) { request in NativeWorklogDetails(model: model, request: request, edit: presentation.edit, addAnother: presentation.addAnother, deleted: presentation.deleted) }
      .confirmationDialog("Discard unsaved cell changes and refresh?", isPresented: $discardRefresh) { Button("Discard and refresh", role: .destructive) { inlineDirty = []; cellDrafts.removeAll(); gridRevision += 1; Task { await model.load() } }; Button("Cancel", role: .cancel) {} }
      .onDisappear { if loadsAutomatically { model.cancelLoading(); model.cancelCopy(); onDirty(false); onBusy(false) } }
  }
  private func reportDirty() {
    let busy = model.writing || !model.savingCells.isEmpty
    onBusy(busy); onDirty(busy || editorDirty || !inlineDirty.isEmpty || !model.uncertain.isEmpty)
  }
  private func restoreCellFocus(_ target: String?) {
    guard let target else { return }
    let parts = target.split(separator: ":", maxSplits: 1).map(String.init)
    if parts.count == 2 { gridPosition.reveal(issueID: parts[0], day: parts[1]) }
    Task { @MainActor in await Task.yield(); await Task.yield(); focusedCell = target }
  }
  private func activateCell(_ issue: TimeIssue, day: String, unread: Bool) {
    Task { @MainActor in
      if unread { await model.addKnown(issue.key); guard model.snapshot?.readIssueIDs.contains(issue.id) == true else { return } }
      if model.logs(issue, day: day).isEmpty {
        let target = issue.id + ":" + day
        if model.month { pendingCellFocus = target; model.month = false } else { restoreCellFocus(target) }
      } else { presentation.openDetails(issue: issue, day: day) }
    }
  }
  private var headerTitle: some View {
    ProductFlowLayout(spacing: 16) {
      Text("Timesheet").font(.system(size: 24, weight: .bold))
      Text((jira.user?.displayName ?? "") + " · " + (jira.client?.connection.origin.host ?? "")).font(.system(size: 13)).foregroundStyle(PV.secondary)
    }
  }
  private var boardControl: some View {
    Picker("Board", selection: $model.boardID) { Text("Select your board").tag(""); ForEach(model.boards) { Text($0.name).tag($0.id) } }.frame(width: 250).controlSize(.large)
  }
  private var calendarStatus: some View {
    Group { if model.calendarConfigured {
      HStack(spacing: 10) {
        Text(model.calendar?.complete == true ? "Day Off synced with GitHub" : "Shared Day Off is unavailable.").font(.caption).foregroundStyle(PV.secondary)
        Button(model.calendarLoading ? "Refreshing…" : "Refresh Day Off") { Task { await model.refreshDayOff() } }.buttonStyle(.plain).foregroundStyle(PV.accent).disabled(model.queryBusy || !inlineDirty.isEmpty)
      }
    } }
  }
  private var entryHelp: some View {
    Button("▸ Time entry help") { showEntryHelp = true }.buttonStyle(.plain).foregroundStyle(PV.secondary).popover(isPresented: $showEntryHelp) {
      Text("Enter hours: 2, 1.5 or 1:30. Tab moves to the next day. Changes save when you leave a cell. New entries use 09:00 in \(model.zone). Multiple worklogs open in details. Option + Down opens details; Escape cancels a cell edit.").font(.callout).padding(16).frame(width: 340)
    }
  }
  private var lookupControls: some View {
    ProductFlowLayout(spacing: 12) {
      Button("▸ Filters & time zone" + (model.projects.isEmpty ? " · all projects" : " · \(model.projects.count) projects")) { showFilters = true }.buttonStyle(.plain).foregroundStyle(PV.secondary).popover(isPresented: $showFilters) { filtersView }
      HStack(spacing: 6) {
        Text("Find issue")
        TextField("Filter loaded rows", text: $search).textFieldStyle(.plain).padding(.horizontal, 9).frame(width: 185, height: 32).background(.white, in: RoundedRectangle(cornerRadius: 6)).overlay(RoundedRectangle(cornerRadius: 6).stroke(PV.border))
      }
      Button("▸ Add/check issue by key") { showKnownIssue = true }.buttonStyle(.plain).foregroundStyle(PV.secondary).popover(isPresented: $showKnownIssue) {
        VStack(alignment: .leading, spacing: 10) {
          Text("Jira issue key").font(.headline)
          HStack { TextField("LBR-123", text: $key).onSubmit { Task { await model.addKnown(key); if model.error.isEmpty { showKnownIssue = false } } }; Button("Check issue") { Task { await model.addKnown(key); if model.error.isEmpty { showKnownIssue = false } } }.disabled(key.isEmpty || model.queryBusy) }
          Text("Reads this issue without creating a time record.").font(.caption).foregroundStyle(PV.secondary)
        }.padding(16).frame(width: 390)
      }
    }
  }
  private var coverage: some View {
    ProductFlowLayout(spacing: 10) {
      Text("Found time: " + (model.snapshot.map { TimeCalendar.duration($0.worklogs.reduce(0) { $0 + $1.seconds }) } ?? "—")).font(.system(size: 16, weight: .bold))
      Text(model.snapshot == nil ? "— issues with worklogs" : "\(Set(model.records.map(\.issueID)).count) issues with worklogs").font(.system(size: 12))
      Text("Jira search may omit part of your history.").font(.system(size: 12)).help(TimeSnapshot.coverageNotice)
    }.padding(.horizontal, 12).padding(.vertical, 6).frame(maxWidth: .infinity, alignment: .leading).background(Color(hex: 0xf4f7fc), in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0xe0e7f1)))
  }
  private var filtersView: some View {
      VStack(alignment: .leading, spacing: 12) {
        Text("Filters and timezone").font(.headline)
        VStack(alignment: .leading, spacing: 10) {
          Picker("Time zone", selection: Binding(get: { model.zoneSource == "jira" ? "jira" : model.zone }, set: { model.chooseZone($0) })) {
            Text("Jira profile · " + (model.profileZone ?? "unavailable — UTC")).tag("jira")
            ForEach(Array(Set(TimeZone.knownTimeZoneIdentifiers + [model.zone, "UTC", "Europe/Kyiv"])).sorted(), id: \.self) { Text($0).tag($0) }
          }
          HStack { TextField("Search projects", text: $projectSearch); Button("Search") { Task { do { projectOptions = try await jira.client?.workspaceProjects(query: projectSearch)["values"].array ?? [] } catch { model.error = error.localizedDescription } } } }
          ForEach(projectOptions, id: \.self) { project in
            Toggle(project["key"].plainText + " · " + project["name"].plainText, isOn: Binding(get: { model.projects.contains(project["id"].plainText) }, set: { value in model.projects.removeAll { $0 == project["id"].plainText }; if value { model.projects.append(project["id"].plainText) } }))
          }
          HStack { TextField("Explicit JQL filter", text: $filterDraft); Button("Apply") { model.explicitJQL = filterDraft }; Button("Use current context") { filterDraft = TimeCalendar.filterJQL(savedJQL); model.explicitJQL = filterDraft }.disabled(savedJQL.isEmpty); Button("Clear filters") { model.projects = []; model.explicitJQL = ""; filterDraft = "" } }
          if !model.projects.isEmpty || !model.explicitJQL.isEmpty { Text("Active filters: " + model.query.scope).font(.caption) }
        }
      }.disabled(model.queryBusy || !inlineDirty.isEmpty || !model.uncertain.isEmpty)
      .padding(20).frame(width: 620)
  }
  private var periodControls: some View {
    ProductFlowLayout {
      Picker("Period", selection: $model.month) { Text("Week").tag(false); Text("Month").tag(true) }.frame(width: 145).controlSize(.large)
      Button("←") { model.anchor = TimeCalendar.adjacent(model.anchor, month: model.month, direction: -1) }.accessibilityLabel("Previous period")
      Button("Today") { model.anchor = TimeCalendar.text(Date(), zone: model.zone) }
      Button("→") { model.anchor = TimeCalendar.adjacent(model.anchor, month: model.month, direction: 1) }.accessibilityLabel("Next period")
      DatePicker("Go to date", selection: Binding(get: { TimeCalendar.instant(model.anchor + "T12:00:00Z") ?? Date() }, set: { model.anchor = TimeCalendar.text($0, zone: "UTC") }), displayedComponents: .date).environment(\.timeZone, TimeZone(secondsFromGMT: 0)!).controlSize(.large)
      Text((model.days.first ?? "") + " — " + (model.days.last ?? "")).font(.caption.bold())
      Button("Refresh") { if inlineDirty.isEmpty { Task { await model.load() } } else { discardRefresh = true } }.disabled(model.queryBusy)
    }.buttonStyle(ProductButton()).disabled(model.writing || model.copying || !inlineDirty.isEmpty || !model.uncertain.isEmpty)
  }
  private var dayCellWidth: CGFloat { max(104, (tableViewportWidth - 275 - 84) / CGFloat(max(1, model.days.count))) }
  private var table: some View {
    let rows = model.rows(search: search)
    let today = TimeCalendar.text(Date(), zone: model.zone)
    let weekends = Set(model.days.filter { day in
      guard let date = TimeCalendar.instant(day + "T12:00:00Z") else { return false }
      return ["Sat", "Sun"].contains(TimeCalendar.text(date, zone: "UTC", pattern: "EEE"))
    })
    let firstWithoutParent = rows.first(where: \.withoutParent)?.issue.id
    let headings = Dictionary(uniqueKeysWithValues: rows.enumerated().map { index, row in
      var titles: [String] = []
      if !model.month {
        if index == 0 || rows[index - 1].group != row.group { titles.append(["Pinned issues", "My worklogs this week", "Priority issues", "Assigned to me", "Other issues"][row.group]) }
        if row.withoutParent && row.issue.id == firstWithoutParent { titles.append("Without parent issue") }
        if let parent = row.parentHeading { titles.append("Children of " + parent.key) }
      }
      return (row.issue.id, titles)
    })
    return VStack(spacing: 0) {
      HStack(spacing: 0) {
        Text("Issue").font(.system(size: 12, weight: .semibold)).frame(width: 275, height: 54)
        GeometryReader { _ in
                    HStack(spacing: 0) {
            ForEach(model.days, id: \.self) { day in
              VStack(spacing: 5) {
                Text(TimeCalendar.instant(day + "T12:00:00Z").map { TimeCalendar.text($0, zone: "UTC", pattern: "EEE d") } ?? day).font(.system(size: 12, weight: .semibold))
                Toggle("Day Off", isOn: Binding(get: { model.calendar?.dates[model.accountID]?.contains(day) == true }, set: { enabled in Task { await model.setOff(day, enabled: enabled) } }))
                  .toggleStyle(.checkbox).font(.system(size: 10)).disabled(model.calendar?.complete != true || model.queryBusy || !inlineDirty.isEmpty || (!model.records.filter { TimeCalendar.instant($0.started).map { TimeCalendar.text($0, zone: model.zone) == day } == true }.isEmpty && model.calendar?.dates[model.accountID]?.contains(day) != true))
                  .help(model.calendar?.complete != true ? "Shared calendar has not been read successfully." : "Day Off cannot be set on a date with worklogs.")
              }.frame(width: dayCellWidth, height: 54)
                .background(model.calendar?.dates[model.accountID]?.contains(day) == true ? PV.subtle : day == today ? PV.accent.opacity(0.12) : weekends.contains(day) ? Color(hex: 0xf8f9fc) : .clear)
                .accessibilityLabel(day == today ? day + ", today" : day)
            }
            Text("Total").font(.caption.bold()).frame(width: 84, height: 54)
          }
            .offset(x: horizontalOffset)
        }.frame(height: 54).clipped()
      }.background(PV.subtle)
      ScrollViewReader { vertical in
      ScrollView(.vertical) {
        HStack(alignment: .top, spacing: 0) {
          LazyVStack(spacing: 0) {
        ForEach(rows, id: \.issue.id) { row in
          VStack(spacing: 0) {
          ForEach(headings[row.issue.id] ?? [], id: \.self) { title in
            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(PV.secondary).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8).frame(height: 28).background(PV.subtle)
          }
          HStack(spacing: 4) {
            if row.hasChildren && (row.group == 2 || row.group == 4) {
              Button(model.expanded.contains(row.issue.key) ? "⌄" : "›") { if !model.expanded.insert(row.issue.key).inserted { model.expanded.remove(row.issue.key) } }.buttonStyle(.plain).accessibilityLabel((model.expanded.contains(row.issue.key) ? "Collapse " : "Expand ") + row.issue.key).disabled(!inlineDirty.isEmpty || model.queryBusy)
            }
            if !model.month && !model.boardID.isEmpty {
              Button { if model.pins.contains(row.issue.key) { model.pins.removeAll { $0 == row.issue.key } } else { model.pins.append(row.issue.key) }; model.preferences() } label: {
                Image(systemName: model.pins.contains(row.issue.key) ? "pin.fill" : "pin").font(.system(size: 14)).foregroundStyle(model.pins.contains(row.issue.key) ? PV.accent : PV.secondary)
              }.help("Pin issue").accessibilityLabel((model.pins.contains(row.issue.key) ? "Unpin " : "Pin ") + row.issue.key).disabled(!inlineDirty.isEmpty || model.queryBusy || !model.uncertain.isEmpty)
            }
            VStack(alignment: .leading, spacing: 2) {
              if let base = jira.client?.connection.origin, let url = URL(string: base.absoluteString + "/browse/" + row.issue.key) { Link(row.issue.key, destination: url).font(.system(size: 13, weight: .semibold)).foregroundStyle(PV.accent) }
              Text(row.issue.summary).font(.system(size: 13)).lineLimit(2).help(row.issue.summary)
            }.frame(maxWidth: .infinity, alignment: .leading)
            if !model.month && model.snapshot?.readIssueIDs.contains(row.issue.id) != true && model.snapshot?.failedIssueIDs.contains(row.issue.id) != true {
              Button("Load hours") { Task { await model.addKnown(row.issue.key) } }.font(.system(size: 10)).foregroundStyle(PV.accent).disabled(model.queryBusy || !inlineDirty.isEmpty)
            }
          }.buttonStyle(.plain).padding(.leading, CGFloat(row.depth * 20)).frame(height: 60).padding(.horizontal, 5).background(.white)
            .overlay(alignment: .bottom) { PV.border.frame(height: 1) }
          }.id("issue:" + row.issue.id)
        }
        Text(search.isEmpty ? "Total" : "Visible totals").font(.caption.bold()).frame(height: 40)
          }.frame(width: 275)
          ScrollViewReader { horizontal in
          ScrollView(.horizontal) {
            LazyVStack(spacing: 0) {
          ForEach(rows, id: \.issue.id) { row in
            VStack(spacing: 0) {
            ForEach(headings[row.issue.id] ?? [], id: \.self) { _ in PV.subtle.frame(height: 28) }
            HStack(spacing: 0) {
              ForEach(model.days, id: \.self) { day in
                let logs = model.logs(row.issue, day: day)
                let off = model.calendar?.dates[model.accountID]?.contains(day) == true
                let cellID = row.issue.id + ":" + day
                let unread = model.snapshot?.readIssueIDs.contains(row.issue.id) != true
                NativeTimeCell(label: row.issue.key + " · " + day, cellID: cellID, focus: $focusedCell, logs: logs, text: Binding(get: { cellDrafts[cellID] ?? (logs.isEmpty ? "" : TimeCalendar.inlineText(logs.reduce(0) { $0 + $1.seconds })) }, set: { cellDrafts[cellID] = $0 }), inline: !model.month && !unread, unread: unread, off: off, weekend: weekends.contains(day), disabled: !model.recoveries.isEmpty || model.loading || model.copying || model.calendarLoading || model.savingCells[cellID] != nil || model.snapshot == nil || model.stale || !model.snapshot!.complete || model.uncertain.contains(row.issue.id + ":" + day), dirty: { value in let id = row.issue.id + ":" + day; if value { inlineDirty.insert(id) } else { inlineDirty.remove(id) } }, save: { text in Task { await model.saveInline(issue: row.issue, day: day, text: text, originals: logs) } }, details: { activateCell(row.issue, day: day, unread: unread) }).frame(width: dayCellWidth, height: 60).id("cell:" + cellID)
              }
              Text(model.snapshot?.readIssueIDs.contains(row.issue.id) == true ? TimeCalendar.duration(model.records.filter { $0.issueID == row.issue.id }.reduce(0) { $0 + $1.seconds }) : "?").font(.caption.bold()).frame(width: 84, height: 60)
            }
            }
          }
          HStack(spacing: 0) {
            ForEach(model.days, id: \.self) { day in Text(TimeCalendar.duration(rows.reduce(0) { sum, row in sum + model.logs(row.issue, day: day).reduce(0) { $0 + $1.seconds } })).font(.caption.bold()).frame(width: dayCellWidth, height: 40) }
            Text(TimeCalendar.duration(rows.reduce(0) { sum, row in sum + model.records.filter { $0.issueID == row.issue.id }.reduce(0) { $0 + $1.seconds } })).font(.caption.bold()).frame(width: 84, height: 40)
          }
            }.background(GeometryReader { proxy in
              Color.clear.preference(key: TimeHorizontalOffset.self, value: proxy.frame(in: .named("TimeHorizontal")).minX)
            })
          }.coordinateSpace(name: "TimeHorizontal")
            .onChange(of: gridPosition.request?.id) { _, _ in if let request = gridPosition.request { horizontal.scrollTo("cell:" + request.issueID + ":" + request.day, anchor: .center) } }
          }
        }
        .background(GeometryReader { proxy in Color.clear.preference(key: TimeVerticalOffset.self, value: proxy.frame(in: .named("TimeVertical")).minY) })
      }.coordinateSpace(name: "TimeVertical").frame(height: min(450, max(230, CGFloat(rows.count) * 60 + 40)))
        .onChange(of: gridPosition.request?.id) { _, _ in if let request = gridPosition.request { vertical.scrollTo("issue:" + request.issueID, anchor: .top) } }
      }
    }.onPreferenceChange(TimeHorizontalOffset.self) { value in horizontalOffset = value; Task { @MainActor in gridPosition.recordHorizontal(value) } }
      .onPreferenceChange(TimeVerticalOffset.self) { value in Task { @MainActor in gridPosition.recordVertical(value) } }
      .background(GeometryReader { proxy in Color.clear.onAppear { tableViewportWidth = proxy.size.width }.onChange(of: proxy.size.width) { _, width in tableViewportWidth = width } })
      .overlay(RoundedRectangle(cornerRadius: 8).stroke(PV.border))
  }
}
private struct TimeHorizontalOffset: PreferenceKey {
  static let defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
private struct TimeVerticalOffset: PreferenceKey {
  static let defaultValue: CGFloat = 0
  static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
private struct NativeTimeCell: View {
  let label: String
  let cellID: String
  let focus: FocusState<String?>.Binding
  let logs: [TimeWorklog]; @Binding var text: String; let inline: Bool; let unread: Bool; let off: Bool; let weekend: Bool; let disabled: Bool
  let dirty: (Bool) -> Void; let save: (String) -> Void; let details: () -> Void
  private var focused: Bool { focus.wrappedValue == cellID }
  private var initial: String { logs.isEmpty ? "" : TimeCalendar.inlineText(logs.reduce(0) { $0 + $1.seconds }) }
  private func commit() {
    guard text != initial, !disabled, !off else { return }
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || logs.first.map({ $0.seconds == TimeCalendar.parseHours(text) }) == true {
      text = initial; dirty(false)
    } else { save(text) }
  }
  var body: some View {
    HStack(spacing: 2) {
      if inline && logs.count <= 1 {
        TextField(off ? "Off" : "—", text: $text).accessibilityLabel(label).help("Enter hours: 2, 1.5 or 1:30. Tab saves and moves to the next day. Escape discards this edit. Option + Down opens worklog details.").focused(focus, equals: cellID).textFieldStyle(.plain).multilineTextAlignment(.center).onSubmit { commit(); focus.wrappedValue = nil }.disabled(disabled || off)
          .onChange(of: text) { _, value in dirty(value != initial) }
          .onKeyPress(keys: [.downArrow]) { press in if press.modifiers.contains(.option), !logs.isEmpty { details(); return .handled }; return .ignored }
        if !logs.isEmpty { Button(action: details) { Image(systemName: "ellipsis.circle").font(.caption) }.buttonStyle(.plain).focusable(false).accessibilityLabel("Worklog details for " + label).help("Edit description, start time or delete this entry. Option + Down from the hours field.").disabled(disabled) }
      } else {
        Button(unread ? "?" : logs.isEmpty ? (off ? "Off" : "+") : TimeCalendar.duration(logs.reduce(0) { $0 + $1.seconds }), action: details).buttonStyle(.plain).font(.caption).focused(focus, equals: cellID).accessibilityLabel(label + (unread ? ", load hours" : logs.isEmpty ? ", enter hours" : ", worklog details")).disabled(disabled || off && logs.isEmpty)
      }
    }.padding(5).frame(maxWidth: .infinity, maxHeight: .infinity).background(off && !logs.isEmpty ? Color.red.opacity(0.12) : off ? PV.subtle : weekend ? Color(hex: 0xf8f9fc) : .white)
      .overlay(alignment: .bottom) { PV.border.frame(height: 1) }
      .overlay(RoundedRectangle(cornerRadius: 4).stroke(focused ? PV.accent : .clear, lineWidth: 2))
      .onChange(of: focused) { old, active in if old && !active { commit() } }
      .onChange(of: logs) { _, _ in text = initial; dirty(false) }
      .onKeyPress(.escape) { text = initial; dirty(false); return .handled }
  }
}
struct NativeWorklogDetails: View {
  @ObservedObject var model: NativeTimesheetModel
  let request: TimeEditorRequest; let edit: (TimeWorklog) -> Void; let addAnother: () -> Void
  var deleted: () -> Void = {}
  @Environment(\.dismiss) private var dismiss
  @State private var pendingDelete: TimeWorklog?
  @State private var error = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack { Text((request.issue?.key ?? "") + " · " + request.day).font(.title3.bold()); Spacer(); Button("Close") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.writing) }
      let records = request.issue.map { model.logs($0, day: request.day) } ?? []
      Text("\(records.count) worklogs · \(TimeCalendar.duration(records.reduce(0) { $0 + $1.seconds })) · \(model.zone). All time belongs to the start day.").font(.caption).foregroundStyle(PV.secondary)
      ScrollView {
        ForEach(records) { log in
          VStack(alignment: .leading, spacing: 7) {
            Text(TimeCalendar.duration(log.seconds) + " · " + (TimeCalendar.instant(log.started).map { TimeCalendar.text($0, zone: model.zone, pattern: "yyyy-MM-dd HH:mm:ss") } ?? log.started)).font(.headline)
            Text("Worklog " + log.id).font(.caption).foregroundStyle(PV.secondary)
            Text(log.commentText).textSelection(.enabled)
            HStack { Button("Edit") { edit(log) }; Button("Delete", role: .destructive) { pendingDelete = log } }.disabled(model.writing || model.recoveries.values.contains { $0.issue.id == request.issue?.id })
          }.frame(maxWidth: .infinity, alignment: .leading).padding(12).productCard(8)
        }
      }
      if !error.isEmpty { Text(error).foregroundStyle(.red) }
      ForEach(model.recoveries.values.filter { $0.issue.id == request.issue?.id }.sorted { $0.id < $1.id }) { pending in NativeWorklogRecoveryNotice(model: model, id: pending.id) }
      Button("Add another worklog", action: addAnother).buttonStyle(ProductButton(primary: true)).disabled(model.queryBusy || request.issue == nil || model.recoveries.values.contains { $0.issue.id == request.issue?.id })
    }.padding(24).frame(width: 620, height: 460)
      .interactiveDismissDisabled(model.writing)
      .confirmationDialog("Delete this worklog from Jira?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })) {
        Button("Delete permanently", role: .destructive) { guard let issue = request.issue, let log = pendingDelete else { return }; Task { do { try await model.delete(issue: issue, log: log); pendingDelete = nil; deleted() } catch { self.error = error.localizedDescription } } }
        Button("Cancel", role: .cancel) { pendingDelete = nil }
      }
  }
}
struct NativeWorklogEditor: View {
  @ObservedObject var jira: JiraSession; @ObservedObject var model: NativeTimesheetModel
  let request: TimeEditorRequest; let close: @MainActor @Sendable () -> Void
  let onDirty: (Bool) -> Void
  @StateObject private var draft: NativeWorklogDraft
  @StateObject private var searcher = NativeTimeIssueSearch()
  @StateObject private var boardPicker = NativeWorklogBoardPicker()
  @State private var showBoardPicker = false
  @State private var search = ""
  @State private var error = ""
  @State private var discard = false
  private enum Field: Hashable { case issue, clock, duration, comment }
  @FocusState private var focus: Field?
  init(jira: JiraSession, model: NativeTimesheetModel, request: TimeEditorRequest, onDirty: @escaping (Bool) -> Void = { _ in }, draft: NativeWorklogDraft? = nil, close: @escaping @MainActor @Sendable () -> Void) {
    self.jira = jira; self.model = model; self.request = request; self.close = close; self.onDirty = onDirty
    _draft = StateObject(wrappedValue: draft ?? NativeWorklogDraft(request: request, zone: model.zone))
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack { Text(request.original == nil ? "Log time" : "Edit worklog").font(.title2.bold()); Spacer(); Button("Cancel") { if draft.dirty { discard = true } else { close() } }.keyboardShortcut(.cancelAction).disabled(model.writing) }
      if request.original == nil && draft.issue == nil {
        HStack {
          TextField("Issue key or summary", text: $search).focused($focus, equals: .issue).onSubmit { Task { await find(debounce: false) } }
          if searcher.busy { ProgressView().controlSize(.small) }
          Button("Search") { Task { await find(debounce: false) } }.disabled(search.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
        }
        if !searcher.results.isEmpty { ScrollView { ForEach(searcher.results) { value in Button(value.key + " · " + value.summary) { draft.issue = value; search = ""; searcher.cancel() }.buttonStyle(.plain).padding(5).frame(maxWidth: .infinity, alignment: .leading) } }.frame(maxHeight: 130) }
        if !searcher.error.isEmpty { Text(searcher.error).font(.caption).foregroundStyle(.red) }
        DisclosureGroup("Choose from a board", isExpanded: $showBoardPicker) {
          NativeWorklogBoardPickerView(picker: boardPicker) { issue in draft.issue = issue; showBoardPicker = false; search = ""; searcher.cancel() }
        }.task(id: showBoardPicker) { if showBoardPicker { await boardPicker.configure(jira) } else { boardPicker.cancel() } }
      }
      HStack {
        Text(draft.issue.map { $0.key + " · " + $0.summary } ?? "Choose an issue").font(.headline)
        if request.original == nil && request.issue == nil && draft.issue != nil { Button("Change issue") { draft.issue = nil; focus = .issue } }
      }
      HStack {
        DatePicker("Date", selection: Binding(get: { TimeCalendar.instant(draft.day + "T12:00:00Z") ?? Date() }, set: { draft.day = TimeCalendar.text($0, zone: "UTC") }), displayedComponents: .date).environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
        Text("Start time"); TextField("HH:mm", text: $draft.clock).focused($focus, equals: .clock).frame(width: 70)
        Text(draft.zone).font(.caption)
      }
      if draft.instants.count > 1 { Picker("This clock time occurs twice", selection: $draft.selectedInstant) { Text("Choose the instant").tag(""); ForEach(draft.instants, id: \.self) { Text($0).tag($0) } } }
      if draft.instants.isEmpty { Text("This date/time is invalid or skipped by daylight saving time.").font(.caption).foregroundStyle(.orange) }
      VStack(alignment: .leading, spacing: 5) { Text("Duration").font(.caption); TextField("1h 30m, 90m or 1:30", text: $draft.duration).focused($focus, equals: .duration) }
      Text("Description (optional)").font(.caption); TextEditor(text: $draft.comment).focused($focus, equals: .comment).frame(height: 110).overlay(RoundedRectangle(cornerRadius: 5).stroke(PV.border))
      Text("Time is recorded on the start date. Changing time here does not change the issue estimate.").font(.caption).foregroundStyle(PV.secondary)
      if !error.isEmpty { Text(error).foregroundStyle(.red).textSelection(.enabled) }
      ForEach(model.recoveries.values.filter { $0.issue.id == draft.issue?.id }.sorted { $0.id < $1.id }) { pending in NativeWorklogRecoveryNotice(model: model, id: pending.id) }
      HStack { Spacer(); Button(model.writing ? "Saving…" : "Save") { save() }.buttonStyle(ProductButton(primary: true)).keyboardShortcut(.defaultAction).disabled(model.writing || draft.issue == nil || draft.instants.isEmpty || model.recoveries.values.contains { $0.issue.id == draft.issue?.id }) }
    }.padding(24).frame(width: 650).disabled(model.writing)
      .onAppear { focus = draft.issue == nil ? .issue : .duration; onDirty(draft.dirty) }
      .onChange(of: draft.values) { _, _ in onDirty(draft.dirty) }
      .task(id: search) { await find(debounce: true) }
      .onDisappear { searcher.cancel(); boardPicker.cancel(); onDirty(false) }
      .interactiveDismissDisabled(draft.dirty || model.writing)
      .onKeyPress(.escape) { if !model.writing { if draft.dirty { discard = true } else { close() } }; return .handled }
      .confirmationDialog("Discard this unsaved worklog?", isPresented: $discard) { Button("Discard", role: .destructive, action: close); Button("Keep editing", role: .cancel) {} }
  }
  private func find(debounce: Bool) async {
    guard let client = jira.client else { return }
    await searcher.search(search, client: client, debounce: debounce) { try model.requireSession() }
  }
  private func save() {
    do {
      let value = try draft.submission()
      Task { do { try await model.save(issue: value.issue, original: request.original, started: value.started, seconds: value.seconds, comment: value.comment, onSuccess: close) } catch { self.error = error.localizedDescription } }
    } catch { self.error = error.localizedDescription }
  }
}
