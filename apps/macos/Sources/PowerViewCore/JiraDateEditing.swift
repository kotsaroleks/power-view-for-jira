import Foundation

public struct JiraDateEditContext: Sendable {
  public let issue: JiraIssue
  public let startField: String
  public let dueField: String
  public let start: JSONValue
  public let due: JSONValue
}
extension JiraClient {
  public func dateEditContext(key: String, startField: String, dueField: String) async throws
    -> JiraDateEditContext
  {
    try validate(key)
    guard startField != dueField,
      [startField, dueField].allSatisfy({
        $0.range(of: "^(customfield_[0-9]+|duedate|startdate)$", options: .regularExpression) != nil
      })
    else { throw JiraWriteError.invalidContent }
    let raw: JSONValue = try await get(
      "/rest/api/3/issue/" + key,
      query: [
        .init(name: "fields", value: "summary,updated,project,\(startField),\(dueField)")
      ])
    let issue = try JSONDecoder().decode(JiraIssue.self, from: JSONEncoder().encode(raw))
    guard issue.key == key else { throw JiraError.unexpectedResponse }
    let metadata: JSONValue = try await get("/rest/api/3/issue/" + key + "/editmeta")
    for field in [startField, dueField] {
      guard metadata["fields"][field]["schema"]["type"].string == "date",
        metadata["fields"][field]["operations"].array.contains(.string("set"))
      else { throw JiraWriteError.forbidden }
    }
    return .init(
      issue: issue, startField: startField, dueField: dueField,
      start: raw["fields"][startField], due: raw["fields"][dueField])
  }
}
