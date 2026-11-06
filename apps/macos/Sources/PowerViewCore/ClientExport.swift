import CryptoKit
import Foundation

public struct ClientEstimate: Codable, Equatable, Sendable {
  public let issueKey: String
  public let personDays: Double
}
public struct ClientExport: Codable, Equatable, Identifiable, Sendable {
  public let id: UUID
  public let createdAt: Date
  public let authorID: String
  public let sourceRevision: Int
  public let estimates: [ClientEstimate]
  public let xlsxData: Data
  public let sha256: String
  public init(release: Release, xlsxData: Data, authorID: String, date: Date = Date()) {
    self.id = UUID()
    self.createdAt = date
    self.authorID = authorID
    self.sourceRevision = release.revision
    self.estimates = release.stories.map { .init(issueKey: $0.id, personDays: $0.clientDays) }
    self.xlsxData = xlsxData
    self.sha256 = SHA256.hash(data: xlsxData).map { String(format: "%02x", $0) }.joined()
  }
  public var isIntact: Bool {
    sha256 == SHA256.hash(data: xlsxData).map { String(format: "%02x", $0) }.joined()
  }
}
