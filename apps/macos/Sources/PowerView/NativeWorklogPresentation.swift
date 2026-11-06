import Combine
import Foundation
import PowerViewCore

struct TimeEditorRequest: Identifiable, Sendable {
  let id = UUID()
  var issue: TimeIssue?
  var day: String
  var original: TimeWorklog?
  var cellID: String? { issue.map { $0.id + ":" + day } }
}

/// The table owns the return target while its detail and edit sheets replace each other.
@MainActor final class NativeWorklogPresentation: ObservableObject {
  @Published var details: TimeEditorRequest?
  @Published var editor: TimeEditorRequest?
  private var pendingEditor: TimeEditorRequest?
  private(set) var returnCellID: String?

  func openDetails(issue: TimeIssue, day: String) {
    let request = TimeEditorRequest(issue: issue, day: day)
    returnCellID = request.cellID; details = request
  }
  func edit(_ log: TimeWorklog) {
    guard let current = details, current.issue?.id == log.issueID else { return }
    pendingEditor = TimeEditorRequest(issue: current.issue, day: current.day, original: log)
    details = nil
  }
  func addAnother() {
    guard let current = details else { return }
    pendingEditor = TimeEditorRequest(issue: current.issue, day: current.day)
    details = nil
  }
  func detailsDismissed() -> String? {
    if let next = pendingEditor { pendingEditor = nil; editor = next; return nil }
    return returnCellID
  }
  func closeEditor() { editor = nil }
  func deleted() { details = nil; pendingEditor = nil }
  func editorDismissed() -> String? { return returnCellID }
}
