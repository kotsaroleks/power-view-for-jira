import CryptoKit
import Foundation

public enum HandoffFileError: Error, LocalizedError, Equatable {
  case changedElsewhere
  public var errorDescription: String? {
    "This handoff changed since you opened it. Save your work as a copy, then open the latest shared handoff."
  }
}
/// Coordinate with macOS file providers and reject changes visible in the local provider copy.
/// This is manual handoff storage, not a cross-device cloud lock.
public enum HandoffFileStore {
  public static func fingerprint(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
  public static func read(_ url: URL) throws -> Data {
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    var coordinationError: NSError?
    var result: Result<Data, Error>?
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) {
      target in
      result = Result { try Data(contentsOf: target) }
    }
    if let coordinationError { throw coordinationError }
    guard let result else { throw CocoaError(.fileReadUnknown) }
    return try result.get()
  }
  public static func save(_ data: Data, to url: URL, expected: String?) throws -> String {
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    let coordinator = NSFileCoordinator()
    var coordinationError: NSError?
    var writeError: Error?
    coordinator.coordinate(writingItemAt: url, options: [], error: &coordinationError) {
      target in
      do {
        let exists = FileManager.default.fileExists(atPath: target.path)
        let current = exists ? try fingerprint(Data(contentsOf: target)) : nil
        guard current == expected else { throw HandoffFileError.changedElsewhere }
        try data.write(to: target, options: .atomic)
      } catch { writeError = error }
    }
    if let coordinationError { throw coordinationError }
    if let writeError { throw writeError }
    return fingerprint(data)
  }
}
