import Foundation
import Testing

@testable import PowerViewCore

@Test func chromeSetupImportsMappedSettingsAndRetainsUnsupportedFields() throws {
  let data = Data(
    #"{"jiraBaseUrl":"https://jira.example.test/","project":{"key":"APP"},"board":{"id":7,"name":"Chrome board"},"jql":"project = APP","fieldMapping":{"startDateFieldId":"customfield_123","endDateFieldId":"duedate","storyPointsFieldId":"customfield_456"},"nonWorkingDays":[0,6],"defaultDurations":{"story":8},"reporting":{"completedStatusIds":["9"]}}"#
      .utf8)
  let setup = try ChromeSetup.decode(data)
  var release = try Release(
    name: "Import", teamName: "Team", projectKey: "APP",
    coordinator: .init(id: "c", name: "C", role: .coordinator))
  try release.importChromeSetup(setup, actorID: "c")
  #expect(release.workspace?.boardID == "7")
  #expect(release.workspace?.startField == "customfield_123")
  #expect(release.jiraOrigin == "https://jira.example.test")
  #expect(release.timelinePreferences?.defaultDurations?["story"] == 8)
  #expect(setup.unsupportedFields.isEmpty)
  #expect(setup.raw["fieldMapping"]["storyPointsFieldId"].string == "customfield_456")
  let restored = try Release.decode(JSONEncoder().encode(release))
  #expect(restored.chromeSetupArchive == setup.raw)
  #expect(restored.chromeSetupArchive?["reporting"]["completedStatusIds"].array == [.string("9")])
  var other = try Release(
    name: "Other", teamName: "Team", projectKey: "OTHER",
    coordinator: .init(id: "c", name: "C", role: .coordinator))
  #expect(throws: ReleaseError.wrongProject) { try other.importChromeSetup(setup, actorID: "c") }
}

@Test func pastedScopeReportsDuplicatesAndForeignProjectsWithAcceptedKeys() {
  let result = ScopeKeys.parse(
    "https://jira.example.test/browse/app-2\nAPP-1,APP-2,OTHER-4,APP-3", project: "APP",
    existing: ["APP-1"])
  #expect(result.accepted == ["APP-2", "APP-3"])
  #expect(result.duplicates == ["APP-1", "APP-2"])
  #expect(result.foreign == ["OTHER-4"])
}

@Test func localPlansAreRestoredPerBoardAndJiraOrigin() throws {
  var release = try Release(
    name: "Scope", teamName: "Team", projectKey: "APP",
    coordinator: .init(id: "c", name: "C", role: .coordinator))
  let first = WorkspaceSnapshot(
    boardID: "1", boardName: "One", jql: "", issues: [], origin: "https://one.example.test")
  let second = WorkspaceSnapshot(
    boardID: "1", boardName: "Other Jira", jql: "", issues: [], origin: "https://two.example.test")
  release.applyWorkspace(first)
  release.localPlans = ["APP-1": .init(start: "2026-10-19", due: "2026-10-20", dependencies: [])]
  var preferences = TimelinePreferences()
  preferences.search = "First board"
  release.timelinePreferences = preferences
  release.applyWorkspace(second)
  #expect(release.localPlans?.isEmpty == true)
  #expect(release.timelinePreferences?.search == "")
  release.localPlans = ["APP-1": .init(start: "2026-11-19", due: "2026-11-20", dependencies: [])]
  release = try Release.decode(JSONEncoder().encode(release))
  release.applyWorkspace(first)
  #expect(release.localPlans?["APP-1"]?.start == "2026-10-19")
  #expect(release.timelinePreferences?.search == "First board")
  release.applyWorkspace(second)
  #expect(release.localPlans?["APP-1"]?.start == "2026-11-19")
}

