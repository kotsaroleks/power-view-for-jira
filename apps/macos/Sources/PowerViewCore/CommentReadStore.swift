import CryptoKit
import Foundation

public struct CommentReadStore {
  private let directory: URL
  private let accountID: String
  private let origin: String
  public init(directory: URL, accountID: String, origin: URL) throws {
    guard !accountID.isEmpty else { throw JiraError.missingCredentials }
    self.directory = directory
    self.accountID = accountID
    self.origin = origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  }
  public func load(issueKey: String) throws -> [String: String]? {
    let url = file(issueKey)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    return try JSONDecoder().decode([String: String].self, from: Data(contentsOf: url))
  }
  public func markRead(_ comments: [JiraComment], issueKey: String) throws -> [String: String] {
    var checkpoint: [String: String] = [:]
    for comment in comments { checkpoint[comment.id] = comment.updated }
    let url = file(issueKey)
    try JSONEncoder().encode(checkpoint).write(to: url, options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    return checkpoint
  }
  public static func unreadIDs(_ comments: [JiraComment], since checkpoint: [String: String])
    -> Set<String>
  {
    Set(comments.filter { checkpoint[$0.id] != $0.updated }.map(\.id))
  }
  private func file(_ issueKey: String) -> URL {
    let identity = origin + "|" + accountID + "|" + issueKey
    let key = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appendingPathComponent(key + ".json")
  }
}
