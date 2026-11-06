import Testing

@testable import PowerViewCore

func prepared() -> Story {
  var story = Story(id: "APP-1", title: "Example")
  story.recordedStoryEstimateSeconds = 345_600
  story.acceptanceCriteria = "AC"
  story.definitionOfDone = "DoD"
  story.noOpenQuestions = true
  story.tlApproved = true
  story.decompositionComplete = true
  story.development = [.init(jiraKey: "APP-2", days: 10, recordedEstimateSeconds: 288_000)]
  return story
}
@Test func estimatesExcludeBuffer() throws {
  var story = prepared()
  #expect(story.qaDays == 2)
  #expect(story.clientDays == 12)
  #expect(story.originalEstimateSeconds == 345_600)
  try story.setBuffer(0.5, role: .coordinator, canEdit: true)
  #expect(story.clientDays == 12)
  story.explicitQADays = 3
  #expect(story.clientDays == 13)
}
@Test func workflowRequiresRecordedTasksAndRole() throws {
  var story = prepared()
  #expect(throws: PreparationError.forbidden) {
    try story.handoff(role: .coordinator, canEdit: true)
  }
  #expect(throws: PreparationError.forbidden) { try story.handoff(role: .techLead, canEdit: false) }
  story.development[0].recordedEstimateSeconds = nil
  #expect(!story.tlRequirements.isEmpty)
  story.development[0].recordedEstimateSeconds = 288_000
  try story.handoff(role: .techLead, canEdit: true)
  #expect(story.state == .qa)
  #expect(throws: PreparationError.self) { try story.confirmReady(role: .qaLead, canEdit: true) }
  story.qaApproved = true
  story.testPlan = "Plan"
  story.testData = "Data"
  story.environment = "Environment"
  story.testConditions = "Conditions"
  story.qaTask = .init(jiraKey: "APP-3", days: 2, recordedEstimateSeconds: 57_600)
  try story.confirmReady(role: .qaLead, canEdit: true)
  #expect(story.state == .ready)
}
@Test func returnNeedsNotesAndFreshTLApproval() throws {
  var story = prepared()
  try story.handoff(role: .techLead, canEdit: true)
  #expect(throws: PreparationError.self) {
    try story.returnToTL(notes: " ", role: .qaLead, canEdit: true)
  }
  try story.returnToTL(notes: "Уточніть дані", role: .qaLead, canEdit: true)
  #expect(story.state == .returned)
  #expect(!story.noOpenQuestions && !story.tlApproved)
  #expect(!story.tlRequirements.isEmpty)
}
@Test func malformedEstimatesCannotBecomeJiraValues() {
  var story = prepared()
  story.explicitQADays = .infinity
  #expect(story.originalEstimateSeconds == nil)
  #expect(!story.qaRequirements.isEmpty)
  let task = DevelopmentTask(
    jiraKey: "APP-9", days: .greatestFiniteMagnitude, recordedEstimateSeconds: 1)
  #expect(!task.isRecorded)
}
