import Foundation

public struct WorkspaceRestoration: Sendable {
  public let state: ProductWorkspace
  public let source: URL
  public let usedFallback: Bool
}
public enum WorkspaceRecovery {
  public static func restore(preferred: URL?, recovery: URL) -> WorkspaceRestoration? {
    for url in [preferred, recovery].compactMap({ $0 }) {
      let access = url.startAccessingSecurityScopedResource()
      defer { if access { url.stopAccessingSecurityScopedResource() } }
      if let data = try? Data(contentsOf: url),
        let state = try? JSONDecoder().decode(ProductWorkspace.self, from: data)
      {
        return .init(state: state, source: url, usedFallback: preferred != nil && url != preferred)
      }
    }
    return nil
  }
}
