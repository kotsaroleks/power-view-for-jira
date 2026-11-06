import Foundation
import Testing

@testable import PowerViewCore

private func issueJSON(key: String = "APP-1", updated: String = "1") -> String {
  """
  {"id":"1","key":"\(key)","fields":{"summary":"Story","updated":"\(updated)","project":{"id":"100","key":"APP"},"description":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Keep original"}]}]},"subtasks":[],"timetracking":{"originalEstimateSeconds":28800}}}
  """
}
private actor WriteTransport: JiraTransport {
  var writes = 0
  var stale = false
  let failure: Int?
  let failAfterWrites: Int?
  init(failure: Int? = nil, stale: Bool = false, failAfterWrites: Int? = nil) {
    self.failAfterWrites = failAfterWrites
    self.failure = failure
    self.stale = stale
  }
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let json: String
    let status: Int
    if request.httpMethod == "GET" {
      status = 200
      if request.url!.path.hasSuffix("myself") {
        json = #"{"accountId":"tl","displayName":"TL"}"#
      } else {
        json = issueJSON(key: request.url!.lastPathComponent, updated: stale ? "2" : "1")
      }
    } else {
      writes += 1
      if failure == -1 { throw URLError(.timedOut) }
      status = failAfterWrites.map { writes > $0 ? 403 : 201 } ?? failure ?? 201
      json = #"{"key":"APP-99","id":"99"}"#
    }
    return (
      Data(json.utf8),
      HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
}
private func writeFixture(transport: WriteTransport) throws -> (
  JiraClient, JiraWriteProposal, JiraUser
) {
  let connection = try JiraConnection(
    origin: "https://jira.example.test", email: "fixture@example.test", token: "fixture-only")
  let issue = try JSONDecoder().decode(JiraIssue.self, from: Data(issueJSON().utf8))
  let user = try JSONDecoder().decode(
    JiraUser.self, from: Data(#"{"accountId":"tl","displayName":"TL"}"#.utf8))
  let proposal = try JiraWriteProposal.comment(
    origin: connection.origin, authorID: "tl", role: .techLead, issue: issue,
    text: "Exact approved question")
  return (JiraClient(connection: connection, transport: transport), proposal, user)
}
@Test func approvalDoesNotWriteAndExecutionCannotBeRepeated() async throws {
  let transport = WriteTransport()
  let executor = JiraWriteExecutor()
  let (client, proposal, user) = try writeFixture(transport: transport)
  #expect(await transport.writes == 0)
  let approval = try proposal.approve(by: user)
  #expect(await transport.writes == 0)
  let result = try await executor.execute(approval, client: client)
  #expect(result.first?.outcome == .succeeded)
  #expect(await transport.writes == 1)
  await #expect(throws: JiraWriteError.alreadyAttempted) {
    try await executor.execute(approval, client: client)
  }
  #expect(await transport.writes == 1)
}
@Test func stalePreviewDoesNotSendMutations() async throws {
  let transport = WriteTransport(stale: true)
  let (client, proposal, user) = try writeFixture(transport: transport)
  await #expect(throws: JiraWriteError.stalePreview("APP-1")) {
    try await JiraWriteExecutor().execute(proposal.approve(by: user), client: client)
  }
  #expect(await transport.writes == 0)
}
@Test func uncertainWriteIsNeverAutomaticallyRetried() async throws {
  let transport = WriteTransport(failure: -1)
  let executor = JiraWriteExecutor()
  let (client, proposal, user) = try writeFixture(transport: transport)
  let approval = try proposal.approve(by: user)
  let result = try await executor.execute(approval, client: client)
  #expect(result.first?.outcome == .uncertain)
  #expect(await transport.writes == 1)
  await #expect(throws: JiraWriteError.alreadyAttempted) {
    try await executor.execute(approval, client: client)
  }
}
@Test func descriptionPreviewPreservesOriginalContentAndRole() throws {
  let connection = try JiraConnection(
    origin: "https://jira.example.test", email: "fixture@example.test", token: "fixture-only")
  let issue = try JSONDecoder().decode(JiraIssue.self, from: Data(issueJSON().utf8))
  let proposal = try JiraWriteProposal.description(
    origin: connection.origin, authorID: "c", role: .coordinator, issue: issue, ac: "AC text",
    dod: "DoD text")
  #expect(proposal.operations.first?.exactJSON.contains("Keep original") == true)
  #expect(proposal.operations.first?.exactJSON.contains("AC text") == true)
  #expect(throws: JiraWriteError.forbidden) {
    try JiraWriteProposal.description(
      origin: connection.origin, authorID: "tl", role: .techLead, issue: issue, ac: "AC", dod: "DoD"
    )
  }
}

@Test func auditFailurePreventsAnyJiraMutation() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try Data("not a directory".utf8).write(to: root)
  defer { try? FileManager.default.removeItem(at: root) }
  let transport = WriteTransport()
  let (client, proposal, user) = try writeFixture(transport: transport)
  let executor = JiraWriteExecutor(auditDirectory: root.appendingPathComponent("audit"))
  await #expect(throws: (any Error).self) {
    try await executor.execute(proposal.approve(by: user), client: client)
  }
  #expect(await transport.writes == 0)
}
@Test func partialFixVersionWriteShowsEveryOutcomeAndKeepsAudit() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: root) }
  var release = try readyRelease()
  for key in ["APP-4", "APP-5"] {
    var story = release.stories[0]
    story.id = key
    try release.add(story, actorID: "c")
  }
  try release.setMember(.init(id: "tl", name: "Coordinator", role: .coordinator), actorID: "c")
  try recordFixtureClientExport(&release, actorID: "tl")
  try release.approveCustomer(actorID: "tl")
  let version = try JSONDecoder().decode(
    JiraVersion.self,
    from: Data(#"{"id":"7","name":"Existing version","archived":false,"released":false}"#.utf8))
  let issues = try release.stories.map {
    try JSONDecoder().decode(JiraIssue.self, from: Data(issueJSON(key: $0.id).utf8))
  }
  let transport = WriteTransport(failAfterWrites: 1)
  let (client, _, user) = try writeFixture(transport: transport)
  let proposal = try JiraWriteProposal.fixVersion(
    origin: client.connection.origin, authorID: "tl", release: release, version: version,
    available: [version], issues: issues)
  let results = try await JiraWriteExecutor(auditDirectory: root).execute(
    proposal.approve(by: user), client: client)
  #expect(results.map(\.outcome) == [.succeeded, .failed, .notAttempted])
  #expect(await transport.writes == 2)
  let audit = try JiraWriteAuditStore(directory: root).list()
  #expect(audit.count == 1)
  #expect(audit[0].finished && audit[0].results.count == 3)
}

@Test func jiraEstimatesDoNotSilentlyRoundClientValues() throws {
  let connection = try JiraConnection(
    origin: "https://jira.example.test", email: "fixture@example.test", token: "fixture-only")
  let issue = try JSONDecoder().decode(JiraIssue.self, from: Data(issueJSON().utf8))
  #expect(throws: JiraWriteError.estimatePrecision) {
    try JiraWriteProposal.estimate(
      origin: connection.origin, authorID: "tl", role: .techLead, issue: issue, days: 0.003)
  }
}