@Test func forecastUsesSavedCalendarAndDurationWithoutChangingJiraDates() throws {
  let raw: JSONValue = .object([
    "key": .string("APP-1"),
    "fields": .object([
      "summary": .string("Forecast"),
      "status": .object(["name": .string("Open")]),
      "issuetype": .object(["name": .string("Story")]),
      "customfield_10015": .string("2026-10-23"),
    ]),
  ])
  let issue = try WorkspaceIssue(raw: raw)
  let weekdays = TimelineSchedule.build(issues: [issue], defaultDurations: ["story": 2])
  #expect(weekdays["APP-1"]?.end == "2026-10-26")
  let everyDay = TimelineSchedule.build(
    issues: [issue], nonWorkingDays: [], defaultDurations: ["story": 2])
  #expect(everyDay["APP-1"]?.end == "2026-10-24")
  #expect(issue.due == nil)
  #expect(everyDay["APP-1"]?.state == "planned")
  var preferences = TimelinePreferences()
  preferences.nonWorkingDays = []
  preferences.defaultDurations = ["story": 2]
  let restored = try JSONDecoder().decode(
    TimelinePreferences.self, from: JSONEncoder().encode(preferences))
  #expect(restored == preferences)
  let previous = Data(
    "{\"search\":\"\",\"hideDone\":true,\"sort\":\"rank\",\"ascending\":true,\"dayWidth\":10,\"showDependencies\":true,\"collapsed\":[]}"
      .utf8)
  #expect(try JSONDecoder().decode(TimelinePreferences.self, from: previous).nonWorkingDays == nil)
}

private func workspaceRaw(_ key: String, status: String = "Review", id: String = "3") -> JSONValue {
  .object([
    "key": .string(key),
    "fields": .object([
      "summary": .string("Work " + key),
      "status": .object([
        "id": .string(id), "name": .string(status),
        "statusCategory": .object(["key": .string("indeterminate")]),
      ]),
      "assignee": .object(["displayName": .string("Ada")]),
      "customfield_10015": .string("2026-10-19"), "duedate": .string("2026-10-21"),
    ]),
  ])
}
private actor WorkspaceTransport: JiraTransport {
  var requests: [URLRequest] = []
  let repeatToken: Bool
  init(repeatToken: Bool = false) { self.repeatToken = repeatToken }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    let page: JSONValue
    if requests.count == 1 {
      page = .object([
        "issues": .array([workspaceRaw("APP-1")]), "isLast": .bool(false),
        "nextPageToken": .string("cursor+two"),
      ])
    } else if repeatToken {
      page = .object([
        "issues": .array([workspaceRaw("APP-2")]), "isLast": .bool(false),
        "nextPageToken": .string("cursor+two"),
      ])
    } else {
      page = .object([
        "issues": .array([workspaceRaw("APP-2", status: "Done", id: "4")]), "isLast": .bool(true),
      ])
    }
    return (
      try JSONEncoder().encode(page),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}
@Test func workspaceUsesCursorPaginationAndStatusDistributionIncludesEveryStatus() async throws {
  let transport = WorkspaceTransport()
  let client = JiraClient(
    connection: try .init(
      origin: "https://jira.example.test", email: "test@example.test", token: "fake"),
    transport: transport)
  let snapshot = try await client.loadWorkspace(
    boardID: "7", boardName: "Team", jql: "project = APP", startField: "customfield_10015",
    dueField: "duedate")
  #expect(snapshot.issues.map(\.key) == ["APP-1", "APP-2"])
  let requests = await transport.requests
  #expect(requests.count == 2)
  #expect(requests.allSatisfy { $0.httpMethod == "GET" })
  let query = URLComponents(url: requests[1].url!, resolvingAgainstBaseURL: false)!.queryItems!
  #expect(query.first { $0.name == "nextPageToken" }?.value == "cursor+two")
  let distribution = StatusDistribution.build(snapshot.issues)
  #expect(distribution.count == 2)
  #expect(distribution.allSatisfy { $0.percentage == 50 })
  #expect(
    try JSONDecoder().decode(WorkspaceSnapshot.self, from: JSONEncoder().encode(snapshot))
      == snapshot)
  let bad = JiraClient(
    connection: client.connection, transport: WorkspaceTransport(repeatToken: true))
  await #expect(throws: JiraError.paginationIncomplete) {
    try await bad.loadWorkspace(
      boardID: "7", boardName: "Team", jql: "", startField: "customfield_10015", dueField: "duedate"
    )
  }
}
@Test func localPlanningNeedsNoFakeJiraEvidenceAndKeepsReadyGate() throws {
  var story = Story(id: "APP-1", title: "Manual estimate", requiresJiraEvidence: false)
  story.acceptanceCriteria = "AC"
  story.definitionOfDone = "DoD"
  story.noOpenQuestions = true
  story.tlApproved = true
  story.decompositionComplete = true
  story.development = [.init(days: 3, summary: "Backend"), .init(days: 2, summary: "UI")]
  try story.handoff(role: .techLead, canEdit: true)
  #expect(story.clientDays == 6)
  #expect(story.development.allSatisfy { $0.jiraKey == nil && $0.recordedEstimateSeconds == nil })
  #expect(throws: PreparationError.self) { try story.confirmReady(role: .qaLead, canEdit: true) }
  story.testPlan = "Plan"
  story.testData = "Data"
  story.environment = "Test"
  story.testConditions = "Conditions"
  story.qaApproved = true
  try story.confirmReady(role: .qaLead, canEdit: true)
  #expect(story.state == .ready)
  #expect(story.recordedStoryEstimateSeconds == nil)
  try story.reopenForEstimation(role: .techLead)
  #expect(story.state == .techLead && !story.qaApproved && !story.tlApproved)
  #expect(TimelineDates.parse("2026-02-30") == nil)
  #expect(TimelineDates.parse("2026-10-19") != nil)
}

