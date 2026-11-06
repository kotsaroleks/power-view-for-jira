import Foundation
import Testing
@testable import PowerViewCore

private func timeJSON(_ value: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(value.utf8)) }
private let timeIssueFixture = #"{"id":"1","key":"APP-1","fields":{"summary":"Fixture","project":{"id":"100","key":"APP"}}}"#
private func timeLogFixture(_ id: String = "10", author: String = "me", started: String = "2026-11-02T23:30:00.123+0000", seconds: Int = 3661, updated: String = "2026-11-03T00:00:00.000+0000") -> String {
  """
  {"id":"\(id)","issueId":"1","author":{"accountId":"\(author)"},"started":"\(started)","updated":"\(updated)","timeSpentSeconds":\(seconds),"comment":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Original","marks":[{"type":"strong"}]}]}]}}
  """
}
private actor TimeTransport: JiraTransport {
  var mutations: [URLRequest] = []
  var searches: [JSONValue] = []
  let unknown: Bool; let stale: Bool; let noZone: Bool; let looping: Bool
  init(unknown: Bool = false, stale: Bool = false, noZone: Bool = false, looping: Bool = false) { self.unknown = unknown; self.stale = stale; self.noZone = noZone; self.looping = looping }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let path = request.url!.path; var status = 200; let value: String
    if path.hasSuffix("myself") { value = noZone ? #"{"accountId":"me","displayName":"Me"}"# : #"{"accountId":"me","displayName":"Me","timeZone":"Europe/Kyiv"}"# }
    else if path.hasSuffix("search/jql") {
      searches.append(try JSONDecoder().decode(JSONValue.self, from: request.httpBody!))
      value = "{\"issues\":[" + timeIssueFixture + "],\"isLast\":" + (looping ? "false,\"nextPageToken\":\"again\"}" : "true}")
    } else if request.httpMethod == "PUT" || request.httpMethod == "POST" || request.httpMethod == "DELETE" {
      mutations.append(request)
      if unknown { throw URLError(.timedOut) }
      status = request.httpMethod == "DELETE" ? 204 : 200
      value = request.httpMethod == "DELETE" ? "" : timeLogFixture()
    } else if path.hasSuffix("/worklog") {
      value = "{\"startAt\":0,\"total\":3,\"worklogs\":[" + [timeLogFixture(), timeLogFixture("11", author: "other"), timeLogFixture("12", started: "2026-11-03T23:30:00.000+0000")].joined(separator: ",") + "]}"
    } else { value = timeLogFixture(updated: stale ? "2026-11-04T00:00:00.000+0000" : "2026-11-03T00:00:00.000+0000") }
    return (Data(value.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}
private func timeClient(_ transport: TimeTransport) throws -> JiraClient { JiraClient(connection: try JiraConnection(origin: "https://jira.example.test", email: "fixture@example.test", token: "fixture-only"), transport: transport) }

@Test func timeCalendarRejectsSkippedClockAndKeepsBothOverlapChoices() {
  #expect(TimeCalendar.localChoices(day: "2026-03-29", clock: "03:30", zone: "Europe/Kyiv").isEmpty)
  let overlap = TimeCalendar.localChoices(day: "2026-10-25", clock: "03:30", zone: "Europe/Kyiv")
  #expect(overlap.count == 2)
  #expect(TimeCalendar.instant(overlap.last!)!.timeIntervalSince(TimeCalendar.instant(overlap.first!)!) == 3600)
  #expect(TimeCalendar.days(anchor: "2026-11-01", month: false).first == "2026-10-26")
  #expect(TimeCalendar.days(anchor: "2028-02-20", month: true).count == 29)
  #expect(!TimeCalendar.validDay("2026-02-30"))
}
@Test func timeDurationsAndQuotedJQLPreserveIntent() {
  #expect(TimeCalendar.parseDuration("1h 30m") == 5400)
  #expect(TimeCalendar.parseDuration("90m") == 5400)
  #expect(TimeCalendar.parseDuration("1:30") == 5400)
  #expect(TimeCalendar.parseDuration("90") == nil)
  #expect(TimeCalendar.parseDuration("0m") == nil)
  #expect(TimeCalendar.parseDuration("1:60") == nil)
  #expect(TimeCalendar.duration(3661) == "1h 1m 1s")
  #expect(TimeCalendar.filterJQL(#"summary ~ "order by" ORDER BY updated DESC"#) == #"summary ~ "order by""#)
}
@Test func ownTimeUsesExactTimezoneAndNeverIncludesOtherAuthors() async throws {
  let transport = TimeTransport(); let client = try timeClient(transport)
  let result = try await client.loadTime(TimeQuery(days: ["2026-11-03"], zone: "Europe/Kyiv"), viewer: "me")
  #expect(result.complete)
  #expect(result.worklogs.map(\.id) == ["10"])
  #expect(result.worklogs.first?.seconds == 3661)
  #expect(result.readWorklogCount == 3)
  #expect(result.discoveryJQL.contains("worklogDate"))
}
@Test func missingProfileTimezoneDoesNotApplyUnsafeDiscoveryDates() async throws {
  let transport = TimeTransport(noZone: true)
  let result = try await timeClient(transport).loadTime(TimeQuery(days: ["2026-11-03"], zone: "Europe/Kyiv"), viewer: "me")
  #expect(!result.discoveryJQL.contains("worklogDate"))
  #expect(result.worklogs.count == 1)
}
@Test func repeatedTimeSearchCursorFailsRatherThanReturningPartialSuccess() async throws {
  let transport = TimeTransport(looping: true)
  await #expect(throws: JiraError.paginationIncomplete) { try await timeClient(transport).timeSearch("worklogAuthor = currentUser()") }
  #expect(await transport.searches.count == 2)
}
@Test func worklogEditPreservesStartedSecondsAndRichCommentByOmission() async throws {
  let transport = TimeTransport(); let issue = try TimeIssue(raw: timeJSON(timeIssueFixture)); let old = try TimeWorklog(raw: timeJSON(timeLogFixture()), issue: issue)
  _ = try await timeClient(transport).saveTime(issue, started: old.started, seconds: old.seconds, comment: nil, expectedUser: "me", original: old)
  let requests = await transport.mutations
  #expect(requests.count == 1)
  let request = try #require(requests.first)
  #expect(request.httpMethod == "PUT")
  #expect(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "leave")
  let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
  #expect(body["started"].string == old.started)
  #expect(body["timeSpentSeconds"].number == 3661)
  #expect(body["comment"] == .null)
}
@Test func staleWorklogAndOtherAuthorNeverProduceAMutation() async throws {
  let transport = TimeTransport(stale: true); let issue = try TimeIssue(raw: timeJSON(timeIssueFixture)); let old = try TimeWorklog(raw: timeJSON(timeLogFixture()), issue: issue)
  await #expect(throws: TimeTrackingError.conflict) { try await timeClient(transport).deleteTime(issue, original: old, expectedUser: "me") }
  let other = try TimeWorklog(raw: timeJSON(timeLogFixture(author: "other")), issue: issue)
  await #expect(throws: TimeTrackingError.identity) { try await timeClient(transport).saveTime(issue, started: other.started, seconds: 60, comment: nil, expectedUser: "me", original: other) }
  #expect(await transport.mutations.isEmpty)
}
@Test func unknownWorklogWriteIsNeverRetried() async throws {
  let transport = TimeTransport(unknown: true); let issue = try TimeIssue(raw: timeJSON(timeIssueFixture))
  await #expect(throws: TimeTrackingError.unknownOutcome) { try await timeClient(transport).saveTime(issue, started: "2026-11-03T09:00:00Z", seconds: 60, comment: "fixture", expectedUser: "me") }
  #expect(await transport.mutations.count == 1)
}
@Test func timeReportUsesWeekdaysUniqueOffAndUnknownCapacity() throws {
  let issue = try TimeIssue(raw: timeJSON(timeIssueFixture)); let log = try TimeWorklog(raw: timeJSON(timeLogFixture(seconds: 3600)), issue: issue)
  let users = [JiraUser(accountId: "me", displayName: "Me"), JiraUser(accountId: "other", displayName: "Other")]
  let query = TimeQuery(days: TimeCalendar.days(anchor: "2026-11-03", month: false), zone: "Europe/Kyiv")
  var calendar = SharedDayOff(); calendar.dates = ["me": ["2026-11-03", "2026-11-07"]]
  let result = try TimeReportCalculator.build(users: users, worklogs: [log, log], query: query, calendar: calendar, worklogsComplete: true)
  #expect(result[0].logged == 3600)
  #expect(result[0].expected == 32 * 3600)
  #expect(result[1].expected == 40 * 3600)
  #expect(result[0].days["2026-11-03"] == 3600) // conflicts keep actual recorded time
  calendar.warnings = ["unread month"]
  let partial = try TimeReportCalculator.build(users: users, worklogs: [log], query: query, calendar: calendar, worklogsComplete: true)
  #expect(partial.allSatisfy { $0.expected == nil && $0.utilization == nil })
  let weekend = try TimeReportCalculator.build(users: users, worklogs: [], query: TimeQuery(days: ["2026-11-07"], zone: "UTC"), calendar: SharedDayOff(), worklogsComplete: true)
  #expect(weekend[0].expected == 0 && weekend[0].utilization == nil)
}
