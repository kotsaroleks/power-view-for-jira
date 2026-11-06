import Testing

@testable import PowerViewCore

@Test func sprintPersonUsesCloudAndDataCenterIdentifiers() {
  #expect(
    SprintPresentation.owner(
      .object(["assignee": .object(["accountId": .string("cloud"), "id": .string("different")])]))
      == "cloud")
  #expect(
    SprintPresentation.owner(.object(["assignee": .object(["username": .string("dc")])])) == "dc")
  #expect(SprintPresentation.owner(.object([:])) == "__unassigned__")
}
@Test func sprintFinishedFilterRespectsMappingAndCategory() {
  let issue: JSONValue = .object([
    "status": .object([
      "id": .string("42"), "name": .string("Accepted"), "category": .string("in-progress"),
    ])
  ])
  #expect(
    SprintPresentation.category(issue, completedIDs: [.string("42")], completedNames: []) == "done")
  #expect(
    SprintPresentation.category(issue, completedIDs: [], completedNames: [.string("Accepted")])
      == "done")
  #expect(SprintPresentation.category(issue, completedIDs: [], completedNames: []) == "in-progress")
}