@Test func chromeHandoffMigratesReadyWithoutInventedServerEvidence() throws {
  let data = Data(
    #"{"version":1,"boardId":"7","jiraBaseUrl":"https://jira.example.test","release":"Chrome release","keys":["APP-1"],"issues":[{"key":"APP-1","summary":"Real title"}],"drafts":{"APP-1":{"techLead":"Ada","qaLead":"Bob","days":"5","decomposition":"Backend and UI","questions":"Question","answers":"Answer","questionsResolved":true,"scope":"Scope","scopeConfirmed":true,"environment":"Test","conditions":"Conditions","testPlan":"Plan","testData":"Data","qaSubmitted":true,"ready":true}}}"#
      .utf8)
  let release = try ChromeHandoffImporter.decode(data)
  let story = release.stories[0]
  #expect(story.title == "Real title")
  #expect(story.state == .ready)
  #expect(story.developmentDays == 5)
  #expect(story.questions == "Question" && story.answers == "Answer")
  #expect(story.development[0].summary == "Backend and UI")
  #expect(story.recordedStoryEstimateSeconds == nil && story.qaTask == nil)
  #expect(!story.requiresJiraEvidence)
  #expect(release.jiraOrigin == "https://jira.example.test")
  #expect(release.chromeHandoffArchive != nil)
  #expect(try Release.decode(JSONEncoder().encode(release)) == release)
}
@Test func localPlanRejectsDependencyCyclesAndReportsDateConflicts() throws {
  let a = try WorkspaceIssue(raw: workspaceRaw("APP-1"))
  let b = try WorkspaceIssue(raw: workspaceRaw("APP-2"))
  let first = LocalIssuePlan(start: "2026-10-19", due: "2026-10-21", dependencies: [b.key])
  let second = LocalIssuePlan(start: "2026-10-19", due: "2026-10-21", dependencies: [a.key])
  #expect(
    LocalPlanValidation.validate(key: a.key, plan: first, issues: [a, b], plans: [b.key: second])
      != nil)
  #expect(LocalPlanValidation.conflicts(issues: [a, b], plans: [a.key: first]).count == 1)
}

