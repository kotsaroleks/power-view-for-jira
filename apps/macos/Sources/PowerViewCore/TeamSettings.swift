import CryptoKit
import Foundation

public struct TeamSettings: Codable, Equatable, Sendable {
  public let name: String
  public let members: [TeamMember]
  public init(name: String, members: [TeamMember]) {
    self.name = name
    self.members = members
  }
}
public struct TeamSettingsStore: Sendable {
  private let file: URL
  public init(directory: URL, namespace: String, team: String) throws {
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let identity =
      namespace + "|" + team.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let digest = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    file = directory.appendingPathComponent(digest + ".json")
  }
  public func load() throws -> TeamSettings? {
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    let value = try JSONDecoder().decode(TeamSettings.self, from: Data(contentsOf: file))
    try validate(value)
    return value
  }
  public func save(_ value: TeamSettings) throws {
    try validate(value)
    try JSONEncoder().encode(value).write(to: file, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
  }
  private func validate(_ value: TeamSettings) throws {
    guard !value.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      value.members.allSatisfy({ !$0.id.isEmpty && !$0.name.isEmpty }),
      Set(value.members.map(\.id)).count == value.members.count
    else { throw ReleaseError.unknownMember }
  }
}
