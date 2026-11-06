import Foundation
import Testing
@testable import PowerView
@testable import PowerViewCore

@MainActor private final class TimeJourney {
  let transport = NativeTimeFixtureTransport()
  let calendarTransport = NativeCalendarFixtureTransport()
  let defaultsName = "PowerView.TimeJourney." + UUID().uuidString
  let defaults: UserDefaults
  let client: JiraClient
  let session: JiraSession
  let calendar: GitHubTimeCalendar
  let model: NativeTimesheetModel
  init() async throws {
    defaults = UserDefaults(suiteName: defaultsName)!
    client = JiraClient(connection: try JiraConnection(origin: NativeTimeFixtureTransport.origin, email: "fixture@example.invalid", token: "fixture-only"), transport: transport)
    session = JiraSession(client: client, user: JiraUser(accountId: "fixture", displayName: "Fixture User", timeZone: "Europe/Kyiv"))
    calendar = try await calendarTransport.makeStore()
    model = NativeTimesheetModel(calendarStore: calendar, defaults: defaults)
    await model.configure(session); model.anchor = "2026-11-04"; await model.load()
  }
  func cleanup() { model.cancelLoading(); model.cancelCopy(); defaults.removePersistentDomain(forName: defaultsName) }
}
@MainActor @Test func previousWeekCopiesOnlyTaskRowsWithoutHoursOrWrites() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  #expect(context.model.records.reduce(0) { $0 + $1.seconds } == 5400)
  #expect(context.model.rows(search: "").map(\.issue.key) == ["TEST-2"])
  await context.model.copyPreviousTasks()
  #expect(context.model.error.isEmpty)
  #expect(context.model.rows(search: "").map(\.issue.key) == ["TEST-2", "TEST-3"])
  #expect(context.model.records.reduce(0) { $0 + $1.seconds } == 5400)
  #expect(context.model.copyMessage.contains("1 task rows"))
  #expect(await context.transport.mutations.isEmpty)
}
@MainActor @Test func previousWeekPartialReadDoesNotAddMisleadingRows() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  await context.transport.failIssue("TEST-3")
  await context.model.copyPreviousTasks()
  #expect(context.model.copyMessage.contains("not be read completely"))
  #expect(!context.model.allIssues.contains { $0.key == "TEST-3" })
}
@MainActor @Test func monthRowsExcludeBoardOnlyIssuesAndWeeklyHierarchy() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  context.model.boardID = "101"; await context.model.loadBoard()
  #expect(context.model.allIssues.count == 4)
  context.model.month = true; await context.model.load()
  #expect(context.model.rows(search: "").map(\.issue.key) == ["TEST-2"])
  #expect(context.model.rows(search: "").allSatisfy { $0.depth == 0 && !$0.hasChildren })
}
@MainActor @Test func timezoneFollowsJiraUntilExplicitlyOverriddenAndIsAccountScoped() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  #expect(context.model.zoneSource == "jira")
  context.session.user = JiraUser(accountId: "fixture", displayName: "Fixture", timeZone: "America/New_York")
  await context.model.configure(context.session)
  #expect(context.model.zone == "America/New_York")
  context.model.chooseZone("UTC")
  context.session.user = JiraUser(accountId: "fixture", displayName: "Fixture", timeZone: "Asia/Tokyo")
  await context.model.configure(context.session)
  #expect(context.model.zone == "UTC" && context.model.zoneSource == "custom")
  context.model.chooseZone("jira")
  #expect(context.model.zone == "Asia/Tokyo")
  context.session.user = JiraUser(accountId: "other", displayName: "Other", timeZone: "Europe/London")
  await context.model.configure(context.session)
  #expect(context.model.zone == "Europe/London" && context.model.records.isEmpty)
}
@Test func jiraTimezoneWarningUsesOffsetsAcrossTheWholeDSTPeriod() {
  #expect(TimeCalendar.profileWarning(zone: "Europe/Kyiv", days: ["2026-11-04"]) == nil)
  #expect(TimeCalendar.profileWarning(zone: "Europe/Berlin", days: ["2026-11-04"]) == nil)
  #expect(TimeCalendar.profileWarning(zone: "America/New_York", days: ["2026-10-26", "2026-11-02"])?.contains("−7h to −6h") == true)
}
@MainActor @Test func explicitCancelAndPeriodChangeCannotAcceptLateReadResponses() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  await context.transport.setSlowSearch(true)
  let refresh = Task { await context.model.load() }
  try await Task.sleep(for: .milliseconds(15))
  context.model.cancelLoading(); await refresh.value
  #expect(!context.model.loading && context.model.stale && context.model.error.contains("cancelled"))
  let oldPeriod = Task { await context.model.load() }
  try await Task.sleep(for: .milliseconds(15))
  context.model.anchor = "2026-11-11"; await oldPeriod.value
  #expect(context.model.snapshot == nil && context.model.calendar == nil)
}
@MainActor @Test func obsoleteIssueSearchAndClosedFormDoNotPublishOldResults() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  await context.transport.setSlowSearch(true)
  let search = NativeTimeIssueSearch()
  let old = Task { await search.search("slow", client: context.client, debounce: false) {} }
  try await Task.sleep(for: .milliseconds(10))
  await search.search("fast", client: context.client, debounce: false) {}
  await old.value
  #expect(search.results.map(\.key) == ["TEST-2"])
  let closed = Task { await search.search("slow", client: context.client, debounce: false) {} }
  try await Task.sleep(for: .milliseconds(10)); search.cancel(); await closed.value
  #expect(search.results.isEmpty && !search.busy)
}
@MainActor @Test func nativeWorklogJourneyCreatesEditsAndDeletesWithoutChangingEstimates() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  let issue = try await context.client.timeIssue("TEST-3")
  let draft = NativeWorklogDraft(request: TimeEditorRequest(issue: issue, day: "2026-11-04"), zone: context.model.zone)
  #expect(!draft.dirty)
  draft.duration = "1h 30m"; draft.comment = "New description"
  let created = try draft.submission()
  try await context.model.save(issue: created.issue, original: nil, started: created.started, seconds: created.seconds, comment: created.comment, onSuccess: {})
  let saved = try #require(context.model.lastSaved)
  #expect(saved.seconds == 5400)
  let editor = NativeWorklogDraft(request: TimeEditorRequest(issue: issue, day: "2026-11-04", original: saved), zone: context.model.zone)
  #expect(!editor.dirty)
  editor.duration = "2h"
  let edited = try editor.submission()
  #expect(edited.comment == nil && edited.started == saved.started)
  try await context.model.save(issue: issue, original: saved, started: edited.started, seconds: edited.seconds, comment: edited.comment, onSuccess: {})
  let updated = try #require(context.model.lastSaved)
  #expect(updated.seconds == 7200)
  try await context.model.delete(issue: issue, log: updated)
  #expect(!context.model.records.contains { $0.id == updated.id })
  let writes = await context.transport.mutations
  #expect(writes.map(\.httpMethod) == ["POST", "PUT", "DELETE"])
  #expect(writes.allSatisfy { URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)?.queryItems == [.init(name: "adjustEstimate", value: "leave")] })
}
@MainActor @Test func worklogDraftPreservesHistoricalSecondsAndRequiresAnExplicitDSTInstant() throws {
  let issue = try TimeIssue(raw: NativeTimeFixtureTransport.issue(2))
  let old = try TimeWorklog(raw: NativeTimeFixtureTransport.log(id: "10", issue: "2", day: "2026-11-03", seconds: 3661), issue: issue)
  let draft = NativeWorklogDraft(request: .init(issue: issue, day: "2026-11-03", original: old), zone: "Europe/Kyiv")
  draft.comment = "Only comment changed"
  let value = try draft.submission()
  #expect(value.started == old.started && value.seconds == 3661)
  let ambiguous = NativeWorklogDraft(request: .init(issue: issue, day: "2026-10-25"), zone: "Europe/Kyiv")
  ambiguous.clock = "03:30"; ambiguous.duration = "1h"
  #expect(throws: (any Error).self) { try ambiguous.submission() }
  ambiguous.selectedInstant = ambiguous.instants[1]
  #expect(try ambiguous.submission().started == ambiguous.instants[1])
}
@MainActor @Test func dayOffAndWorklogConflictsAreEnforcedInBothDirections() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  await context.model.setOff("2026-11-03", enabled: true)
  #expect(context.model.error.contains("has worklogs"))
  #expect(await context.calendarTransport.writes == 0)
  await context.model.setOff("2026-11-06", enabled: true)
  #expect(context.model.calendar?.dates["fixture"]?.contains("2026-11-06") == true)
  let issue = try await context.client.timeIssue("TEST-2")
  await #expect(throws: (any Error).self) { try await context.model.save(issue: issue, original: nil, started: "2026-11-06T09:00:00Z", seconds: 60, comment: nil, onSuccess: {}) }
  #expect(await context.transport.mutations.isEmpty)
  await context.model.setOff("2026-11-06", enabled: false)
  try await context.model.save(issue: issue, original: nil, started: "2026-11-06T09:00:00Z", seconds: 60, comment: nil, onSuccess: {})
  #expect(await context.transport.mutations.count == 1)
}
@MainActor @Test func unreadCalendarAndUnknownWriteNeverCauseBlindOrRepeatedMutations() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  let issue = try await context.client.timeIssue("TEST-2")
  await context.calendarTransport.setUnavailable(true)
  await #expect(throws: (any Error).self) { try await context.model.save(issue: issue, original: nil, started: "2026-11-04T09:00:00Z", seconds: 60, comment: nil, onSuccess: {}) }
  #expect(await context.transport.mutations.isEmpty)
  await context.calendarTransport.setUnavailable(false); await context.transport.setTimeoutWrite(true)
  for _ in 0..<2 {
    await #expect(throws: TimeTrackingError.unknownOutcome) { try await context.model.save(issue: issue, original: nil, started: "2026-11-04T09:00:00Z", seconds: 60, comment: nil, onSuccess: {}) }
  }
  #expect(await context.transport.mutations.count == 1)
}
@Test func twoIndependentCalendarClientsPreserveConcurrentDayOffChanges() async throws {
  let transport = NativeCalendarFixtureTransport(); let first = try await transport.makeStore(); let second = try await transport.makeStore()
  try await withThrowingTaskGroup(of: Void.self) { group in
    group.addTask { try await first.set(baseURL: NativeTimeFixtureTransport.origin, account: "fixture", day: "2026-11-05", enabled: true, verify: {}) }
    group.addTask { try await second.set(baseURL: NativeTimeFixtureTransport.origin, account: "fixture", day: "2026-11-06", enabled: true, verify: {}) }
    try await group.waitForAll()
  }
  let result = try await first.read(baseURL: NativeTimeFixtureTransport.origin, accounts: ["fixture"], days: ["2026-11-05", "2026-11-06"])
  #expect(result.complete && result.dates["fixture"] == ["2026-11-05", "2026-11-06"])
}
@MainActor @Test func timeReportUsesCurrentMembershipAndClearsResultsOnTeamAndAccountChange() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  let report = NativeTimeReportModel(calendarStore: context.calendar)
  report.attach(context.session); await report.discoverTeams()
  #expect(report.teams.count == 2)
  report.anchor = "2026-11-04"; report.teamID = NativeTimeFixtureTransport.teamA; await report.load()
  #expect(report.error.isEmpty)
  #expect(report.metrics.count == 2 && report.metrics.reduce(0) { $0 + $1.logged } == 9000)
  #expect(report.metrics.reduce(0) { $0 + ($1.expected ?? 0) } == 80 * 3600)
  report.employee = "other"; #expect(report.selected.first?.logged == 3600)
  report.teamID = NativeTimeFixtureTransport.teamB
  #expect(report.snapshot == nil && report.employee.isEmpty)
  await report.load(); #expect(report.metrics.count == 1 && report.metrics.first?.logged == 3600)
  await report.sync(); #expect(report.error.isEmpty && report.progress.contains("synced"))
  #expect(await context.calendarTransport.writes == 1)
  await context.transport.setSlowSearch(true)
  let stale = Task { await report.load() }
  try await Task.sleep(for: .milliseconds(15))
  context.session.user = JiraUser(accountId: "other", displayName: "Other", timeZone: "UTC")
  report.attach(context.session); await stale.value
  #expect(report.snapshot == nil && report.team == nil && report.teams.isEmpty)
}
@MainActor @Test func delayedBoardMetadataCannotReplaceTheSelectedBoard() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  await context.transport.setSlowBoard(true)
  context.model.boardID = "101"; let first = Task { await context.model.loadBoard() }
  try await Task.sleep(for: .milliseconds(15))
  context.model.boardID = "202"; await context.model.loadBoard(); await first.value
  #expect(context.model.boardIssues.map(\.key) == ["TEST-5"])
}

