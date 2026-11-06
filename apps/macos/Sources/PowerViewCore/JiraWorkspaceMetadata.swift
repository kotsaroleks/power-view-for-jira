import Foundation

extension JiraClient {
  public func workspaceProjects(query: String = "", startAt: Int = 0) async throws -> JSONValue {
    if connection.deployment == .dataCenter {
      let raw: JSONValue = try await get("/rest/api/2/project")
      guard case .array = raw else { throw JiraError.unexpectedResponse }
      let filtered = raw.array.filter {
        query.isEmpty
          || (($0["key"].string ?? "") + " " + ($0["name"].string ?? ""))
            .localizedCaseInsensitiveContains(query)
      }.sorted {
        ($0["name"].string ?? "").localizedStandardCompare($1["name"].string ?? "")
          == .orderedAscending
      }
      let start = min(filtered.count, max(0, startAt))
      let end = min(filtered.count, max(0, startAt) + 50)
      return .object([
        "values": .array(Array(filtered[start..<end])), "total": .number(Double(filtered.count)),
        "startAt": .number(Double(start)), "isLast": .bool(end >= filtered.count),
      ])
    }
    return try await get(
      "/rest/api/3/project/search",
      query: [
        .init(name: "query", value: query), .init(name: "startAt", value: String(startAt)),
        .init(name: "maxResults", value: "50"),
      ])
  }
  public func workspaceFields() async throws -> [JSONValue] { try await get("/rest/api/3/field") }
}
