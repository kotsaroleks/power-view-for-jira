import Combine
import Foundation
import PowerViewCore

@MainActor final class NativeWorklogDraft: ObservableObject {
  @Published var issue: TimeIssue?
  @Published var day: String
  @Published var clock: String
  @Published var duration: String
  @Published var comment: String
  @Published var selectedInstant: String
  let zone: String
  let original: TimeWorklog?
  private var initial: [String] = []
  var instants: [String] { TimeCalendar.localChoices(day: day, clock: clock, zone: zone) }
  var values: [String] { [issue?.id ?? "", day, clock, duration, comment, selectedInstant] }
  var dirty: Bool { values != initial }
  init(request: TimeEditorRequest, zone: String) {
    self.zone = zone; original = request.original; issue = request.issue
    let instant = request.original.flatMap { TimeCalendar.instant($0.started) }
    day = instant.map { TimeCalendar.text($0, zone: zone) } ?? request.day
    clock = instant.map { TimeCalendar.text($0, zone: zone, pattern: "HH:mm") } ?? "09:00"
    duration = request.original.map { TimeCalendar.duration($0.seconds) } ?? ""
    comment = request.original?.commentText ?? ""; selectedInstant = ""
    selectedInstant = instant.flatMap { date in instants.first { abs(TimeCalendar.instant($0)!.timeIntervalSince(date)) < 60 } } ?? (instants.count == 1 ? instants[0] : "")
    initial = values
  }
  struct Submission {
    let issue: TimeIssue; let started: String; let seconds: Int; let comment: String?
  }
  func submission() throws -> Submission {
    guard let issue else { throw TimeTrackingError.invalid("Choose a Jira issue.") }
    let seconds = original.flatMap { duration == TimeCalendar.duration($0.seconds) ? $0.seconds : nil } ?? TimeCalendar.parseDuration(duration)
    guard let seconds else { throw TimeTrackingError.invalid("Use 1h 30m, 90m or 1:30. Bare numbers and day/week units are not accepted.") }
    guard !instants.isEmpty else { throw TimeTrackingError.invalid("This date/time is invalid or skipped by daylight saving time.") }
    let originalInstant = original.flatMap { TimeCalendar.instant($0.started) }
    let sameClock = originalInstant.map { TimeCalendar.text($0, zone: zone) == day && TimeCalendar.text($0, zone: zone, pattern: "HH:mm") == clock } == true
    let sameOffset = instants.count < 2 || originalInstant.map { abs(TimeCalendar.instant(selectedInstant)?.timeIntervalSince($0) ?? .infinity) < 60 } == true
    let started = sameClock && sameOffset ? original!.started : instants.count == 1 ? instants[0] : selectedInstant
    guard (sameClock && sameOffset) || instants.contains(started) else { throw TimeTrackingError.invalid("Choose which daylight-saving instant you mean.") }
    return Submission(issue: issue, started: started, seconds: seconds, comment: original?.commentText == comment ? nil : (comment.isEmpty && original == nil ? nil : comment))
  }
}

@MainActor final class NativeTimeIssueSearch: ObservableObject {
  @Published private(set) var results: [TimeIssue] = []
  @Published private(set) var busy = false
  @Published private(set) var error = ""
  private var generation = UUID()
  private var job: Task<Void, Never>?
  func cancel() { generation = UUID(); job?.cancel(); job = nil; busy = false; results = []; error = "" }
  func search(_ input: String, client: JiraClient, debounce: Bool = true, validate: @escaping @MainActor () throws -> Void) async {
    cancel(); let query = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard query.count >= 2 else { return }
    let id = UUID(); generation = id; busy = true
    let task = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { if generation == id { busy = false; job = nil } }
      do {
        if debounce { try await Task.sleep(for: .milliseconds(300)) }
        try Task.checkCancellation(); try validate()
        let matches: [TimeIssue]
        let key = query.uppercased()
        if key.range(of: "^[A-Z][A-Z0-9_]*-\\d+$", options: .regularExpression) != nil { matches = [try await client.timeIssue(key)] }
        else {
          let escaped = query.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
          matches = try await client.timeSearch("summary ~ \"" + escaped + "\" ORDER BY updated DESC")
        }
        try Task.checkCancellation(); try validate(); guard generation == id else { return }
        results = matches; if matches.isEmpty { error = "No matching issues were found." }
      } catch { if !Task.isCancelled, generation == id { self.error = error.localizedDescription } }
    }
    job = task
    await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
  }
}
