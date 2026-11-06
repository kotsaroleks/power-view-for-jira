import Foundation
import Testing

@testable import PowerViewCore

@Test func hierarchySortVisibilityAndSearchMatchActualChromeFunctions() throws {
  let url = Bundle.module.url(
    forResource: "hierarchy-golden", withExtension: "json", subdirectory: "Fixtures")!
  let cases = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)).array
  let sorts: [String: TimelineSort] = [
    "default": .rank, "startDate": .start, "endDate": .due, "name": .name, "status": .status,
    "assignee": .assignee, "issueKey": .key,
  ]
  for item in cases {
    let input = item["input"]
    let issues = try input["tasks"].array.map { task in
      var fields: [String: JSONValue] = [
        "summary": task["name"],
        "status": .object([
          "name": task["statusName"], "statusCategory": .object(["key": task["statusCategory"]]),
        ]), "customfield_10015": task["start"], "duedate": task["end"],
      ]
      if let parent = task["parentId"].string {
        fields["parent"] = .object(["key": .string(parent)])
      }
      if let user = task["assigneeName"].string {
        fields["assignee"] = .object(["displayName": .string(user)])
      }
      return try WorkspaceIssue(raw: .object(["key": task["issueKey"], "fields": .object(fields)]))
    }
    let rows = TimelineHierarchy.rows(
      issues: issues, plans: [:], collapsed: Set(input["collapsed"].array.compactMap(\.string)),
      query: input["query"].plainText, hideDone: input["hideDone"].boolean,
      sort: sorts[input["sortBy"].plainText]!, ascending: input["direction"].string == "asc")
    #expect(
      rows.map(\.id) == item["expected"].array.map { $0["id"].plainText },
      "\(input["sortBy"].plainText) \(input["direction"].plainText) \(input["query"].plainText)")
    #expect(rows.map(\.depth) == item["expected"].array.map { Int($0["depth"].number!) })
  }
}
