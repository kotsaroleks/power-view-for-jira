import Foundation
import Testing

@testable import PowerViewCore

private struct Golden: Decodable {
  struct Case: Decodable {
    let name: String
    let input: ReportingInput
    let mode: String?
    let expected: JSONValue
  }
  struct Period: Decodable {
    let date: String
    let type: String
    let generatedAt: String
    let expected: ReportPeriod
  }
  let cases: [Case]
  let periods: [Period]
}
@Test func reportResultsMatchOriginalTypeScriptGoldenOutputs() throws {
  let url = Bundle.module.url(
    forResource: "reporting-golden", withExtension: "json", subdirectory: "Fixtures")!
  let golden = try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
  for fixture in golden.cases {
    #expect(
      ReportCalculator.calculate(fixture.input, progressMode: fixture.mode) == fixture.expected,
      "Mismatch: \(fixture.name)")
  }
  for fixture in golden.periods {
    #expect(
      try ReportPeriod.build(
        type: fixture.type, localDate: fixture.date, generatedAt: fixture.generatedAt)
        == fixture.expected, "DST mismatch: \(fixture.date) \(fixture.type)")
  }
}
@Test func boardAndSprintHealthMatchOriginalGoldenOutputs() throws {
  struct Fixture: Decodable {
    let issues: [JSONValue]
    let sprint: JSONValue
    let blockedIDs: Set<String>
    let options: JSONValue
    let expectedBoard: JSONValue
    let expectedSprint: JSONValue
  }
  let url = Bundle.module.url(
    forResource: "health-golden", withExtension: "json", subdirectory: "Fixtures")!
  for fixture in try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url)) {
    #expect(
      BoardHealthCalculator.board(fixture.issues, options: fixture.options) == fixture.expectedBoard
    )
    #expect(
      BoardHealthCalculator.sprint(
        fixture.issues, sprint: fixture.sprint, blockedIDs: fixture.blockedIDs,
        options: fixture.options) == fixture.expectedSprint)
  }
}

@Test func blockedReportMetricMatchesExistingProductWithoutPortingScheduler() throws {
  struct Fixture: Decodable {
    let issues: [JSONValue]
    let expected: Set<String>
  }
  let url = Bundle.module.url(
    forResource: "blocked-golden", withExtension: "json", subdirectory: "Fixtures")!
  let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
  #expect(BlockedMetric.calculate(fixture.issues) == fixture.expected)
}
