import Foundation

public struct JiraTransitionChoice: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let to: Destination
  public let fields: [String: JSONValue]?
  public struct Destination: Codable, Equatable, Sendable { public let name: String }
  public var needsAdditionalFields: Bool {
    fields?.values.contains(where: { $0["required"].boolean }) == true
  }
}
public struct JiraMetadataEditContext: Sendable {
  public let issue: JiraIssue
  public let statusName: String
  public let assignee: JSONValue
  public let canAssign: Bool
  public let assigneeRequired: Bool
  public let transitions: [JiraTransitionChoice]
}
extension JiraClient {
  public func metadataEditContext(key: String) async throws -> JiraMetadataEditContext {
    try validate(key)
    let raw: JSONValue = try await get(
      "/rest/api/3/issue/" + key,
      query: [.init(name: "fields", value: "summary,updated,project,status,assignee")])
    let issue = try JSONDecoder().decode(JiraIssue.self, from: JSONEncoder().encode(raw))
    guard issue.key == key else { throw JiraError.unexpectedResponse }
    let transitionPage: JSONValue = try await get(
      "/rest/api/3/issue/" + key + "/transitions",
      query: [.init(name: "expand", value: "transitions.fields")])
    let choices = try JSONDecoder().decode(
      [JiraTransitionChoice].self, from: JSONEncoder().encode(transitionPage["transitions"]))
    let metadata: JSONValue = try await get("/rest/api/3/issue/" + key + "/editmeta")
    return .init(
      issue: issue, statusName: raw["fields"]["status"]["name"].string ?? "Невідомий статус",
      assignee: raw["fields"]["assignee"],
      canAssign: metadata["fields"]["assignee"]["operations"].array.contains(.string("set")),
      assigneeRequired: metadata["fields"]["assignee"]["required"].boolean, transitions: choices)
  }
  public func assignableUsers(key: String, query: String) async throws -> [JiraUser] {
    try validate(key)
    return try await get(
      "/rest/api/3/user/assignable/search",
      query: [
        .init(name: "issueKey", value: key), .init(name: "query", value: query),
        .init(name: "maxResults", value: "50"),
      ])
  }
}