@Test func timelineCollapseHidesAllDescendantsAndSearchKeepsAncestors() throws {
  func issue(_ key: String, parent: String? = nil) throws -> WorkspaceIssue {
    var raw = workspaceRaw(key)
    if case .object(var root) = raw, case .object(var fields) = root["fields"] {
      if let parent { fields["parent"] = .object(["key": .string(parent)]) }
      root["fields"] = .object(fields)
      raw = .object(root)
    }
    return try WorkspaceIssue(raw: raw)
  }
  let issues = try [
    issue("APP-1"), issue("APP-2", parent: "APP-1"), issue("APP-3", parent: "APP-2"),
  ]
  #expect(
    TimelineHierarchy.rows(
      issues: issues, plans: [:], collapsed: ["APP-1"], query: "", hideDone: false, sort: .rank
    ).map(\.id) == ["APP-1"])
  let search = TimelineHierarchy.rows(
    issues: issues, plans: [:], collapsed: ["APP-1"], query: "APP-3", hideDone: false, sort: .rank)
  #expect(search.isEmpty)
  let expandedSearch = TimelineHierarchy.rows(
    issues: issues, plans: [:], collapsed: [], query: "APP-3", hideDone: false, sort: .rank)
  #expect(expandedSearch.map(\.id) == ["APP-3"])
  #expect(expandedSearch.map(\.depth) == [2])
}
@Test func teamDefaultsAreScopedByOriginAndSurviveRestart() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TeamSettingsStore(
    directory: directory, namespace: "https://jira.example.test", team: "Team")
  let value = TeamSettings(name: "Team", members: [.init(id: "ada", name: "Ada", role: .techLead)])
  try store.save(value)
  #expect(
    try TeamSettingsStore(
      directory: directory, namespace: "https://jira.example.test", team: "team"
    ).load() == value)
  #expect(
    try TeamSettingsStore(
      directory: directory, namespace: "https://other.example.test", team: "Team"
    ).load() == nil)
}
@Test func workspaceChromeImportPreservesHierarchyDatesAndReverseDependencies() throws {
  let data = Data(
    #"{"board":{"id":"7","name":"Team"},"issues":[{"key":"APP-1","summary":"Parent","status":{"id":"1","name":"Open","category":"to-do"},"startDate":"2026-10-19","dueDate":"2026-10-20","issueLinks":[{"semanticType":"blocks","linkedIssueKey":"APP-2","direction":"outward"}]},{"key":"APP-2","summary":"Child","parentKey":"APP-1","status":{"id":"2","name":"Review","category":"in-progress"},"startDate":"2026-10-20","dueDate":"2026-10-21"}]}"#
      .utf8)
  let value = try WorkspaceCodec.decode(data)
  #expect(value.issues[1].parentKey == "APP-1")
  #expect(value.issues[1].dependencies == ["APP-1"])
  #expect(value.issues[0].start == "2026-10-19")
  #expect(try WorkspaceCodec.decode(WorkspaceCodec.encode(value)) == value)
}

private actor DateEditingTransport: JiraTransport {
  var writes = 0
  let editable: Bool
  init(editable: Bool = true) { self.editable = editable }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let body: String
    if request.httpMethod == "PUT" {
      writes += 1
      body = "{}"
    } else if request.url!.path.hasSuffix("myself") {
      body = #"{"accountId":"coordinator","displayName":"Coordinator"}"#
    } else if request.url!.path.hasSuffix("editmeta") {
      body =
        editable
        ? #"{"fields":{"customfield_10015":{"schema":{"type":"date"},"operations":["set"]},"duedate":{"schema":{"type":"date"},"operations":["set"]}}}"#
        : #"{"fields":{"customfield_10015":{"schema":{"type":"string"},"operations":["set"]}}}"#
    } else {
      body =
        #"{"id":"1","key":"APP-1","fields":{"summary":"Task","updated":"now","project":{"id":"1","key":"APP"},"customfield_10015":"2026-10-19","duedate":"2026-10-21"}}"#
    }
    return (
      Data(body.utf8),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}
@Test func ganttDateWriteRequiresEditableDateMetadataAndExplicitApproval() async throws {
  let transport = DateEditingTransport()
  let client = JiraClient(
    connection: try .init(
      origin: "https://jira.example.test", email: "test@example.test", token: "fake"),
    transport: transport)
  let context = try await client.dateEditContext(
    key: "APP-1", startField: "customfield_10015", dueField: "duedate")
  let proposal = try JiraWriteProposal.dates(
    origin: client.connection.origin, authorID: "coordinator", role: .coordinator, context: context,
    start: "2026-10-20", due: "2026-10-23")
  #expect(await transport.writes == 0)
  #expect(proposal.operations[0].before?["start"].string == "2026-10-19")
  #expect(proposal.operations[0].body["fields"]["duedate"].string == "2026-10-23")
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let executor = JiraWriteExecutor(auditDirectory: directory)
  let user = try await client.myself()
  let approval = try proposal.approve(by: user)
  let results = try await executor.execute(approval, client: client)
  #expect(results[0].outcome == .succeeded)
  #expect(await transport.writes == 1)
  let denied = JiraClient(
    connection: client.connection, transport: DateEditingTransport(editable: false))
  await #expect(throws: JiraWriteError.forbidden) {
    try await denied.dateEditContext(
      key: "APP-1", startField: "customfield_10015", dueField: "duedate")
  }
}

