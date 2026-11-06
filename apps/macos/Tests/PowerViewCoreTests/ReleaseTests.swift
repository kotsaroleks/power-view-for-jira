import Foundation
import Testing

@testable import PowerViewCore

func releaseFixture() throws -> Release {
  var release = try Release(
    name: "Pilot", teamName: "Team", projectKey: "APP",
    coordinator: .init(id: "c", name: "Coordinator", role: .coordinator))
  try release.setMember(.init(id: "tl", name: "TL", role: .techLead), actorID: "c")
  try release.setMember(.init(id: "qa", name: "QA", role: .qaLead), actorID: "c")
  try release.add(prepared(), actorID: "c")
  return release
}
@Test func releaseScopeHistoryAndRoles() throws {
  var release = try releaseFixture()
  #expect(throws: ReleaseError.forbidden) {
    try release.add(Story(id: "APP-5", title: "No"), actorID: "qa")
  }
  #expect(throws: ReleaseError.wrongProject) {
    try release.add(Story(id: "OTHER-1", title: "No"), actorID: "c")
  }
  #expect(throws: ReleaseError.duplicateKey) { try release.add(prepared(), actorID: "c") }
  #expect(throws: ReleaseError.forbidden) {
    try release.updateStory(key: "APP-1", actorID: "qa") { story, _ in story.testPlan = "Too early"
    }
  }
  let revision = release.revision
  try release.remove(key: "APP-1", actorID: "c")
  #expect(release.history.last?.stories.first?.id == "APP-1")
  #expect(release.revision == revision + 1)
  #expect(!release.isReady)
  #expect(try Release.decode(JSONEncoder().encode(release)) == release)
}
func readyRelease() throws -> Release {
  var release = try releaseFixture()
  try release.updateStory(key: "APP-1", actorID: "tl") { story, role in
    try story.handoff(role: role, canEdit: true)
  }
  try release.updateStory(key: "APP-1", actorID: "qa") { story, role in
    story.qaApproved = true
    story.testPlan = "Plan"
    story.testData = "Data"
    story.environment = "Env"
    story.testConditions = "Conditions"
    story.qaTask = .init(jiraKey: "APP-3", days: 2, recordedEstimateSeconds: 57_600)
    try story.confirmReady(role: role, canEdit: true)
  }
  return release
}
@Test func releaseApprovalIsBoundToScopeRevision() throws {
  var release = try readyRelease()
  #expect(release.isReady)
  #expect(release.clientDays == 12)
  try recordFixtureClientExport(&release, actorID: "c")
  try release.approveCustomer(actorID: "c")
  #expect(release.customerApprovalRevision == release.revision)
  try release.add(Story(id: "APP-5", title: "New scope"), actorID: "c")
  #expect(release.customerApprovalRevision == nil)
  #expect(throws: ReleaseError.releaseNotReady) { try release.approveCustomer(actorID: "c") }
}
@Test func excelExportIsRealXLSXAndImportDiagnosesRows() throws {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString + ".xlsx")
  defer { try? FileManager.default.removeItem(at: url) }
  #expect(throws: ExcelError.releaseNotReady) {
    try ExcelWorkbook.export(releaseFixture(), to: url)
  }
  try ExcelWorkbook.export(readyRelease(), to: url)
  let data = try Data(contentsOf: url)
  #expect(data.starts(with: [0x50, 0x4b]))
  let paths = try ExcelWorkbook.sheetPaths(at: url)
  let sheet = try ExcelWorkbook.read(at: url, sheetPath: paths[0])
  #expect(sheet.rows[2]?["A"] == "APP-1")
  #expect(sheet.rows[2]?["B"] == "12.0")
  #expect(
    sheet.preview(column: "A", project: "APP", existingKeys: []).compactMap(\.key) == ["APP-1"])
  #expect(
    sheet.preview(column: "A", project: "APP", existingKeys: ["APP-1"])[1].problem == "Дублікат")
  #expect(
    sheet.preview(column: "A", project: "OTHER", existingKeys: [])[1].problem == "Інший Jira-проєкт"
  )
}

func recordFixtureClientExport(_ release: inout Release, actorID: String) throws {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString + ".xlsx")
  defer { try? FileManager.default.removeItem(at: url) }
  try ExcelWorkbook.export(release, to: url)
  try release.recordClientExport(xlsxData: Data(contentsOf: url), actorID: actorID)
}
@Test func customerApprovalRequiresCurrentExportAndArchivesSurviveScopeChanges() throws {
  var release = try readyRelease()
  #expect(throws: ReleaseError.missingClientExport) { try release.approveCustomer(actorID: "c") }
  try recordFixtureClientExport(&release, actorID: "c")
  let material = try #require(release.currentClientExport)
  try release.approveCustomer(actorID: "c")
  #expect(release.customerApprovalExportID == material.id)
  try release.add(Story(id: "APP-6", title: "New scope"), actorID: "c")
  #expect(release.currentClientExport == nil && release.customerApprovalExportID == nil)
  #expect(release.clientExports[0].xlsxData == material.xlsxData)
  #expect(release.clientExports[0].estimates.map(\.issueKey) == ["APP-1"])
  let decoded = try Release.decode(JSONEncoder().encode(release))
  #expect(decoded.clientExports[0].isIntact)
}

@Test func staleStoryFormCannotOverwriteNewerPreparation() throws {
  var release = try releaseFixture()
  let original = release.stories[0]
  try release.updateStory(key: original.id, actorID: "tl", expectedStory: original) { story, _ in
    story.acceptanceCriteria = "Newer work"
  }
  #expect(throws: ReleaseError.staleStory) {
    try release.updateStory(key: original.id, actorID: "tl", expectedStory: original) { story, _ in
      story.acceptanceCriteria = "Stale form"
    }
  }
  #expect(release.stories[0].acceptanceCriteria == "Newer work")
}

@Test func planningBufferChangesDoNotAlterCustomerMaterialsOrQAReadiness() throws {
  var release = try readyRelease()
  try recordFixtureClientExport(&release, actorID: "c")
  try release.approveCustomer(actorID: "c")
  let approved = release.customerApprovalExportID
  let original = release.currentClientExport?.xlsxData
  try release.updateStory(key: "APP-1", actorID: "tl") { story, role in
    try story.setBuffer(0.4, role: role, canEdit: true)
  }
  #expect(release.isReady)
  #expect(release.clientDays == 12)
  #expect(release.stories[0].originalEstimateSeconds == 345_600)
  #expect(release.isCustomerApproved)
  #expect(release.customerApprovalExportID == approved)
  #expect(release.currentClientExport?.xlsxData == original)
}
