import Foundation

/// Serializes atomic workspace writes; an older queued revision cannot replace newer data.
public actor WorkspacePersistence {
  private var revisions: [URL: Int] = [:]
  public init() {}
  public func save(_ state: ProductWorkspace, to url: URL, revision: Int) throws {
    if let latest = revisions[url], revision < latest { return }
    let data = try JSONEncoder().encode(state)
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    try data.write(to: url, options: [.atomic])
    revisions[url] = revision
  }
}
