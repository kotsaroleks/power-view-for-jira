import CryptoKit
import Foundation
import Security

public struct StoryDraftEnvelope: Codable, Equatable, Sendable {
  public let releaseID: UUID
  public let storyKey: String
  public let authorID: String
  public let baseRevision: Int
  public let base: Story
  public let edited: Story
  public init(releaseID: UUID, authorID: String, baseRevision: Int, base: Story, edited: Story) {
    self.releaseID = releaseID
    self.storyKey = base.id
    self.authorID = authorID
    self.baseRevision = baseRevision
    self.base = base
    self.edited = edited
  }
  public func fieldDraft() throws -> PrivateDraft {
    func fields(_ story: Story) throws -> [String: String] {
      let values = try JSONDecoder().decode(
        [String: JSONValue].self, from: JSONEncoder().encode(story))
      return try values.mapValues { value in
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return String(decoding: try encoder.encode(value), as: UTF8.self)
      }
    }
    return try PrivateDraft(
      releaseID: releaseID, baseRevision: baseRevision, base: fields(base), edited: fields(edited))
  }
  public func differences(shared: Story) throws -> [DraftDifference] {
    let current = StoryDraftEnvelope(
      releaseID: releaseID, authorID: authorID, baseRevision: baseRevision, base: shared,
      edited: shared)
    return try fieldDraft().differences(shared: current.fieldDraft().base)
  }
  public func restoring(fields: Set<String>, into shared: Story) throws -> Story {
    let current = StoryDraftEnvelope(
      releaseID: releaseID, authorID: authorID, baseRevision: baseRevision, base: shared,
      edited: shared)
    let merged = try fieldDraft().restoring(selectedFields: fields, into: current.fieldDraft().base)
    let values = try merged.mapValues {
      try JSONDecoder().decode(JSONValue.self, from: Data($0.utf8))
    }
    return try JSONDecoder().decode(Story.self, from: JSONEncoder().encode(values))
  }
}
public struct StoryDraftVault: Sendable {
  private let root: URL
  private let key: SymmetricKey
  private let authorID: String
  /// Inject a key in tests; production retrieves an author-specific, non-synchronizing Keychain key.
  public init(directory: URL, authorID: String, keyData: Data? = nil) throws {
    self.authorID = authorID
    let identity = Self.hash(authorID)
    root = directory.appendingPathComponent(identity, isDirectory: true)
    try FileManager.default.createDirectory(
      at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
    key = SymmetricKey(data: try keyData ?? Self.keychainKey(identity))
  }
  public func save(_ draft: StoryDraftEnvelope) throws {
    guard draft.authorID == authorID else { throw ReleaseError.forbidden }
    let data = try JSONEncoder().encode(draft)
    guard let encrypted = try AES.GCM.seal(data, using: key).combined else {
      throw CocoaError(.fileWriteUnknown)
    }
    let url = file(draft.releaseID, draft.storyKey)
    try encrypted.write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }
  public func load(releaseID: UUID, storyKey: String) throws -> StoryDraftEnvelope? {
    let url = file(releaseID, storyKey)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let data = try AES.GCM.open(AES.GCM.SealedBox(combined: Data(contentsOf: url)), using: key)
    let draft = try JSONDecoder().decode(StoryDraftEnvelope.self, from: data)
    guard draft.authorID == authorID, draft.releaseID == releaseID, draft.storyKey == storyKey
    else { throw ReleaseError.forbidden }
    return draft
  }
  public func remove(releaseID: UUID, storyKey: String) throws {
    let url = file(releaseID, storyKey)
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }
  private func file(_ releaseID: UUID, _ storyKey: String) -> URL {
    root.appendingPathComponent(Self.hash(releaseID.uuidString + storyKey) + ".draft")
  }
  private static func hash(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  private static func keychainKey(_ identity: String) throws -> Data {
    let query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword, kSecAttrService: "com.powerview.private-draft",
      kSecAttrAccount: identity,
    ]
    var lookup = query
    lookup[kSecReturnData] = true
    lookup[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(lookup as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data { return data }
    guard status == errSecItemNotFound else { throw JiraError.keychain(status) }
    var bytes = Data(count: 32)
    let randomStatus = bytes.withUnsafeMutableBytes {
      SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!)
    }
    guard randomStatus == errSecSuccess else { throw JiraError.keychain(randomStatus) }
    var item = query
    item[kSecValueData] = bytes
    item[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let add = SecItemAdd(item as CFDictionary, nil)
    if add == errSecDuplicateItem { return try keychainKey(identity) }
    guard add == errSecSuccess else { throw JiraError.keychain(add) }
    return bytes
  }
}
