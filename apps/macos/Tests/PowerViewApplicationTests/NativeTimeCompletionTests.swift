import Foundation
import Testing
@testable import PowerView
@testable import PowerViewCore

@MainActor private final class CompletionContext {
  let transport = NativeTimeFixtureTransport()
  let offTransport = NativeCalendarFixtureTransport()
  let defaultsName = "PowerView.Completion." + UUID().uuidString
  let defaults: UserDefaults
  let client: JiraClient
  let session: JiraSession
  let calendar: GitHubTimeCalendar
  let time: NativeTimesheetModel
  init() async throws {
    defaults = UserDefaults(suiteName: defaultsName)!
    client = JiraClient(connection: try JiraConnection(origin: NativeTimeFixtureTransport.origin, email: "fixture@example.invalid", token: "fixture-only"), transport: transport)
    session = JiraSession(client: client, user: JiraUser(accountId: "fixture", displayName: "Fixture User", timeZone: "Europe/Kyiv"))
    calendar = try await offTransport.makeStore()
    time = NativeTimesheetModel(calendarStore: calendar, defaults: defaults)
    await time.configure(session); time.anchor = "2026-11-04"; await time.load()
  }
  func cleanup() { time.cancelLoading(); defaults.removePersistentDomain(forName: defaultsName) }
}

@MainActor @Test func detailsAddAnotherKeepsTheCellAndNeverRewritesItsAggregate() async throws {
  let c = try await CompletionContext(); defer { c.cleanup() }
  let issue = try await c.client.timeIssue("TEST-2")
  let original = try #require(c.time.logs(issue, day: "2026-11-03").first)
  let flow = NativeWorklogPresentation()
  flow.openDetails(issue: issue, day: "2026-11-03")
  #expect(flow.returnCellID == "2:2026-11-03")
  flow.addAnother()
  #expect(flow.details == nil && flow.editor == nil)
  #expect(flow.detailsDismissed() == nil)
  let request = try #require(flow.editor)
  #expect(request.issue?.id == issue.id && request.day == "2026-11-03" && request.original == nil)
  let draft = NativeWorklogDraft(request: request, zone: c.time.zone)
  draft.duration = "30m"; draft.comment = "Separate second record"
  let value = try draft.submission()
  try await c.time.save(issue: value.issue, original: nil, started: value.started, seconds: value.seconds, comment: value.comment, onSuccess: {})
  flow.closeEditor()
  #expect(flow.editorDismissed() == "2:2026-11-03")
  let logs = c.time.logs(issue, day: "2026-11-03")
  #expect(logs.count == 2 && logs.reduce(0) { $0 + $1.seconds } == 7200)
  #expect(logs.contains(original))
  #expect(await c.transport.mutations.map(\.httpMethod) == ["POST"])
  flow.openDetails(issue: issue, day: "2026-11-03"); flow.edit(original)
  #expect(flow.detailsDismissed() == nil && flow.editor?.original == original)
  flow.closeEditor(); #expect(flow.editorDismissed() == flow.returnCellID)
  flow.openDetails(issue: issue, day: "2026-11-03"); flow.details = nil
  #expect(flow.detailsDismissed() == "2:2026-11-03")
  let added = try #require(logs.first { $0.id != original.id })
  flow.openDetails(issue: issue, day: "2026-11-03")
  try await c.time.delete(issue: issue, log: added); flow.deleted()
  #expect(flow.details == nil && flow.detailsDismissed() == "2:2026-11-03")
  #expect(c.time.successMessage == "Worklog deleted in Jira.")
  #expect(c.time.logs(issue, day: "2026-11-03") == [original])
}

@MainActor @Test func reportSelectionIsExplicitAndIndividualViewContainsOneCurrentEmployee() async throws {
  let c = try await CompletionContext(); defer { c.cleanup() }
  let report = NativeTimeReportModel(calendarStore: c.calendar)
  report.attach(c.session); await report.discoverTeams()
  #expect(report.snapshot == nil && !report.canLoad)
  report.teamID = NativeTimeFixtureTransport.teamA; report.anchor = "2026-11-04"
  #expect(report.snapshot == nil && report.canLoad)
  await report.load(); #expect(report.completeResult)
  report.individual = true
  #expect(report.person?.user.accountId == "fixture")
  report.showIndividual("other")
  #expect(report.person?.user.accountId == "other" && report.person?.logged == 3600)
  report.employee = "fixture"
  #expect(!report.individual && report.selected.count == 1)
  report.individual = true; #expect(report.person?.user.accountId == "fixture")
  report.month = true
  #expect(report.snapshot == nil && report.canLoad)
  await report.load(); #expect(report.completeResult)
  await c.transport.setSlowSearch(true)
  let old = Task { await report.load() }
  try await Task.sleep(for: .milliseconds(15)); report.cancelLoading(); await old.value
  #expect(report.snapshot == nil && !report.loading && report.error.contains("cancelled"))
}

