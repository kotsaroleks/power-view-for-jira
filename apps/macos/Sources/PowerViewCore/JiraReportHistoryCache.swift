import CryptoKit
import Foundation

/// Stores raw history so board mappings and report periods are applied afresh on every run.
public actor JiraReportHistoryCache {
  private struct Record: Codable {
    let updatedAt: String
    let entries: [JSONValue]
  }
  private let directory: URL
  private var pruned = false
  public init(directory: URL) { self.directory = directory }
  private func file(origin: String, userID: String, issueID: String, kind: String) -> URL {
    let identity = [
      origin.trimmingCharacters(in: CharacterSet(charactersIn: "/")), userID, issueID, kind,
    ].joined(separator: "|")
    let digest = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appendingPathComponent(digest + ".json")
  }
  public func get(
    origin: String, userID: String?, issueID: String, updatedAt: String?, kind: String
  ) -> [JSONValue]? {
    guard let userID, !userID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let updatedAt
    else { return nil }
    let url = file(origin: origin, userID: userID, issueID: issueID, kind: kind)
    guard let data = try? Data(contentsOf: url),
      let record = try? JSONDecoder().decode(Record.self, from: data), record.updatedAt == updatedAt
    else { return nil }
    return record.entries
  }
  public func put(
    _ entries: [JSONValue], origin: String, userID: String?, issueID: String, updatedAt: String?,
    kind: String
  ) throws {
    guard let userID, !userID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let updatedAt
    else { return }
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    if !pruned {
      let threshold = Date().addingTimeInterval(-30 * 86400)
      for url
        in (try? FileManager.default.contentsOfDirectory(
          at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
      where url.pathExtension == "json" {
        if let date = try? url.resourceValues(forKeys: [.contentModificationDateKey])
          .contentModificationDate, date < threshold
        {
          try? FileManager.default.removeItem(at: url)
        }
      }
      pruned = true
    }
    let url = file(origin: origin, userID: userID, issueID: issueID, kind: kind)
    try JSONEncoder().encode(Record(updatedAt: updatedAt, entries: entries)).write(
      to: url, options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }
}
