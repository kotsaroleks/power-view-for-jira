import Foundation

/// Publishes a complete local file exactly once; a crash never leaves a partially written destination.
enum ImmutableFile {
  static func publish(_ data: Data, to destination: URL) throws {
    let staged = destination.deletingLastPathComponent().appendingPathComponent(
      UUID().uuidString + ".staged")
    defer { try? FileManager.default.removeItem(at: staged) }
    try data.write(to: staged, options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: staged.path)
    // Hard-link publication is atomic on the local filesystem and fails if the destination exists.
    try FileManager.default.linkItem(at: staged, to: destination)
  }
}