@MainActor @Test func partialReportHasNoCompleteResultAndDayStylesDistinguishIssueAndEmployeeDeficit() async throws {
  let c = try await CompletionContext(); defer { c.cleanup() }
  let report = NativeTimeReportModel(calendarStore: c.calendar)
  report.attach(c.session); await report.discoverTeams(); report.teamID = NativeTimeFixtureTransport.teamA; report.anchor = "2026-11-04"
  await report.load()
  let person = try #require(report.metrics.first { $0.user.accountId == "fixture" })
  #expect(person.style(on: "2026-11-03") == .deficit)
  #expect(person.style(on: "2026-11-03", issue: "TEST-2") == .normal)
  #expect(person.style(on: "2026-11-07") == .normal)
  await c.transport.failIssue("TEST-2"); await report.load()
  #expect(report.snapshot?.failedIssueIDs.contains("2") == true && !report.completeResult)
  #expect(report.metrics.allSatisfy { $0.expected == nil && $0.style(on: "2026-11-03") == .normal })
  let issue = try TimeIssue(raw: NativeTimeFixtureTransport.issue(2))
  let zero = try TimeWorklog(raw: NativeTimeFixtureTransport.log(id: "99", issue: "2", day: "2026-11-04", seconds: 0), issue: issue)
  let off = SharedDayOff(dates: ["fixture": ["2026-11-04"]], warnings: [])
  let metrics = try TimeReportCalculator.build(users: [person.user], worklogs: [zero], query: TimeQuery(days: TimeCalendar.days(anchor: "2026-11-04", month: false), zone: "Europe/Kyiv"), calendar: off, worklogsComplete: true)[0]
  #expect(metrics.style(on: "2026-11-04") == .conflict)
  #expect(metrics.style(on: "2026-11-04", issue: "TEST-2") == .conflict)
  #expect(metrics.style(on: "2026-11-04", issue: "TEST-3") == .dayOff)
}

@MainActor @Test func unknownWorklogShowsActualOwnRecordsAndExplicitRecoveryNeverReplaysTheWrite() async throws {
  let c = try await CompletionContext(); defer { c.cleanup() }
  let issue = try await c.client.timeIssue("TEST-3")
  await c.transport.setTimeoutWrite(true)
  await #expect(throws: TimeTrackingError.unknownOutcome) { try await c.time.save(issue: issue, original: nil, started: "2026-11-04T00:30:00Z", seconds: 3600, comment: nil, onSuccess: {}) }
  let id = "3:2026-11-04"
  let recovery = try #require(c.time.recoveries[id])
  #expect(recovery.records?.count == 1 && recovery.records?.first?.seconds == 3600)
  await #expect(throws: TimeTrackingError.unknownOutcome) { try await c.time.save(issue: issue, original: nil, started: "2026-11-04T09:00:00Z", seconds: 3600, comment: nil, onSuccess: {}) }
  #expect(await c.transport.mutations.count == 1)
  c.time.chooseZone("America/New_York"); await c.time.reloadUnknownRecords(id)
  #expect(c.time.recoveries[id]?.zone == "Europe/Kyiv" && c.time.recoveries[id]?.records?.count == 1)
  c.time.chooseZone("Europe/Kyiv")
  await c.time.load()
  #expect(c.time.logs(issue, day: "2026-11-04").count == 1 && c.time.uncertain.contains(id))
  c.time.allowWorklogRetry(id)
  #expect(c.time.recoveries[id] == nil && !c.time.uncertain.contains(id))
  #expect(await c.transport.mutations.count == 1)
}

@MainActor @Test func unknownWorklogCannotBeReenabledWhileReconciliationIsUnavailable() async throws {
  let c = try await CompletionContext(); defer { c.cleanup() }
  let issue = try await c.client.timeIssue("TEST-2")
  await c.transport.failIssue(issue.key); await c.transport.setTimeoutWrite(true)
  await #expect(throws: TimeTrackingError.unknownOutcome) { try await c.time.save(issue: issue, original: nil, started: "2026-11-03T09:00:00Z", seconds: 900, comment: nil, onSuccess: {}) }
  let id = "2:2026-11-03"
  #expect(c.time.recoveries[id]?.records == nil && c.time.recoveries[id]?.error.isEmpty == false)
  c.time.allowWorklogRetry(id); #expect(c.time.uncertain.contains(id))
  await c.transport.restoreIssue(issue.key); await c.time.reloadUnknownRecords(id)
  #expect(c.time.recoveries[id]?.records?.count == 2)
  #expect(c.time.recoveries[id]?.records?.allSatisfy { $0.authorID == "fixture" } == true)
  c.time.allowWorklogRetry(id); #expect(!c.time.uncertain.contains(id))
  #expect(await c.transport.mutations.count == 1)
}

