import Foundation
import Testing

@testable import PowerViewCore

func jiraTaskFixture(key: String, parent: String? = nil, seconds: Int? = nil) throws -> JiraIssue {
  var fields: [String: JSONValue] = [
    "summary": .string("Fixture " + key), "updated": .string("2026-10-16T12:00:00.000Z"),
    "project": .object(["id": .string("100"), "key": .string("APP")]),
    "issuetype": .object([
      "id": .string(parent == nil ? "1" : "2"),
      "name": .string(parent == nil ? "Story" : "Subtask"), "subtask": .bool(parent != nil),
    ]),
  ]
  if let parent { fields["parent"] = .object(["id": .string("1"), "key": .string(parent)]) }
  if let seconds {
    fields["timetracking"] = .object(["originalEstimateSeconds": .number(Double(seconds))])
  }
  return try JSONDecoder().decode(
    JiraIssue.self,
    from: JSONEncoder().encode(
      JSONValue.object([
        "id": .string(key.components(separatedBy: "-").last!), "key": .string(key),
        "fields": .object(fields),
      ])))
}
@Test func releaseJourneyFromExcelThroughQAReturnToCustomerExport() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let input = directory.appendingPathComponent("client.xlsx")
  let output = directory.appendingPathComponent("pm.xlsx")
  try ExcelWorkbook.export(readyRelease(), to: input)
  let sheet = try ExcelWorkbook.read(at: input, sheetPath: ExcelWorkbook.sheetPaths(at: input)[0])
  let keys = sheet.preview(column: "A", project: "APP", existingKeys: []).compactMap(\.key)
  var release = try Release(
    name: "Pilot journey", teamName: "Team", projectKey: "APP",
    coordinator: .init(id: "c", name: "Coordinator", role: .coordinator))
  try release.setMember(.init(id: "tl", name: "TL", role: .techLead), actorID: "c")
  try release.setMember(.init(id: "qa", name: "QA", role: .qaLead), actorID: "c")
  for key in keys {
    try release.importIssue(
      jiraTaskFixture(key: key), origin: URL(string: "https://jira.example.test")!, actorID: "c")
  }
  #expect(!release.isReady)
  #expect(throws: ExcelError.releaseNotReady) { try ExcelWorkbook.export(release, to: output) }
  let initialTasks = try [
    jiraTaskFixture(key: "APP-2", parent: "APP-1", seconds: 172_800),
    jiraTaskFixture(key: "APP-4", parent: "APP-1", seconds: 115_200),
  ]
  try release.updateStory(key: "APP-1", actorID: "tl") { story, role in
    story.acceptanceCriteria = "Customer can export estimates"
    story.definitionOfDone = "Reviewed and tested"
    story.noOpenQuestions = true
    story.tlApproved = true
    story.decompositionComplete = true
    try story.acceptDevelopmentTasks(initialTasks, excludingQAKey: nil, role: role)
    try story.handoff(role: role, canEdit: true)
  }
  #expect(release.stories[0].clientDays == 12)
  try release.updateStory(key: "APP-1", actorID: "qa") { story, role in
    try story.returnToTL(notes: "Add error handling", role: role, canEdit: true)
  }
  #expect(release.stories[0].state == .returned)
  #expect(!release.stories[0].noOpenQuestions)
  let updatedTask = try jiraTaskFixture(key: "APP-4", parent: "APP-1", seconds: 144_000)
  try release.updateStory(key: "APP-1", actorID: "tl") { story, role in
    try story.acceptUpdatedDevelopmentTask(updatedTask, role: role)
    story.noOpenQuestions = true
    story.tlApproved = true
    try story.handoff(role: role, canEdit: true)
  }
  let qaTask = try jiraTaskFixture(key: "APP-3", parent: "APP-1", seconds: 63_360)
  try release.updateStory(key: "APP-1", actorID: "qa") { story, role in
    story.qaApproved = true
    story.testPlan = "Happy and failure paths"
    story.testData = "Fixture workbook"
    story.environment = "Test Jira"
    story.testConditions = "Two roles"
    try story.acceptQATask(qaTask, adoptEstimate: false, role: role)
    // A successful preview alone does not mark the parent Original Estimate as recorded.
    #expect(throws: PreparationError.self) { try story.confirmReady(role: role, canEdit: true) }
    story.recordedStoryEstimateSeconds = 380_160
    try story.confirmReady(role: role, canEdit: true)
  }
  #expect(release.isReady)
  #expect(abs(release.clientDays - 13.2) < 0.000001)
  try ExcelWorkbook.export(release, to: output)
  let exported = try ExcelWorkbook.read(
    at: output, sheetPath: ExcelWorkbook.sheetPaths(at: output)[0])
  #expect(exported.rows[2]?["A"] == "APP-1")
  #expect(Double(exported.rows[2]?["B"] ?? "") == release.clientDays)
  try recordFixtureClientExport(&release, actorID: "c")
  try release.approveCustomer(actorID: "c")
  #expect(release.customerApprovalRevision == release.revision)
  #expect(release.history.contains { $0.stories.first?.state == .returned })
  #expect(try Release.decode(JSONEncoder().encode(release)) == release)
}
@Test func taskEvidenceAndEstimateEditsRespectParentAndRole() throws {
  let origin = URL(string: "https://jira.example.test")!
  var story = prepared()
  let foreign = try jiraTaskFixture(key: "APP-9", parent: "APP-8", seconds: 28_800)
  #expect(throws: JiraTaskError.notSubtaskOfStory) {
    try story.acceptUpdatedDevelopmentTask(foreign, role: .techLead)
  }
  let dev = try jiraTaskFixture(key: "APP-2", parent: "APP-1", seconds: 288_000)
  let proposal = try JiraWriteProposal.existingTaskEstimate(
    origin: origin, authorID: "tl", role: .techLead, story: story, target: dev,
    designatedQAKey: nil, days: 5)
  #expect(proposal.operations[0].targetKey == "APP-2")
  #expect(proposal.operations[0].exactJSON.contains("2400m"))
  try story.handoff(role: .techLead, canEdit: true)
  #expect(throws: JiraTaskError.forbidden) {
    try JiraWriteProposal.existingTaskEstimate(
      origin: origin, authorID: "qa", role: .qaLead, story: story, target: dev,
      designatedQAKey: "APP-2", days: story.qaDays)
  }
}
@Test func qaReadinessComparesSecondsWithoutFloatingPointFalseFailures() throws {
  var story = prepared()
  story.development = [.init(jiraKey: "APP-2", days: 0.1, recordedEstimateSeconds: 2880)]
  story.recordedStoryEstimateSeconds = 3456
  try story.handoff(role: .techLead, canEdit: true)
  story.qaApproved = true
  story.testPlan = "Plan"
  story.testData = "Data"
  story.environment = "Env"
  story.testConditions = "Conditions"
  story.qaTask = .init(jiraKey: "APP-3", days: Double(576) / 28_800, recordedEstimateSeconds: 576)
  try story.confirmReady(role: .qaLead, canEdit: true)
  #expect(story.state == .ready)
}

@Test func exampleReleaseExportsRealExcelAndCannotBindToProductionJira() throws {
  let release = try ExampleRelease.make()
  #expect(release.isReady)
  #expect(abs(release.clientDays - 9.6) < 0.000001)
  #expect(release.jiraOrigin == "https://example.powerview.invalid")
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let url = directory.appendingPathComponent("example.xlsx")
  try ExcelWorkbook.export(release, to: url)
  let sheet = try ExcelWorkbook.read(at: url, sheetPath: ExcelWorkbook.sheetPaths(at: url)[0])
  #expect(sheet.rows[2]?["A"] == "DEMO-1")
  #expect(Double(sheet.rows[2]?["B"] ?? "") == 3.6)
  #expect(try Release.decode(JSONEncoder().encode(release)) == release)
}
