import Foundation
import Testing
@testable import PowerViewCore

private actor CalendarTransport: JiraTransport {
  var writes = 0
  var dates: Set<String> = []
  let scenario: String
  init(_ scenario: String) { self.scenario = scenario }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    var status = 200; let raw: JSONValue
    if request.httpMethod == "PUT" {
      writes += 1
      let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
      let record = try JSONDecoder().decode(JSONValue.self, from: Data(base64Encoded: body["content"].plainText)!)
      if scenario == "merge" && writes == 1 { dates.insert("2026-11-04"); status = 409; raw = .null }
      else {
        dates = Set(record["dates"].array.compactMap(\.string))
        if scenario == "timeout" { throw URLError(.timedOut) }
        raw = .object(["content": .object(["sha": .string("new")])])
      }
    } else if request.url!.path.contains("/branches/") {
      status = scenario == "denied" ? 404 : 200
      raw = .object(["name": .string("main"), "commit": .object(["sha": .string("commit")])])
    } else if scenario == "missing" || scenario == "denied" { status = 404; raw = .null }
    else {
      let record: JSONValue = .object(["schemaVersion": .number(1), "jiraBaseUrl": .string("https://jira.example.test"), "jiraAccountId": .string("me"), "month": .string("2026-11"), "dates": .array(dates.sorted().map(JSONValue.string)), "updatedAt": .string("2026-11-01T00:00:00Z")])
      raw = .object(["type": .string("file"), "encoding": .string("base64"), "sha": .string("sha-\(dates.count)"), "content": .string(scenario == "malformed" ? "!!!!" : try JSONEncoder().encode(record).base64EncodedString())])
    }
    return (try JSONEncoder().encode(raw), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}
private func calendarFixture(_ transport: CalendarTransport) throws -> GitHubTimeCalendar {
  try GitHubTimeCalendar(configuration: DayOffConfiguration(owner: "fixture", repo: "calendar", branch: "main", root: "shared", token: "fixture-only"), transport: transport)
}
@Test func sharedCalendarUsesChromeUTF8HexPaths() {
  #expect(GitHubTimeCalendar.storageKey("a/b") == "612f62")
  #expect(GitHubTimeCalendar.storageKey("ї") == "d197")
}
@Test func missingCalendarIsEmptyOnlyWhenBranchIsAccessible() async throws {
  let absent = try await calendarFixture(CalendarTransport("missing")).read(baseURL: "https://jira.example.test", accounts: ["me"], days: ["2026-11-03"])
  #expect(absent.complete && absent.dates["me"]?.isEmpty == true)
  let denied = try await calendarFixture(CalendarTransport("denied")).read(baseURL: "https://jira.example.test", accounts: ["me"], days: ["2026-11-03"])
  #expect(!denied.complete)
}
@Test func concurrentCalendarWriteMergesOtherDatesUsingLatestSHA() async throws {
  let transport = CalendarTransport("merge"); let calendar = try calendarFixture(transport)
  try await calendar.set(baseURL: "https://JIRA.example.test:443/", account: "me", day: "2026-11-03", enabled: true, verify: {})
  #expect(await transport.writes == 2)
  #expect(await transport.dates == ["2026-11-03", "2026-11-04"])
}
@Test func calendarTimeoutReconcilesWithoutReplayingWrite() async throws {
  let transport = CalendarTransport("timeout"); let calendar = try calendarFixture(transport)
  try await calendar.set(baseURL: "https://jira.example.test", account: "me", day: "2026-11-03", enabled: true, verify: {})
  #expect(await transport.writes == 1)
  #expect(await transport.dates.contains("2026-11-03"))
}
@Test func malformedSharedCalendarIsUnknownAndNeverOverwritten() async throws {
  let transport = CalendarTransport("malformed"); let calendar = try calendarFixture(transport)
  let result = try await calendar.read(baseURL: "https://jira.example.test", accounts: ["me"], days: ["2026-11-03"])
  #expect(!result.complete)
  await #expect(throws: (any Error).self) { try await calendar.set(baseURL: "https://jira.example.test", account: "me", day: "2026-11-03", enabled: true, verify: {}) }
  #expect(await transport.writes == 0)
}