@Test func timelineDatesAndProgressMatchExistingChromeScheduleGoldenCases() throws {
  let url = Bundle.module.url(
    forResource: "schedule-golden", withExtension: "json", subdirectory: "Fixtures")!
  let cases = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)).array
  for fixture in cases {
    let snapshotJSON: JSONValue = .object([
      "board": .object(["id": .string("1"), "name": .string("Golden")]),
      "issues": fixture["issues"],
    ])
    let snapshot = try WorkspaceCodec.decode(JSONEncoder().encode(snapshotJSON))
    let model = TimelineSchedule.build(
      issues: snapshot.issues, today: fixture["options"]["today"].string!)
    for expected in fixture["expected"].array {
      let value = model[expected["key"].string!]!
      #expect(value.start == expected["start"].string)
      #expect(value.end == expected["end"].string)
      #expect(value.state == expected["state"].string)
      #expect(value.startSource == expected["startSource"].string)
      #expect(value.endSource == expected["endSource"].string)
      #expect(value.progress == expected["progress"].number)
      #expect(value.progressSource == expected["progressSource"].string)
      #expect(value.warnings == expected["warnings"].array.compactMap(\.string))
    }
  }
}

private actor MetadataTransport: JiraTransport {
  var writes = 0
  let extraFields: Bool
  init(extraFields: Bool = false) { self.extraFields = extraFields }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let body: String
    if request.httpMethod != "GET" {
      writes += 1
      body = "{}"
    } else if request.url!.path.hasSuffix("myself") {
      body = #"{"accountId":"coordinator","displayName":"Coordinator"}"#
    } else if request.url!.path.hasSuffix("transitions") {
      let fields = extraFields ? #"{"resolution":{"required":true}}"# : "{}"
      body =
        "{\"transitions\":[{\"id\":\"21\",\"name\":\"Start\",\"to\":{\"name\":\"In Progress\"},\"fields\":\(fields)}]}"
    } else if request.url!.path.hasSuffix("editmeta") {
      body = #"{"fields":{"assignee":{"operations":["set"],"required":false}}}"#
    } else {
      body =
        #"{"id":"1","key":"APP-1","fields":{"summary":"Task","updated":"now","project":{"id":"1","key":"APP"},"status":{"name":"Open"},"assignee":{"accountId":"ada","displayName":"Ada"}}}"#
    }
    return (
      Data(body.utf8),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}
@Test func metadataActionsUseAvailableTransitionsAndNeedApprovalBeforeWriting() async throws {
  let transport = MetadataTransport()
  let client = JiraClient(
    connection: try .init(
      origin: "https://jira.example.test", email: "test@example.test", token: "fake"),
    transport: transport)
  let context = try await client.metadataEditContext(key: "APP-1")
  let transition = try JiraWriteProposal.transition(
    origin: client.connection.origin, authorID: "coordinator", role: .coordinator, context: context,
    transitionID: "21")
  #expect(transition.operations[0].before?["label"].string == "Open")
  #expect(transition.operations[0].body["transition"]["id"].string == "21")
  #expect(await transport.writes == 0)
  let user = try await client.myself()
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let results = try await JiraWriteExecutor(auditDirectory: directory).execute(
    transition.approve(by: user), client: client)
  #expect(results[0].outcome == .succeeded)
  #expect(await transport.writes == 1)
  let unassign = try JiraWriteProposal.assignee(
    origin: client.connection.origin, authorID: user.accountId, role: .coordinator,
    context: context, user: nil)
  #expect(unassign.operations[0].body["fields"]["assignee"] == .null)
  let extra = try await JiraClient(
    connection: client.connection, transport: MetadataTransport(extraFields: true)
  ).metadataEditContext(key: "APP-1")
  #expect(throws: JiraWriteError.invalidContent) {
    try JiraWriteProposal.transition(
      origin: client.connection.origin, authorID: user.accountId, role: .coordinator,
      context: extra, transitionID: "21")
  }
}