@MainActor @Test func tabStyleInlineSavesQueueAndKeepTheNextCellUsableWithoutReload() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  let issue = try await context.client.timeIssue("TEST-3")
  let first = Task { await context.model.saveInline(issue: issue, day: "2026-11-04", text: "1.5", originals: []) }
  let second = Task { await context.model.saveInline(issue: issue, day: "2026-11-05", text: "2", originals: []) }
  await first.value; await second.value
  #expect(context.model.error.isEmpty)
  #expect(context.model.logs(issue, day: "2026-11-04").first?.seconds == 5400)
  #expect(context.model.logs(issue, day: "2026-11-05").first?.seconds == 7200)
  #expect(context.model.savingCells.isEmpty && !context.model.loading)
  #expect(await context.transport.mutations.count == 2)
}
@MainActor @Test func unchangedOrClearedInlineHoursNeverSendMutationsAndUnreadBoardHoursStayUnknown() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  context.model.boardID = "202"; await context.model.loadBoard()
  let issue = try await context.client.timeIssue("TEST-2")
  let unread = try await context.client.timeIssue("TEST-5")
  #expect(context.model.snapshot?.readIssueIDs.contains(issue.id) == true)
  #expect(context.model.snapshot?.readIssueIDs.contains(unread.id) == false)
  let originals = context.model.logs(issue, day: "2026-11-03")
  await context.model.saveInline(issue: issue, day: "2026-11-03", text: "   ", originals: originals)
  await context.model.saveInline(issue: issue, day: "2026-11-03", text: "1:30", originals: originals)
  #expect(context.model.error.isEmpty)
  #expect(await context.transport.mutations.isEmpty)
  await context.model.addKnown(unread.key)
  #expect(context.model.snapshot?.readIssueIDs.contains(unread.id) == true)
  await context.transport.failIssue("TEST-5"); await context.model.load()
  #expect(context.model.snapshot?.readIssueIDs.contains(unread.id) == false)
  #expect(context.model.snapshot?.failedIssueIDs.contains(unread.id) == true)
  #expect(context.model.snapshot?.complete == false)
  #expect(TimeCalendar.parseHours(" 1,5 ") == 5400)
  #expect(TimeCalendar.parseHours("1:30") == 5400)
  #expect(TimeCalendar.parseHours("0") == nil && TimeCalendar.parseHours("1e99") == nil)
}
@MainActor @Test func unsavedTimeBlocksOpenNewAndQuitPreservationPaths() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let suite = "PowerView.Unsaved." + UUID().uuidString; let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
  let store = WorkspaceDocumentStore(recoveryURL: root.appendingPathComponent("recovery.pvworkspace"), defaults: defaults)
  let original = store.sessionID
  store.hasPendingTimeInput = true
  #expect(!store.mayReplaceWorkspace())
  await store.newWorkspace(); await store.open(root.appendingPathComponent("other.pvworkspace"))
  #expect(store.sessionID == original && store.error.contains("unsaved Timesheet"))
  store.hasPendingTimeInput = false; #expect(store.mayReplaceWorkspace())
}

