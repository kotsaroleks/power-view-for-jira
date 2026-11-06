// Shared by application tests and the background renderer. All requests stay in memory.
import Foundation
import PowerViewCore

actor NativeTimeFixtureTransport: JiraTransport {
  static let origin = "https://time-fixture.invalid"
  static let teamA = "11111111-1111-4111-8111-111111111111"
  static let teamB = "22222222-2222-4222-8222-222222222222"
  var user = "fixture"
  var zone = "Europe/Kyiv"
  var requests: [URLRequest] = []
  var mutations: [URLRequest] = []
  var failedIssues = Set<String>()
  var delaySearch = false
  var delayBoard = false
  var timeoutWrite = false
  var failWrite = false
  var demoIssues = false
  var failTeams = false
  var slowTeam = false
  private var serial = 100
  var logs: [String: [JSONValue]] = [
    "TEST-2": [NativeTimeFixtureTransport.log(id: "10", issue: "2", day: "2026-11-03", seconds: 5400), NativeTimeFixtureTransport.log(id: "11", issue: "2", day: "2026-11-03", author: "other", seconds: 3600)],
    "TEST-3": [NativeTimeFixtureTransport.log(id: "12", issue: "3", day: "2026-10-28", seconds: 7200)],
  ]
  static func issue(_ index: Int) -> JSONValue {
    .object(["id": .string(String(index)), "key": .string("TEST-\(index)"), "fields": .object([
      "summary": .string(index == 1 ? "Project activities" : "Fixture task \(index)"),
      "project": .object(["id": .string("100"), "key": .string("TEST")]),
      "issuetype": .object(["hierarchyLevel": .number(index == 1 ? 1 : index == 4 ? -1 : 0), "name": .string(index == 1 ? "Epic" : index == 4 ? "Sub-task" : "Story"), "subtask": .bool(index == 4)]),
      "assignee": .object(["accountId": .string(index == 2 ? "fixture" : "other")]),
      "parent": index == 1 ? .null : .object(["key": .string(index == 4 ? "TEST-2" : "TEST-1")]),
    ])])
  }
  static func log(id: String, issue: String, day: String, author: String = "fixture", seconds: Int = 3600) -> JSONValue {
    .object(["id": .string(id), "issueId": .string(issue), "author": .object(["accountId": .string(author)]),
      "started": .string(day + "T09:00:27.123+0000"), "updated": .string("2026-11-01T00:00:00Z"), "timeSpentSeconds": .number(Double(seconds)),
      "comment": .object(["type": .string("doc"), "version": .number(1), "content": .array([.object(["type": .string("paragraph"), "content": .array([.object(["type": .string("text"), "text": .string("Keep formatting"), "marks": .array([.object(["type": .string("strong")])])])])])])]),
    ])
  }
  func setFailTeams(_ value: Bool) { failTeams = value }
  func setSlowTeam(_ value: Bool) { slowTeam = value }
  func useDemoIssues() { demoIssues = true }
  func setZone(_ value: String) { zone = value }
  func setUser(_ value: String) { user = value }
  func failIssue(_ key: String) { failedIssues.insert(key) }
  func restoreIssue(_ key: String) { failedIssues.remove(key) }
  func setSlowSearch(_ value: Bool) { delaySearch = value }
  func setSlowBoard(_ value: Bool) { delayBoard = value }
  func setTimeoutWrite(_ value: Bool) { timeoutWrite = value }
  func setFailWrite(_ value: Bool) { failWrite = value }
  func replaceLogs(_ value: [String: [JSONValue]]) { logs = value }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    guard request.url?.host == "time-fixture.invalid" else { throw JiraError.invalidOrigin }
    requests.append(request)
    let path = request.url!.path; let method = request.httpMethod ?? "GET"
    var status = 200; var result: JSONValue = .null
    let body = request.httpBody.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) } ?? .null
    if path.hasSuffix("/myself") { result = .object(["accountId": .string(user), "displayName": .string("Fixture User"), "timeZone": .string(zone)]) }
    else if path == "/rest/agile/1.0/board" { result = .object(["startAt": .number(0), "isLast": .bool(true), "values": .array([.object(["id": .number(101), "name": .string("Fixture board"), "type": .string("scrum")]), .object(["id": .number(202), "name": .string("Other board"), "type": .string("scrum")])])]) }
    else if path.hasSuffix("/configuration") { result = .object(["filter": .object(["id": .string(path.contains("/101/") ? "101" : "202")])]) }
    else if path.hasSuffix("/search/jql") {
      let jql = body["jql"].plainText
      if delaySearch || (delayBoard && jql.contains("filter = 101")) { try? await Task.sleep(for: .milliseconds(180)) }
      let keys = jql.contains("fast") ? [2] : jql.contains("slow") ? [3] : jql.contains("filter = 202") ? [5] : jql.contains("project = OTHER") ? [] : demoIssues ? Array(1...12) : [1,2,3,4]
      result = .object(["isLast": .bool(true), "issues": .array(keys.map(Self.issue))])
    } else if path == "/gateway/api/graphql" {
      if body["operationName"].plainText == "PowerViewTenantContext" { result = .object(["data": .object(["tenantContexts": .array([.object(["hostName": .string("time-fixture.invalid"), "cloudId": .string("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "orgId": .string("fixture-org")])])])]) }
      else { result = .object(["data": .object(["team": .object(["teamSearchV2": .object(["nodes": .array([Self.teamA, Self.teamB].enumerated().map { index, id in .object(["team": .object(["id": .string(id), "displayName": .string(index == 0 ? "Fixture Team" : "Other Team"), "organizationId": .string("fixture-org")])]) }), "pageInfo": .object(["hasNextPage": .bool(false)])])])])]) }
      if failTeams { status = 403 }
    } else if path.hasPrefix("/gateway/api/public/teams/") {
      if slowTeam { try? await Task.sleep(for: .milliseconds(180)) }
      let second = path.contains(Self.teamB)
      if path.hasSuffix("/members") { result = .object(["results": .array((second ? ["other"] : ["fixture", "other"]).map { .object(["accountId": .string($0)]) }), "pageInfo": .object(["hasNextPage": .bool(false)])]) }
      else { result = .object(["teamId": .string(second ? Self.teamB : Self.teamA), "organizationId": .string("fixture-org"), "displayName": .string(second ? "Other Team" : "Fixture Team")]) }
    } else if path == "/rest/api/3/user" {
      let account = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value ?? ""
      result = .object(["accountId": .string(account), "displayName": .string(account == "fixture" ? "Fixture User" : "Other User")])
    } else if path.contains("/issue/") {
      let parts = path.components(separatedBy: "/"); guard let index = parts.firstIndex(of: "issue"), parts.count > index + 1 else { throw JiraError.invalidKey }
      let key = parts[index + 1]
      if parts.count == index + 2 { result = Self.issue(Int(key.split(separator: "-").last!)!) }
      else if method == "GET", parts.last == "worklog" {
        if failedIssues.contains(key) { status = 403 }
        let records = logs[key] ?? []
        result = .object(["startAt": .number(0), "total": .number(Double(records.count)), "worklogs": .array(records)])
      } else if method == "GET" {
        result = (logs[key] ?? []).first { $0["id"].plainText == parts.last! } ?? .null
        if result == .null { status = 404 }
      } else {
        mutations.append(request)
        if failWrite { status = 403 }
        else if method == "DELETE" { logs[key]?.removeAll { $0["id"].plainText == parts.last! }; status = 204 }
        else {
          serial += 1
          let id = method == "POST" ? String(serial) : parts.last!
          var updated = ((logs[key] ?? []).first { $0["id"].plainText == id } ?? Self.log(id: id, issue: String(key.split(separator: "-").last!), day: "2026-11-03", author: user)).object
          updated.merge(body.object) { _, new in new }; updated["updated"] = .string("2026-11-05T00:00:\(String(format: "%02d", serial % 60))Z")
          logs[key, default: []].removeAll { $0["id"].plainText == id }; logs[key, default: []].append(.object(updated)); result = .object(updated)
        }
        if timeoutWrite { throw URLError(.timedOut) }
      }
    } else { throw JiraError.unexpectedResponse }
    return (try JSONEncoder().encode(result), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}

actor NativeCalendarFixtureTransport: JiraTransport {
  var files: [String: (JSONValue, String)] = [:]
  var writes = 0
  var unavailable = false
  var timeoutAfterWrite = false
  func setUnavailable(_ value: Bool) { unavailable = value }
  func setTimeoutAfterWrite(_ value: Bool) { timeoutAfterWrite = value }
  func makeStore() throws -> GitHubTimeCalendar { try GitHubTimeCalendar(configuration: .init(owner: "fixture", repo: "calendar", branch: "main", root: "shared", token: "fixture-only"), transport: self) }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    guard request.url?.host == "api.github.com" else { throw JiraError.invalidOrigin }
    let path = request.url!.path; var status = unavailable ? 403 : 200; var result: JSONValue = .null
    if !unavailable {
      if path.contains("/branches/") { result = .object(["name": .string("main"), "commit": .object(["sha": .string("fixture-commit")])]) }
      else if request.httpMethod == "PUT" {
        writes += 1; let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
        if body["sha"].string != files[path]?.1 { status = 409 }
        else {
          let value = try JSONDecoder().decode(JSONValue.self, from: Data(base64Encoded: body["content"].plainText)!)
          files[path] = (value, "sha-\(writes)"); result = .object(["content": .object(["sha": .string("sha-\(writes)")])])
          if timeoutAfterWrite { unavailable = true; throw URLError(.timedOut) }
        }
      } else if let (value, sha) = files[path] { result = .object(["type": .string("file"), "encoding": .string("base64"), "sha": .string(sha), "content": .string(try JSONEncoder().encode(value).base64EncodedString())]) }
      else { status = 404 }
    }
    return (try JSONEncoder().encode(result), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}
