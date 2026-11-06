import Foundation
import Testing

@testable import PowerViewCore

private func comment(_ id: String, updated: String) throws -> JiraComment {
  let value: JSONValue = .object([
    "id": .string(id), "body": .object(["type": .string("doc"), "content": .array([])]),
    "author": .object(["accountId": .string("author"), "displayName": .string("Author")]),
    "created": .string("2026-10-16T12:00:00Z"), "updated": .string(updated),
  ])
  return try JSONDecoder().decode(JiraComment.self, from: JSONEncoder().encode(value))
}
@Test func commentReadMarkersSurviveRestartAndSeparateAccountsAndJiraInstances() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let origin = URL(string: "https://jira.example.test")!
  let original = try comment("1", updated: "2026-10-16T12:00:00Z")
  let store = try CommentReadStore(directory: directory, accountID: "tl", origin: origin)
  #expect(try store.load(issueKey: "APP-1") == nil)
  _ = try store.markRead([original], issueKey: "APP-1")
  let reopened = try CommentReadStore(directory: directory, accountID: "tl", origin: origin)
  let loaded = try reopened.load(issueKey: "APP-1")
  let checkpoint = try #require(loaded)
  #expect(CommentReadStore.unreadIDs([original], since: checkpoint).isEmpty)
  let edited = try comment("1", updated: "2026-10-16T13:00:00Z")
  let reply = try comment("2", updated: "2026-10-16T13:00:00Z")
  #expect(CommentReadStore.unreadIDs([edited, reply], since: checkpoint) == ["1", "2"])
  #expect(
    try CommentReadStore(directory: directory, accountID: "qa", origin: origin).load(
      issueKey: "APP-1") == nil)
  #expect(
    try CommentReadStore(
      directory: directory, accountID: "tl", origin: URL(string: "https://other.example.test")!
    ).load(issueKey: "APP-1") == nil)
}