@MainActor @Test func refreshTracksProfileChangesOnlyForJiraTimezoneSource() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  await context.transport.setZone("America/New_York")
  await context.model.load()
  #expect(context.model.zone == "America/New_York" && context.model.snapshot != nil)
  context.model.chooseZone("UTC")
  await context.transport.setZone("Asia/Tokyo"); await context.model.load()
  #expect(context.model.zone == "UTC" && context.model.profileZone == "Asia/Tokyo")
}
@MainActor @Test func closingGuardUsesTheSameUnsavedInputProtectionAsOpenAndQuit() {
  let suite = "PowerView.CloseGuard." + UUID().uuidString; let defaults = UserDefaults(suiteName: suite)!; defer { defaults.removePersistentDomain(forName: suite) }
  let store = WorkspaceDocumentStore(recoveryURL: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), defaults: defaults)
  let guardDelegate = WorkspaceCloseGuard.Coordinator(store: store)
  #expect(guardDelegate.permitsClosing())
  store.hasPendingTimeInput = true; #expect(!guardDelegate.permitsClosing())
  store.hasPendingTimeInput = false; #expect(guardDelegate.permitsClosing())
}

@MainActor @Test func failedTeamDiscoveryCannotBeHiddenByReloadingAnOldSelection() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  let report = NativeTimeReportModel(calendarStore: context.calendar)
  report.attach(context.session); await report.discoverTeams(); report.teamID = NativeTimeFixtureTransport.teamA; report.anchor = "2026-11-04"; await report.load()
  #expect(report.snapshot != nil && report.error.isEmpty)
  await context.transport.setFailTeams(true); await report.refresh()
  #expect(!report.error.isEmpty && !report.canLoad)
  #expect(report.snapshot == nil && report.teamID.isEmpty)
}

@MainActor @Test func reopeningTimesheetStartsInWeekAndMigratesLegacyImplicitKyivZone() async throws {
  let context = try await TimeJourney(); defer { context.cleanup() }
  let key = "time.preferences." + GitHubTimeCalendar.storageKey(context.session.timeScope)
  context.defaults.set(["zone": "Europe/Kyiv", "month": true], forKey: key)
  context.session.user = JiraUser(accountId: "fixture", displayName: "Fixture", timeZone: "America/New_York")
  await context.model.configure(context.session)
  #expect(!context.model.month && context.model.zoneSource == "jira" && context.model.zone == "America/New_York")
}
