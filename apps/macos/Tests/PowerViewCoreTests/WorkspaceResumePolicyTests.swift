import Testing

@testable import PowerViewCore

@Test func resumeNeverConnectsSavedBoardToAnotherJira() {
  #expect(
    WorkspaceResumePolicy.mayReconnect(
      savedOrigin: "https://COMPANY.atlassian.net/",
      workspaceOrigin: "https://company.atlassian.net"))
  #expect(
    !WorkspaceResumePolicy.mayReconnect(
      savedOrigin: "https://other.atlassian.net", workspaceOrigin: "https://company.atlassian.net"))
  #expect(
    !WorkspaceResumePolicy.mayReconnect(
      savedOrigin: "https://company.atlassian.net",
      workspaceOrigin: "https://company.atlassian.net/jira"))
  #expect(!WorkspaceResumePolicy.mayReconnect(savedOrigin: "", workspaceOrigin: nil))
}
@Test func resumeUsesOnlyWorkspacePages() {
  #expect(WorkspaceResumePolicy.page("Gantt") == "Gantt")
  #expect(WorkspaceResumePolicy.page("Settings") == "Workspace")
  #expect(WorkspaceResumePolicy.page(nil) == "Workspace")
}
