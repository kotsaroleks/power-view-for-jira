import Foundation
import Testing

@testable import PowerViewCore

@Test func cascadeMatchesOriginalChromeForAllFourTypesLagWeekendsAndChains() throws {
  let url = Bundle.module.url(
    forResource: "cascade-golden", withExtension: "json", subdirectory: "Fixtures")!
  let cases = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)).array
  for item in cases {
    let input = item["input"]
    let schedule = Dictionary(
      uniqueKeysWithValues: input["tasks"].array.map { task in
        (
          task["issueKey"].string!,
          TimelineScheduleEntry(
            start: task["start"].string!, end: task["end"].string!, state: "confirmed",
            startSource: "jira", endSource: "jira", progress: 0, progressSource: "status",
            warnings: [])
        )
      })
    let links = input["dependencies"].array.map {
      TimelineLink(
        predecessor: $0["predecessorIssueKey"].string!, successor: $0["successorIssueKey"].string!,
        kind: TimelineLinkKind(rawValue: $0["type"].string!)!,
        lagWorkingDays: Int($0["lagWorkingDays"].number!))
    }
    let actual = try TimelineCascade.plan(
      schedule: schedule, order: input["tasks"].array.compactMap { $0["issueKey"].string },
      links: links, changedKey: input["changedIssueKey"].string!,
      start: input["changedDates"]["startDate"].string!,
      end: input["changedDates"]["dueDate"].string!)
    let expected = try JSONDecoder().decode(
      [TimelineCascade.Update].self, from: JSONEncoder().encode(item["expected"]))
    #expect(actual == expected)
  }
}

@Test func externalJiraChangesAreDetectedFromAcceptedBaselineWithoutOverridingCurrentDates() throws
{
  let url = Bundle.module.url(
    forResource: "external-conflicts-golden", withExtension: "json", subdirectory: "Fixtures")!
  let cases = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)).array
  for item in cases {
    let input = item["input"]
    let schedule = Dictionary(
      uniqueKeysWithValues: input["tasks"].array.map { task in
        (
          task["issueKey"].string!,
          TimelineScheduleEntry(
            start: task["start"].string!, end: task["end"].string!, state: "confirmed",
            startSource: "jira", endSource: "jira", progress: 0, progressSource: "status",
            warnings: [])
        )
      })
    let links = input["boardState"]["dependencies"].array.map {
      TimelineLink(
        predecessor: $0["predecessorIssueKey"].string!, successor: $0["successorIssueKey"].string!,
        kind: TimelineLinkKind(rawValue: $0["type"].string!)!,
        lagWorkingDays: Int($0["lagWorkingDays"].number!))
    }
    let reconciled = input["boardState"]["reconciledDates"].object.mapValues {
      LocalIssuePlan(start: $0["startDate"].string, due: $0["dueDate"].string, dependencies: [])
    }
    let conflicts = try TimelineExternalConflicts.find(
      schedule: schedule, order: input["tasks"].array.compactMap { $0["issueKey"].string },
      links: links, reconciled: reconciled)
    #expect(conflicts.count == item["expected"].array.count)
    for (index, conflict) in conflicts.enumerated() {
      #expect(conflict.issueKey == item["expected"].array[index]["issueKey"].string)
      let expected = try JSONDecoder().decode(
        [TimelineCascade.Update].self,
        from: JSONEncoder().encode(item["expected"].array[index]["repairUpdates"]))
      #expect(conflict.repairUpdates == expected)
    }
  }
}