@Test func typedTimelineDependenciesRejectCyclesAndCheckAllFourConstraints() throws {
  let a = try WorkspaceIssue(raw: workspaceRaw("APP-1"))
  let b = try WorkspaceIssue(raw: workspaceRaw("APP-2"))
  let fs = TimelineLink(predecessor: a.key, successor: b.key, kind: .FS)
  #expect(TimelineLinks.validate(fs, existing: [], issues: [a, b], plans: [:]) == nil)
  #expect(
    TimelineLinks.validate(
      .init(predecessor: b.key, successor: a.key, kind: .FF), existing: [fs], issues: [a, b],
      plans: [:]) != nil)
  let schedule = TimelineSchedule.build(issues: [a, b])
  #expect(TimelineLinks.conflicts([fs], schedule: schedule).count == 1)
  for kind in [TimelineLinkKind.SS, .FF, .SF] {
    #expect(
      TimelineLinks.conflicts(
        [.init(predecessor: a.key, successor: b.key, kind: kind)], schedule: schedule
      ).isEmpty)
  }
  let instant = TimelineDates.parse("2026-10-19T23:00:00-05:00")!
  #expect(TimelineDates.string(instant) == "2026-10-20")
  #expect(TimelineDates.parse("2026-10-19invalid") == nil)
}

@Test func typingCoalescesHistoryWithoutSkippingStateTransitionOrSavedContent() throws {
  var release = try Release(
    name: "Typing", teamName: "Team", projectKey: "APP",
    coordinator: .init(id: "c", name: "C", role: .coordinator))
  try release.setMember(.init(id: "tl", name: "TL", role: .techLead), actorID: "c")
  try release.add(Story(id: "APP-1", title: "Story", requiresJiraEvidence: false), actorID: "c")
  let before = release.history.count
  for value in ["A", "AC", "AC final"] {
    try release.updateStory(key: "APP-1", actorID: "tl", coalesceTyping: true) { story, _ in
      story.acceptanceCriteria = value
    }
  }
  #expect(release.history.count == before + 1)
  let saved = try Release.decode(JSONEncoder().encode(release))
  #expect(saved.stories[0].acceptanceCriteria == "AC final")
  try release.updateStory(key: "APP-1", actorID: "tl", coalesceTyping: true) { story, role in
    story.development = [.init(days: 2)]
    story.decompositionComplete = true
    story.noOpenQuestions = true
    story.tlApproved = true
    try story.handoff(role: role, canEdit: true)
  }
  #expect(release.history.count == before + 2)
}

@Test func workspaceAllowsUnmappedDatesAndMarksPartialScopeAtConfiguredLimit() async throws {
  let transport = WorkspaceTransport()
  let client = JiraClient(
    connection: try .init(
      origin: "https://jira.example.test", email: "test@example.test", token: "fake"),
    transport: transport)
  let snapshot = try await client.loadWorkspace(
    boardID: "7", boardName: "Team", jql: "project = APP", startField: "", dueField: "",
    fieldMapping: ["storyPointsFieldId": "customfield_123", "sprintFieldId": "customfield_456"],
    maxIssues: 1)
  #expect(snapshot.issues.count == 1)
  #expect(snapshot.truncated == true)
  #expect(snapshot.issues.first?.start == nil)
  #expect(snapshot.issues.first?.due == nil)
  let requests = await transport.requests
  #expect(requests.count == 1)
  let query = try #require(
    URLComponents(url: requests[0].url!, resolvingAgainstBaseURL: false)?.queryItems)
  let fields = try #require(query.first { $0.name == "fields" }?.value)
  #expect(!fields.hasSuffix(","))
  #expect(!fields.contains(",,"))
  #expect(fields.contains("customfield_123"))
  #expect(fields.contains("customfield_456"))
  #expect(query.first { $0.name == "maxResults" }?.value == "1")
}
