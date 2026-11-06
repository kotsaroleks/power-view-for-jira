import Foundation
import PowerViewCore

struct NativeChromeTimeScene: Decodable, Sendable {
  let origin: String; let anchor: String; let user: JSONValue
  let issues: [JSONValue]; let searchIssues: [JSONValue]; let worklogs: [JSONValue]
  let boardID: String; let boardName: String; let pins: [String]; let priorities: [String]
  let expectedRows: [String]; let expectedSeconds: Int; let source: String
}
actor NativeChromeSceneTransport: JiraTransport {
  let scene: NativeChromeTimeScene
  private(set) var requests = 0
  private(set) var mutationMethods: [String] = []
  private var logs: [JSONValue]
  private var serial = 9000
  init(_ scene: NativeChromeTimeScene) { self.scene = scene; logs = scene.worklogs }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    guard request.url?.host == URL(string: scene.origin)?.host else { throw JiraError.invalidOrigin }
    let method = request.httpMethod ?? "GET", path = request.url!.path
    let mutation = path.contains("/worklog") && ["POST", "PUT", "DELETE"].contains(method)
    guard method == "GET" || (method == "POST" && path.hasSuffix("/search/jql")) || mutation else { throw JiraError.unexpectedResponse }
    requests += 1
    let value: JSONValue
    var status = 200
    if path.hasSuffix("/myself") { value = scene.user }
    else if path == "/rest/agile/1.0/board" { value = .object(["startAt": .number(0), "isLast": .bool(true), "values": .array([.object(["id": .string(scene.boardID), "name": .string(scene.boardName), "type": .string("scrum")])])]) }
    else if path.hasSuffix("/configuration") { value = .object(["filter": .object(["id": .string("42")])]) }
    else if path.hasSuffix("/search/jql") {
      let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
      value = .object(["isLast": .bool(true), "issues": .array(body["jql"].plainText.contains("filter = 42") ? scene.issues : scene.searchIssues)])
    } else if let index = path.components(separatedBy: "/").firstIndex(of: "issue") {
      let parts = path.components(separatedBy: "/")
      guard let issue = scene.issues.first(where: { $0["key"].plainText == parts[index + 1] }) else { throw JiraError.invalidKey }
      if mutation {
        guard URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.contains(.init(name: "adjustEstimate", value: "leave")) == true else { throw JiraError.unexpectedResponse }
        mutationMethods.append(method)
        if method == "DELETE" { logs.removeAll { $0["id"].plainText == parts.last! }; value = .null; status = 204 }
        else {
          let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
          let id = method == "POST" ? String(serial) : parts.last!; serial += 1
          var record = (logs.first { $0["id"].plainText == id } ?? .object(["id": .string(id), "issueId": issue["id"], "author": scene.user])).object
          record.merge(body.object) { _, new in new }; record["updated"] = .string(ReportPeriod.iso(Date()))
          logs.removeAll { $0["id"].plainText == id }; logs.append(.object(record)); value = .object(record)
        }
      } else if path.hasSuffix("/worklog") {
        let records = logs.filter { $0["issueId"].plainText == issue["id"].plainText }
        value = .object(["startAt": .number(0), "total": .number(Double(records.count)), "worklogs": .array(records)])
      } else if path.contains("/worklog/") {
        value = logs.first { $0["id"].plainText == parts.last! } ?? .null
        if value == .null { status = 404 }
      } else { value = issue }
    } else { throw JiraError.unexpectedResponse }
    return (try JSONEncoder().encode(value), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}
