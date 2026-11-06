import Foundation

public struct ReportHistoryStore {
  public let directory: URL
  public init(directory: URL) throws {
    self.directory = directory
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  }
  public func save(_ snapshot: JSONValue) throws {
    guard let id = snapshot["id"].string, UUID(uuidString: id) != nil else {
      throw JiraError.unexpectedResponse
    }
    let url = directory.appendingPathComponent(id + ".json")
    let data = try JSONEncoder().encode(snapshot)
    // Exclusive creation: a saved snapshot is immutable, even across processes.
    try ImmutableFile.publish(data, to: url)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }
  public func list() throws -> [JSONValue] {
    try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "json" }
      .map { try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: $0)) }
      .sorted { ($0["generatedAt"].string ?? "") > ($1["generatedAt"].string ?? "") }
  }
  public func delete(id: String) throws {
    guard UUID(uuidString: id) != nil else { throw JiraError.unexpectedResponse }
    let deleted = directory.appendingPathComponent("Deleted", isDirectory: true)
    try FileManager.default.createDirectory(at: deleted, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    try FileManager.default.moveItem(at: directory.appendingPathComponent(id + ".json"),
      to: deleted.appendingPathComponent(id + ".json"))
  }
  public func restore(id: String) throws {
    guard UUID(uuidString: id) != nil else { throw JiraError.unexpectedResponse }
    try FileManager.default.moveItem(
      at: directory.appendingPathComponent("Deleted", isDirectory: true).appendingPathComponent(id + ".json"),
      to: directory.appendingPathComponent(id + ".json"))
  }
}
