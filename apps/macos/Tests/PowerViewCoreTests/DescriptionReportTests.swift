import Foundation
import Testing

@testable import PowerViewCore

@Test func descriptionReportsMatchTheSharedTypeScriptGolden() throws {
  let url = Bundle.module.url(
    forResource: "description-report-golden", withExtension: "json", subdirectory: "Fixtures")!
  let fixtures = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)).array
  for fixture in fixtures {
    let input = fixture["input"]
    let report = try DescriptionReportBuilder.build(
      origin: input["jiraBaseUrl"].plainText, boardID: input["boardId"].plainText,
      boardName: input["boardName"].plainText, date: input["period"]["date"].plainText,
      generatedAt: input["generatedAt"].plainText, issues: input["issues"].array,
      events: input["events"].array)
    let value = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(report))
    #expect(value == fixture["expected"])
  }
}
@Test func descriptionEveningsUseKyivDSTAndStrictCalendarDates() throws {
  for (date, hours) in [("2026-03-29", 23.0), ("2026-10-25", 25.0), ("2026-11-06", 24.0)] {
    let period = try DescriptionReportPeriod.build(date)
    #expect(
      ReportPeriod.date(period.end)!.timeIntervalSince(ReportPeriod.date(period.start)!) / 3600
        == hours)
  }
  #expect(throws: DescriptionReportError.invalidDate) {
    try DescriptionReportPeriod.build("2026-02-30")
  }
  #expect(
    DescriptionReportPeriod.latestDate(now: ReportPeriod.date("2026-11-06T18:59:59Z")!)
      == "2026-11-05")
  #expect(
    DescriptionReportPeriod.latestDate(now: ReportPeriod.date("2026-11-06T19:00:00Z")!)
      == "2026-11-06")
}
private actor DescriptionTransport: JiraTransport {
  let scenario: String
  var methods: [String] = []
  var myselfReads = 0
  init(_ scenario: String) { self.scenario = scenario }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    methods.append(request.httpMethod ?? "GET")
    let url = request.url!
    var code = 200
    let value: JSONValue
    if url.path.hasSuffix("/myself") {
      myselfReads += 1
      value = .object([
        "accountId": .string(scenario == "identity" && myselfReads > 1 ? "other" : "viewer"),
        "displayName": .string("TEST DATA"),
      ])
    } else if url.path.hasSuffix("/board/7") {
      value = .object(["id": .number(7), "name": .string("TEST DATA")])
    } else if url.path.hasSuffix("/board/7/issue") {
      let issue: JSONValue = .object([
        "id": .string("2"), "key": .string("TEST-2"),
        "fields": .object([
          "summary": .string("Child"), "issuetype": .object(["name": .string("Subtask")]),
          "parent": .object(["id": .string("1"), "key": .string("TEST-1")]),
        ]),
      ])
      value = .object([
        "startAt": .number(0), "total": .number(scenario == "partial" ? 2 : 1),
        "issues": .array(scenario == "partial" ? [] : [issue]),
      ])
    } else if url.path.hasSuffix("/TEST-2/changelog") {
      if scenario == "history" {
        code = 403
        value = .null
      } else {
        let history: JSONValue = .object([
          "id": .string("10"), "created": .string("2026-11-06T10:00:00Z"),
          "author": .object(["accountId": .string("editor"), "displayName": .string("Editor")]),
          "items": .array([
            .object([
              "fieldId": .string("description"), "field": .string("Опис"),
              "fromString": .string("Private old body"), "toString": .string("Private new body"),
            ])
          ]),
        ])
        let start =
          URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: {
            $0.name == "startAt"
          })?.value ?? "0"
        value = .object([
          "startAt": .number(Double(start)!), "total": .number(scenario == "repeated" ? 2 : 1),
          "values": .array([history]),
        ])
      }
    } else if url.path.hasSuffix("/issue/TEST-1") {
      if scenario == "parent" {
        code = 403
        value = .null
      } else {
        value = .object([
          "id": .string("1"), "key": .string("TEST-1"),
          "fields": .object([
            "summary": .string("Epic"), "issuetype": .object(["name": .string("Epic")]),
          ]),
        ])
      }
    } else {
      code = 404
      value = .null
    }
    return (
      try JSONEncoder().encode(value),
      HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: nil)!
    )
  }
}
@Test func nativeDescriptionReportReadsHistoryAndAncestorsWithoutJiraWrites() async throws {
  let transport = DescriptionTransport("complete")
  let client = JiraClient(
    connection: try JiraConnection(
      origin: "https://fixture.atlassian.net", email: "fixture@example.invalid",
      token: "fixture-only"), transport: transport)
  let report = try await client.descriptionChangeReport(
    boardID: "7", date: "2026-11-06", expectedUserID: "viewer",
    now: ReportPeriod.date("2026-11-06T19:05:00Z")!)
  #expect(report.rows.map(\.issueKey) == ["TEST-1", "TEST-2"])
  #expect(report.rows[1].authors.first?.displayName == "Editor")
  #expect(!String(decoding: try JSONEncoder().encode(report), as: UTF8.self).contains("Private"))
  #expect(await transport.methods.allSatisfy { $0 == "GET" })
}
@Test(arguments: ["partial", "history", "parent", "identity", "repeated"])
func nativeDescriptionReportRejectsPartialHistoryAndObsoleteIdentity(_ scenario: String)
  async throws
{
  let transport = DescriptionTransport(scenario)
  let client = JiraClient(
    connection: try JiraConnection(
      origin: "https://fixture.atlassian.net", email: "fixture@example.invalid",
      token: "fixture-only"), transport: transport)
  await #expect(throws: (any Error).self) {
    try await client.descriptionChangeReport(
      boardID: "7", date: "2026-11-06", expectedUserID: "viewer",
      now: ReportPeriod.date("2026-11-06T19:05:00Z")!)
  }
  #expect(await transport.methods.allSatisfy { $0 == "GET" })
}
