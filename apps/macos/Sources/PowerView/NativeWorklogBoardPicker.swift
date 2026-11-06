import Combine
import PowerViewCore
import SwiftUI

@MainActor final class NativeWorklogBoardPicker: ObservableObject {
  @Published private(set) var boards: [JiraBoardChoice] = []
  @Published var boardID = ""
  @Published var parentKey = ""
  @Published var search = ""
  @Published private(set) var issues: [TimeIssue] = []
  @Published private(set) var loading = false
  @Published private(set) var error = ""
  @Published private var favoriteBoards: [String: [String]] = [:]
  private let defaults: UserDefaults
  private var key = ""
  private weak var session: JiraSession?
  private var client: JiraClient?
  private var scope = ""
  private var ticket = UUID()
  private var job: Task<Void, Never>?
  init(defaults: UserDefaults = .standard) { self.defaults = defaults }
  var favorites: [String] { favoriteBoards[boardID] ?? [] }
  var parents: [TimeIssue] { issues.filter { $0.hierarchy == 1 || $0.typeName?.lowercased() == "story" } }
  struct Group: Identifiable { var label: String; var issues: [TimeIssue]; var id: String { label } }
  var groups: [Group] {
    let assigned = issues.filter { $0.assigneeID == session?.user?.accountId }
    let others = issues.filter { $0.assigneeID != session?.user?.accountId }
    var result = [Group(label: "Assigned to me", issues: assigned)]
    if let parent = parents.first(where: { $0.key == parentKey }) {
      let children = parent.hierarchy == 1 ? issues.filter { $0.parentKey == parentKey && $0.hierarchy >= 0 } : [parent]
      result += children.map { child in Group(label: "Other issues · " + child.key + " " + child.summary, issues: others.filter { $0.hierarchy < 0 && $0.parentKey == child.key }) }
    } else { result.append(Group(label: "Other issues", issues: others)) }
    return result.map { group in Group(label: group.label, issues: group.issues.filter { search.isEmpty || ($0.key + " " + $0.summary).localizedCaseInsensitiveContains(search) }) }
  }
  func configure(_ jira: JiraSession) async {
    session = jira; client = jira.client; scope = jira.timeScope
    key = "worklog.picker." + GitHubTimeCalendar.storageKey(scope)
    let prefs = defaults.dictionary(forKey: key) ?? [:]
    boardID = prefs["board"] as? String ?? ""; favoriteBoards = prefs["favorites"] as? [String: [String]] ?? [:]
    guard let client else { return }
    loading = true
    do { let result = try await client.timeBoards(); try requireSession(); boards = result }
    catch { loading = false; if !Task.isCancelled { self.error = error.localizedDescription }; return }
    loading = false; await loadBoard()
  }
  private func requireSession() throws {
    try Task.checkCancellation(); guard session?.timeScope == scope else { throw TimeTrackingError.identity }
  }
  func cancel() { ticket = UUID(); job?.cancel(); job = nil; loading = false }
  func loadBoard() async {
    cancel(); issues = []; parentKey = ""; search = ""; error = ""
    guard let client, !boardID.isEmpty else { return }
    guard boards.contains(where: { $0.id == boardID }) else { error = "The remembered board is unavailable. Select another board."; return }
    defaults.set(["board": boardID, "favorites": favoriteBoards] as [String: Any], forKey: key)
    let id = UUID(); ticket = id; let board = boardID; loading = true
    let task = Task { @MainActor [weak self] in
      guard let self else { return }; defer { if ticket == id { loading = false; job = nil } }
      do { let result = try await client.timeBoardIssues(board); try requireSession(); guard ticket == id, board == boardID else { return }; issues = result }
      catch { if !Task.isCancelled, ticket == id { self.error = error.localizedDescription } }
    }
    job = task
    await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
  }
  func toggleFavorite(_ parent: String) {
    var keys = favorites
    if keys.contains(parent) { keys.removeAll { $0 == parent } } else { keys.append(parent) }
    favoriteBoards[boardID] = keys
    defaults.set(["board": boardID, "favorites": favoriteBoards] as [String: Any], forKey: key)
  }
}

struct NativeWorklogBoardPickerView: View {
  @ObservedObject var picker: NativeWorklogBoardPicker
  let select: (TimeIssue) -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Picker("Board", selection: $picker.boardID) { Text("Select a board").tag(""); ForEach(picker.boards) { Text($0.name).tag($0.id) } }
      if picker.loading { ProgressView("Loading board choices…").controlSize(.small) }
      if !picker.error.isEmpty { HStack { Text(picker.error).foregroundStyle(.red); Button("Retry") { Task { await picker.loadBoard() } } } }
      if !picker.boardID.isEmpty && !picker.loading && picker.error.isEmpty {
        ScrollView(.horizontal) { HStack {
          ForEach(picker.favorites, id: \.self) { key in
            Button(key) { picker.parentKey = key }.disabled(!picker.parents.contains { $0.key == key })
            Button("★") { picker.toggleFavorite(key) }.help("Remove favorite " + key)
          }
        } }
        HStack {
          Picker("Epic or Story", selection: $picker.parentKey) { Text("All board issues").tag(""); ForEach(picker.parents) { Text($0.key + " · " + $0.summary).tag($0.key) } }
          if !picker.parentKey.isEmpty { Button(picker.favorites.contains(picker.parentKey) ? "★" : "☆") { picker.toggleFavorite(picker.parentKey) }.help("Favorite Epic or Story") }
        }
        TextField("Filter board issues", text: $picker.search)
        ScrollView { VStack(alignment: .leading, spacing: 8) {
          ForEach(picker.groups) { group in
            Text(group.label).font(.caption.bold()).foregroundStyle(PV.secondary)
            if group.issues.isEmpty { Text("No matching issues").font(.caption).foregroundStyle(PV.secondary) }
            ForEach(group.issues) { issue in Button(issue.key + " · " + issue.summary) { select(issue) }.buttonStyle(.plain).frame(maxWidth: .infinity, alignment: .leading) }
          }
        } }.frame(maxHeight: 160)
      }
    }.font(.caption)
      .task(id: picker.boardID) { await picker.loadBoard() }
  }
}