@MainActor @Test func unknownDayOffRequiresAFreshReadBeforeItsExplicitAcknowledgement() async throws {
  let c = try await CompletionContext(); defer { c.cleanup() }
  await c.offTransport.setTimeoutAfterWrite(true)
  await c.time.setOff("2026-11-06", enabled: true)
  #expect(c.time.uncertain.contains("calendar:2026-11-06") && c.time.calendar == nil)
  c.time.allowCalendarRetry("2026-11-06"); #expect(!c.time.uncertain.isEmpty)
  await c.offTransport.setUnavailable(false); await c.time.refreshDayOff()
  #expect(c.time.calendar?.complete == true && c.time.calendar?.dates["fixture"]?.contains("2026-11-06") == true)
  c.time.allowCalendarRetry("2026-11-06"); #expect(c.time.uncertain.isEmpty)
  #expect(await c.offTransport.writes == 1)
}

@MainActor @Test func unknownDeletionShowsTheEmptyOwnRecordSetAndDoesNotRepeatDelete() async throws {
  let c = try await CompletionContext(); defer { c.cleanup() }
  let issue = try await c.client.timeIssue("TEST-2")
  let original = try #require(c.time.logs(issue, day: "2026-11-03").first)
  await c.transport.setTimeoutWrite(true)
  await #expect(throws: TimeTrackingError.unknownOutcome) { try await c.time.delete(issue: issue, log: original) }
  let id = "2:delete:" + original.id
  #expect(c.time.recoveries[id]?.deleting == true && c.time.recoveries[id]?.records?.isEmpty == true)
  #expect(c.time.successMessage.isEmpty)
  await #expect(throws: TimeTrackingError.unknownOutcome) { try await c.time.delete(issue: issue, log: original) }
  c.time.allowWorklogRetry(id)
  #expect(c.time.recoveries[id] == nil && c.time.uncertain.isEmpty)
  #expect(await c.transport.mutations.map(\.httpMethod) == ["DELETE"])
}

@MainActor @Test func leavingTheReportOrChangingTeamsCancelsRosterSyncBeforeAnyWrite() async throws {
  let c = try await CompletionContext(); defer { c.cleanup() }
  let report = NativeTimeReportModel(calendarStore: c.calendar)
  report.attach(c.session); await report.discoverTeams(); report.teamID = NativeTimeFixtureTransport.teamA
  await c.transport.setSlowTeam(true)
  let first = Task { await report.sync() }
  try await Task.sleep(for: .milliseconds(15)); report.cancel(); await first.value
  #expect(!report.syncing)
  #expect(await c.offTransport.writes == 0)
  let second = Task { await report.sync() }
  try await Task.sleep(for: .milliseconds(15)); report.teamID = NativeTimeFixtureTransport.teamB
  await second.value
  #expect(!report.syncing)
  #expect(await c.offTransport.writes == 0)
  await c.transport.setSlowTeam(false); await report.sync()
  #expect(await c.offTransport.writes == 1)
}

@MainActor @Test func assignedPinnedAndPriorityTasksReadTheirHoursEvenWhenDiscoveryOmitsThem() async throws {
  let c = try await CompletionContext(); defer { c.cleanup() }
  await c.transport.replaceLogs(["TEST-5": [NativeTimeFixtureTransport.log(id: "91", issue: "5", day: "2026-11-04", seconds: 7200)]])
  c.time.boardID = "202"; await c.time.loadBoard()
  let unselected = c.time.queryKey
  c.time.pins = ["TEST-5"]
  #expect(c.time.queryKey != unselected)
  await c.time.load()
  #expect(c.time.records.first?.issueKey == "TEST-5" && c.time.records.first?.seconds == 7200)
  #expect(c.time.snapshot?.readIssueIDs.contains("5") == true)
  c.time.pins = []; c.time.priorities = ["TEST-5"]; await c.time.load()
  #expect(c.time.records.first?.seconds == 7200)
  c.time.priorities = []; c.time.boardIssues[0].assigneeID = "fixture"; await c.time.load()
  #expect(c.time.records.first?.seconds == 7200)
  c.time.month = true; await c.time.load()
  #expect(c.time.records.isEmpty && c.time.snapshot?.readIssueIDs.contains("5") == false)
  #expect(await c.transport.mutations.isEmpty)
}

@MainActor @Test func aConfirmedSaveCannotBeSubmittedTwiceWhileItsRefreshIsStillRunning() async throws {
  let c = try await CompletionContext(); defer { c.cleanup() }
  let issue = try await c.client.timeIssue("TEST-3")
  await c.transport.setSlowSearch(true)
  var closed = false
  let saving = Task { try await c.time.save(issue: issue, original: nil, started: "2026-11-04T09:00:00Z", seconds: 1800, comment: nil, onSuccess: { closed = true }) }
  for _ in 0..<100 where !c.time.loading { try await Task.sleep(for: .milliseconds(2)) }
  #expect(c.time.loading && c.time.writing && !closed)
  await #expect(throws: (any Error).self) { try await c.time.save(issue: issue, original: nil, started: "2026-11-04T09:00:00Z", seconds: 1800, comment: nil, onSuccess: {}) }
  #expect(await c.transport.mutations.count == 1)
  try await saving.value
  #expect(closed && !c.time.writing && !c.time.loading)
  #expect(c.time.successMessage == "Worklog saved in Jira.")
}
