import Foundation

/// Local-only crash recovery. Never place this directory in a shared Drive folder.
/// OS account is the privacy boundary; app multi-account encryption is still required.
public struct PrivateDraft: Codable, Equatable, Sendable {
  public let releaseID: UUID
  public let baseRevision: Int
  public let base: [String: String]
  public let edited: [String: String]
  public init(releaseID: UUID, baseRevision: Int, base: [String: String], edited: [String: String])
  {
    self.releaseID = releaseID
    self.baseRevision = baseRevision
    self.base = base
    self.edited = edited
  }
  public func differences(shared: [String: String]) -> [DraftDifference] {
    Set(base.keys).union(edited.keys).sorted().compactMap { key in
      guard base[key] != edited[key] else { return nil }
      return DraftDifference(
        field: key, original: base[key], draft: edited[key], shared: shared[key])
    }
  }
  /// Only explicitly selected fields are applied to the current shared snapshot.
  public func restoring(selectedFields: Set<String>, into shared: [String: String]) -> [String:
    String]
  {
    var result = shared
    for change in differences(shared: shared) where selectedFields.contains(change.field) {
      result[change.field] = change.draft
    }
    return result
  }
}
public struct DraftDifference: Equatable, Sendable {
  public let field: String
  public let original: String?
  public let draft: String?
  public let shared: String?
  public var conflict: Bool { shared != original && shared != draft }
}
public struct PrivateDraftStore {
  private let directory: URL
  public init(directory: URL) throws {
    self.directory = directory
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
  }
  public func save(_ draft: PrivateDraft) throws {
    let url = directory.appendingPathComponent(draft.releaseID.uuidString + ".json")
    try JSONEncoder().encode(draft).write(to: url, options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }
  public func load(releaseID: UUID) throws -> PrivateDraft {
    try JSONDecoder().decode(
      PrivateDraft.self,
      from: Data(contentsOf: directory.appendingPathComponent(releaseID.uuidString + ".json")))
  }
}
