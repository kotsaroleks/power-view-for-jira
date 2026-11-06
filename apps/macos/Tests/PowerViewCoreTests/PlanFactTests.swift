import Testing

@testable import PowerViewCore

@Test func planFactNeverCountsTheParentOrQATwice() {
  var story = prepared()
  story.qaTask = .init(jiraKey: "APP-3", days: 2, recordedEstimateSeconds: 57_600)
  let fact = StoryPlanFact(
    story: story, worklogSecondsByKey: ["APP-1": 1_000_000, "APP-2": 3600, "APP-3": 1800])
  #expect(fact.developmentActualSeconds == 3600)
  #expect(fact.qaActualSeconds == 1800)
  #expect(fact.developmentPlannedSeconds + fact.qaPlannedSeconds == 345_600)
  let incomplete = StoryPlanFact(story: story, worklogSecondsByKey: [:])
  #expect(incomplete.developmentActualSeconds == nil && incomplete.qaActualSeconds == nil)
}
