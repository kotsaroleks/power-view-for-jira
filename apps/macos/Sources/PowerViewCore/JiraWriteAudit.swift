import Foundation

public struct JiraWriteAuditStore: Sendable {
  public let directory: URL
  public init(directory: URL) { self.directory = directory }
  public struct Entry: Codable, Sendable, Identifiable {
    public let id: UUID
    public let proposal: JiraWriteProposal
    public let startedAt: Date
    public var results: [JiraWriteResult]
    public var finished: Bool
  }
  func begin(_ proposal: JiraWriteProposal) throws -> Entry {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let entry = Entry(
      id: proposal.id, proposal: proposal, startedAt: Date(), results: [], finished: false)
    try ImmutableFile.publish(JSONEncoder().encode(entry), to: file(proposal.id))
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o600], ofItemAtPath: file(proposal.id).path)
    return entry
  }
  func update(_ entry: Entry) throws {
    try JSONEncoder().encode(entry).write(to: file(entry.id), options: [.atomic])
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o600], ofItemAtPath: file(entry.id).path)
  }
  public func list() throws -> [Entry] {
    guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
    return try FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: nil
    )
    .filter { $0.pathExtension == "json" }
    .map { try JSONDecoder().decode(Entry.self, from: Data(contentsOf: $0)) }
    .sorted { $0.startedAt > $1.startedAt }
  }
  private func file(_ id: UUID) -> URL { directory.appendingPathComponent(id.uuidString + ".json") }
}
