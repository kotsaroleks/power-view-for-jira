import CryptoKit
import Foundation

public struct ReportWorkspace: Codable, Equatable, Sendable {
  public let boardID: String
  public let jql: String
  public let completedStatusIDs: Set<String>
  public init(boardID: String, jql: String, completedStatusIDs: Set<String>) {
    self.boardID = boardID
    self.jql = jql
    self.completedStatusIDs = completedStatusIDs
  }
}
public struct ReportWorkspaceStore {
  private let file: URL
  public init(directory: URL, origin: URL, projectKey: String) throws {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let identity =
      origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "|"
      + projectKey
    let key = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    file = directory.appendingPathComponent(key + ".json")
  }
  public func load() throws -> ReportWorkspace? {
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    return try JSONDecoder().decode(ReportWorkspace.self, from: Data(contentsOf: file))
  }
  public func save(_ setup: ReportWorkspace) throws {
    guard setup.boardID.range(of: "^[0-9]+$", options: .regularExpression) != nil,
      !setup.completedStatusIDs.isEmpty
    else { throw JiraError.unexpectedResponse }
    try JSONEncoder().encode(setup).write(to: file, options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
  }
}
public struct JiraBoardChoice: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let type: String
}
public struct JiraSprintChoice: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let state: String
}
extension JiraClient {
  public func reportBoards(projectKey: String) async throws -> [JiraBoardChoice] {
    guard projectKey.range(of: "^[A-Z][A-Z0-9_]*$", options: .regularExpression) != nil else {
      throw JiraError.invalidKey
    }
    return try await choicePages(
      path: "/rest/agile/1.0/board", query: [.init(name: "projectKeyOrId", value: projectKey)]
    ).map { value in
      guard let id = value["id"].identifier, let name = value["name"].string,
        let type = value["type"].string
      else { throw JiraError.unexpectedResponse }
      return .init(id: id, name: name, type: type)
    }
  }
  public func reportSprints(boardID: String) async throws -> [JiraSprintChoice] {
    guard boardID.range(of: "^[0-9]+$", options: .regularExpression) != nil else {
      throw JiraError.invalidKey
    }
    return try await choicePages(path: "/rest/agile/1.0/board/" + boardID + "/sprint", query: [])
      .map { value in
        guard let id = value["id"].identifier, let name = value["name"].string,
          let state = value["state"].string
        else { throw JiraError.unexpectedResponse }
        return .init(id: id, name: name, state: state)
      }
  }
  private func choicePages(path: String, query: [URLQueryItem]) async throws -> [JSONValue] {
    var cursor = 0
    var results: [JSONValue] = []
    var seen: Set<String> = []
    for _ in 0..<1000 {
      try Task.checkCancellation()
      let page: JSONValue = try await get(
        path,
        query: query + [
          .init(name: "startAt", value: String(cursor)), .init(name: "maxResults", value: "100"),
        ])
      guard page["startAt"].number == Double(cursor), case .array(let values) = page["values"]
      else { throw JiraError.unexpectedResponse }
      for value in values {
        guard let id = value["id"].identifier else { throw JiraError.unexpectedResponse }
        if seen.insert(id).inserted { results.append(value) }
      }
      cursor += values.count
      if page["isLast"].boolean || page["total"].number.map({ Double(cursor) >= $0 }) == true {
        return results
      }
      guard !values.isEmpty else { throw JiraError.paginationIncomplete }
    }
    throw JiraError.paginationIncomplete
  }
}
