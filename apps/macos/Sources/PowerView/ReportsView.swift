import AppKit
import CoreText
import PowerViewCore
import SwiftUI

struct NativeReportsView: View {
  @ObservedObject var jira: JiraSession
  let projectKey: String
  let members: [TeamMember]
  var importedSetup: JSONValue? = nil
  var workspaceIssues: [WorkspaceIssue] = []
  @Environment(\.dismiss) private var dismiss
  @State private var language = "uk"
  @State private var type = "daily"
  @State private var boardID = ""
  @State private var boards: [JiraBoardChoice] = []
  @State private var sprints: [JiraSprintChoice] = []
  @State private var savedBoardID = ""
  @State private var savedCompletedIDs: Set<String> = []
  @State private var configuredBoardID = ""
  @State private var sprintID = ""
  @State private var date = Date()
  @State private var jql = ""
  @State private var selectedUser = ""
  @State private var mode = "issue-count"
  @State private var statuses: [JSONValue] = []
  @State private var completedIDs: Set<String> = []
  @State private var snapshot: JSONValue?
  @State private var history: [JSONValue] = []
  @State private var generation: Task<Void, Never>?
  @State private var generationID = UUID()
  @State private var stage = ""
  @State private var lastProgress = Date.distantPast
  @State private var statusMessage = ""
  @State private var error = ""
  @State private var pendingDeletion: String?
  @State private var lastDeletedReportID: String?
  private var contextKey: String {
    [jira.client?.connection.origin.absoluteString ?? "", jira.user?.accountId ?? "",
     importedSetup?["board"]["id"].identifier ?? "", projectKey].joined(separator: "|")
  }
  private var localDateString: String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = TimeZone(identifier: "Europe/Kyiv")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }
  private var connectionMatchesWorkspace: Bool {
    guard let client = jira.client else { return false }
    guard let expected = importedSetup?["jiraBaseUrl"].string else { return importedSetup == nil }
    return expected.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      == client.connection.origin.absoluteString.trimmingCharacters(
        in: CharacterSet(charactersIn: "/"))
  }
  private struct PersonChoice: Identifiable {
    let id: String
    let name: String
  }
  private var peopleChoices: [PersonChoice] {
    var names: [String: String] = Dictionary(uniqueKeysWithValues: members.map { ($0.id, $0.name) })
    for issue in workspaceIssues {
      if let id = issue.assigneeID { names[id] = issue.assignee ?? id }
    }
    for person in snapshot?["result"]["people"].array ?? [] {
      if let id = person["user"]["id"].string {
        names[id] = person["user"]["displayName"].string ?? id
      }
    }
    return names.map { PersonChoice(id: $0.key, name: $0.value) }.sorted {
      $0.name.localizedStandardCompare($1.name) == .orderedAscending
    }
  }
  private var visibleHistory: [JSONValue] {
    let origin =
      (importedSetup?["jiraBaseUrl"].string ?? jira.client?.connection.origin.absoluteString)?
      .trimmingCharacters(
        in: CharacterSet(charactersIn: "/"))
    return history.filter {
      (origin == nil
        || $0["jira"]["baseUrl"].string?.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
          == origin)
        && (boardID.isEmpty || $0["request"]["boardId"].string == boardID)
    }
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack {
        VStack(alignment: .leading, spacing: 8) {
          PV.eyebrow("REPORTING")
          Text("Daily, Weekly and Sprint reports").font(.system(size: 24, weight: .bold))
        }
        Spacer()
        Text("LOCAL HISTORY").font(.system(size: 10, weight: .bold)).foregroundStyle(PV.secondary)
          .padding(8).background(PV.subtle, in: Capsule())
      }
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: 230), alignment: .leading)],
        alignment: .leading, spacing: 20
      ) {
        reportControl("Report type") {
          Picker("Report type", selection: $type) {
            Text("Daily").tag("daily")
            Text("Weekly").tag("weekly")
            Text("Sprint").tag("sprint")
          }.labelsHidden()
        }
        reportControl("Workspace board") {
          Text(importedSetup?["board"]["name"].string ?? boardID).frame(
            maxWidth: .infinity, alignment: .leading
          ).padding(10).background(PV.background, in: RoundedRectangle(cornerRadius: 7))
        }
        reportControl("Scope") {
          Picker("Scope", selection: $selectedUser) {
            Text("Team").tag("")
            ForEach(peopleChoices) { Text($0.name).tag($0.id) }
          }.labelsHidden()
        }
        if type != "board-health" {
          reportControl(type == "weekly" ? "Week date" : "Report date") {
            DatePicker("Report date", selection: $date, displayedComponents: .date).labelsHidden()
          }
        }
        reportControl("Output language") {
          Picker("Output language", selection: $language) {
            Text("Українська").tag("uk")
            Text("English").tag("en")
          }.labelsHidden()
        }
        if type == "sprint" {
          reportControl("Sprint") {
            Picker("Sprint", selection: $sprintID) {
              Text("Select sprint").tag("")
              ForEach(sprints) { Text($0.name + " · " + $0.state).tag($0.id) }
            }.labelsHidden()
          }
          reportControl("Completion basis") {
            Picker("Completion basis", selection: $mode) {
              Text("Issue count").tag("issue-count")
              Text("Story Points").tag("story-points")
              Text("Original Estimate").tag("original-estimate")
            }.labelsHidden()
          }
        }
      }.disabled(generation != nil)
        .accessibilityElement(children: .contain)
      if type == "daily" || type == "weekly",
        let period = try? ReportPeriod.build(
          type: type, localDate: localDateString, generatedAt: ReportPeriod.iso(Date()))
      {
        Text(
          "Period: " + ReportPresentation.formatDate(period.start) + " — "
            + ReportPresentation.formatDate(period.end)
        ).font(.system(size: 12)).foregroundStyle(PV.secondary)
      }
      if let names = importedSetup?["reporting"]["completedStatusNames"].array.compactMap(\.string),
        !names.isEmpty
      {
        Text("Completed statuses: " + names.joined(separator: ", ")).font(.system(size: 12))
          .foregroundStyle(PV.secondary)
      }
      Text("Board and completed statuses are inherited from Workspace Settings.").font(
        .system(size: 12)
      ).foregroundStyle(PV.secondary)
      if completedIDs.isEmpty {
        Text("Configure at least one completed status in Workspace Settings.").font(
          .system(size: 12)
        ).foregroundStyle(Color(hex: 0x7f5f01))
      }
      if jira.client == nil {
        Text(
          "Connect to Jira in Settings to generate a live report. Saved local history remains available."
        ).font(.system(size: 12)).foregroundStyle(PV.secondary)
      }
      if !error.isEmpty { Text(error).foregroundStyle(.red).textSelection(.enabled) }
      if !statusMessage.isEmpty {
        Text(statusMessage).font(.system(size: 12)).foregroundStyle(PV.secondary)
      }
      HStack {
        Button("Generate report") {
          generate(forceRefresh: NSEvent.modifierFlags.contains(.shift))
        }.help("Generate from Jira. Hold Shift to reload the full issue history.").buttonStyle(
          ProductButton(primary: true)
        ).disabled(
          !connectionMatchesWorkspace || completedIDs.isEmpty || generation != nil
            || (type == "sprint" && sprintID.isEmpty))
        if generation != nil {
          ProgressView().controlSize(.small)
          Text(stage.isEmpty ? "Generating…" : stage).font(.system(size: 12)).foregroundStyle(
            PV.secondary)
          Button("Cancel") { generation?.cancel() }.buttonStyle(ProductButton())
        }
      }
      if let snapshot {
        Divider()
        VStack(alignment: .leading, spacing: 20) {
          HStack {
            VStack(alignment: .leading, spacing: 8) {
              PV.eyebrow(
                snapshot["request"]["type"].string == "sprint"
                  ? "GENERATED " + ReportPresentation.formatDate(snapshot["generatedAt"].plainText)
                  : (snapshot["request"]["type"].string ?? "") + " REPORT")
              Text(
                (snapshot["board"]["name"].string ?? "Report")
                  + (snapshot["request"]["type"].string == "sprint" ? " · SPRINT" : "")
              ).font(
                .system(size: 24, weight: .bold))
              Text(
                ReportPresentation.formatDate(snapshot["request"]["period"]["start"].plainText)
                  + " — "
                  + ReportPresentation.formatDate(
                    snapshot["request"]["period"]["end"].plainText)
              ).font(.system(size: 12)).foregroundStyle(PV.secondary)
              Text("Data as of " + ReportPresentation.formatDate(snapshot["request"]["period"]["dataCutoff"].plainText))
                .font(.system(size: 12)).foregroundStyle(PV.secondary)
            }
            Spacer()
            Button("Copy stand-up") {
              NSPasteboard.general.clearContents()
              NSPasteboard.general.setString(reportText(snapshot), forType: .string)
            }.buttonStyle(ProductButton())
            Button("Generate PDF") { exportPDF(snapshot) }.buttonStyle(ProductButton())
          }
          if snapshot["request"]["type"].string == "sprint" {
            NativeSprintReportResultView(snapshot: snapshot)
          } else {
            ForEach(snapshot["completeness"]["warnings"].array, id: \.self) { item in
              Text(item["message"].string ?? "Incomplete data").foregroundStyle(.orange)
            }
            NativeReportResultView(snapshot: snapshot, language: language)
          }
        }
      }
      Divider()
      HStack {
        Text("Report history").font(.system(size: 18, weight: .bold))
        Spacer()
        Text("LOCAL").font(.system(size: 10, weight: .bold)).foregroundStyle(PV.secondary)
      }
      if visibleHistory.isEmpty {
        Text("Generated reports are saved on this device.").foregroundStyle(PV.secondary).padding(
          .vertical, 20)
      }
      if let deletedID = lastDeletedReportID {
        HStack {
          Text("Report removed from history.").foregroundStyle(PV.secondary)
          Button("Undo") {
            do {
              try historyStore().restore(id: deletedID)
              lastDeletedReportID = nil
              loadHistory()
            } catch { self.error = "Could not restore report: " + error.localizedDescription }
          }.buttonStyle(ProductButton())
        }
      }
      ForEach(visibleHistory, id: \.self) { saved in
        HStack {
          Button {
            snapshot = saved
            if let savedLanguage = saved["request"]["language"].string,
              ["uk", "en"].contains(savedLanguage) { language = savedLanguage }
            mode = saved["request"]["progressMode"].string ?? "issue-count"
          } label: {
            VStack(alignment: .leading, spacing: 6) {
              Text(
                (saved["request"]["type"].plainText.uppercased()) + " · "
                  + saved["board"]["name"].plainText
                  + (saved["sprint"]["name"].string.map { " · " + $0 } ?? "")
              ).font(.system(size: 13, weight: .bold))
              Text(
                ReportPresentation.formatDate(saved["request"]["period"]["start"].plainText) + " — "
                  + ReportPresentation.formatDate(saved["request"]["period"]["end"].plainText)
                  + " · "
                  + (saved["request"]["scope"]["kind"].string == "assignee" ? "Assignee" : "Team")
                  + " · " + (saved["completeness"]["complete"].boolean ? "Complete" : "Partial")
              ).font(.system(size: 12)).foregroundStyle(PV.secondary)
              Text("Generated " + ReportPresentation.formatDate(saved["generatedAt"].plainText))
                .font(.system(size: 11)).foregroundStyle(PV.secondary)
            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
          }.buttonStyle(.plain)
          Button("Delete") { pendingDeletion = saved["id"].string }.buttonStyle(.plain)
            .foregroundStyle(.red).padding(.trailing, 16)
        }.productCard(8)
      }

    }.padding(28).productCard(20)
      .task(id: contextKey) {
        generation?.cancel()
        generation = nil
        generationID = UUID()
        stage = ""
        statusMessage = ""
        boards = []
        sprints = []
        sprintID = ""
        configuredBoardID = ""
        loadHistory()
        loadWorkspace()
        if connectionMatchesWorkspace, let client = jira.client {
          do {
            let loaded = try await client.reportBoards(projectKey: projectKey)
            try Task.checkCancellation()
            boards = loaded
            await loadBoardContext()
          } catch is CancellationError {} catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
      }
      .onChange(of: mode) { _, value in
        guard let current = snapshot, current["request"]["type"].string == "sprint" else { return }
        do {
          snapshot = try ReportCalculator.changingProgressMode(snapshot: current, to: value)
        } catch { self.error = error.localizedDescription }
      }
      .onDisappear { generation?.cancel() }
      .confirmationDialog(
        "Remove this saved report from history? You can undo this action.",
        isPresented: Binding(
          get: { pendingDeletion != nil }, set: { if !$0 { pendingDeletion = nil } })
      ) {
        Button("Delete", role: .destructive) {
          do {
            if let pendingDeletion {
              try historyStore().delete(id: pendingDeletion)
              lastDeletedReportID = pendingDeletion
              if snapshot?["id"].string == pendingDeletion { snapshot = nil }
            }
            loadHistory()
          } catch { self.error = error.localizedDescription }
          pendingDeletion = nil
        }
        Button("Cancel", role: .cancel) { pendingDeletion = nil }
      }
  }
  private func reportControl<Content: View>(_ title: String, @ViewBuilder content: () -> Content)
    -> some View
  {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.system(size: 12, weight: .semibold))
      content().modifier(ProductControlSurface())
    }
  }
  private func generate(forceRefresh: Bool = false) {
    guard connectionMatchesWorkspace, let client = jira.client else { return }
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(identifier: "Europe/Kyiv")
    let request = NativeReportRequest(
      type: type, boardID: boardID, sprintID: type == "sprint" ? sprintID : nil,
      localDate: formatter.string(from: date), jql: jql,
      selectedUserID: selectedUser.isEmpty ? nil : selectedUser,
      completedStatusIDs: completedIDs.sorted(), progressMode: mode,
      fieldMapping: importedSetup?["fieldMapping"].object.compactMapValues(\.string) ?? [:],
      language: language, verifiedUserID: jira.user?.accountId)
    do {
      try workspaceStore().save(.init(boardID: boardID, jql: jql, completedStatusIDs: completedIDs))
      savedBoardID = boardID
      savedCompletedIDs = completedIDs
    } catch {
      self.error = "Налаштування звітів не збережено: " + String(describing: error)
      return
    }
    statusMessage = ""
    error = ""
    stage = ""
    lastProgress = .distantPast
    let requestID = UUID()
    let requestingContext = contextKey
    generationID = requestID
    generation = Task {
      defer { if generationID == requestID { generation = nil } }
      do {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[
          0]
        let cache = JiraReportHistoryCache(
          directory: root.appendingPathComponent("PowerView/JiraHistoryCache"))
        let result = try await client.generateReport(
          request, cache: cache, forceRefresh: forceRefresh
        ) { message in
          await MainActor.run {
            guard generationID == requestID, contextKey == requestingContext else { return }
            let now = Date()
            if now.timeIntervalSince(lastProgress) >= 0.1 {
              stage = message
              lastProgress = now
            }
          }
        }
        try Task.checkCancellation()
        guard generationID == requestID, contextKey == requestingContext else { return }
        snapshot = result
        do {
          try historyStore().save(result)
          loadHistory()
          error = ""
          statusMessage = "Report generated and saved to local history."
        } catch { self.error = "Звіт сформовано, але історію НЕ збережено: \(error)" }
      } catch is CancellationError {
        if generationID == requestID, contextKey == requestingContext { statusMessage = "Report generation cancelled." }
      } catch {
        if generationID == requestID, contextKey == requestingContext { self.error = "Звіт не сформовано: \(error)" }
      }
    }
  }
  private func workspaceStore() throws -> ReportWorkspaceStore {
    guard let origin = jira.client?.connection.origin else { throw JiraError.missingCredentials }
    let root = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    return try ReportWorkspaceStore(
      directory: root.appendingPathComponent("PowerView/ReportWorkspaces"), origin: origin,
      projectKey: projectKey)
  }
  private func loadWorkspace() {
    jql = "project = " + projectKey
    if let importedSetup, importedSetup["project"]["key"].string == projectKey {
      savedBoardID = importedSetup["board"]["id"].identifier ?? ""
      boardID = savedBoardID
      jql = importedSetup["jql"].string ?? jql
      savedCompletedIDs = Set(
        importedSetup["reporting"]["completedStatusIds"].array.compactMap(\.identifier))
      completedIDs = savedCompletedIDs
    }
    guard jira.client != nil, importedSetup == nil else { return }
    do {
      if let saved = try workspaceStore().load() {
        savedBoardID = saved.boardID
        boardID = saved.boardID
        jql = saved.jql
        savedCompletedIDs = saved.completedStatusIDs
      }
    } catch { self.error = "Налаштування не завантажено: " + String(describing: error) }
  }
  private func loadBoardContext() async {
    guard let client = jira.client else { return }
    let targetBoard = boardID
    do {
      let loaded = try await client.reportStatuses(boardID: targetBoard)
      try Task.checkCancellation()
      guard boardID == targetBoard else { return }
      statuses = loaded
      configuredBoardID = targetBoard
      let known = Set(loaded.compactMap { $0["id"].identifier })
      if targetBoard != savedBoardID {
        completedIDs = []
        error = "Позначте completed-статуси цього борду."
      } else if savedCompletedIDs.isSubset(of: known) {
        completedIDs = savedCompletedIDs
        error = ""
      } else {
        completedIDs = []
        error = "Склад статусів змінився. Заново позначте completed-статуси."
      }
      if boards.first(where: { $0.id == targetBoard })?.type == "scrum" || boards.isEmpty {
        let loadedSprints = try await client.reportSprints(boardID: targetBoard)
        try Task.checkCancellation()
        guard boardID == targetBoard else { return }
        sprints = loadedSprints
        if !loadedSprints.contains(where: { $0.id == sprintID }) { sprintID = loadedSprints.first?.id ?? "" }
      } else {
        sprints = []
      }
    } catch is CancellationError {} catch {
      if !Task.isCancelled { self.error = "Налаштування борду не завантажено: " + String(describing: error) }
    }
  }
  private func historyStore() throws -> ReportHistoryStore {
    let root = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    return try ReportHistoryStore(directory: root.appendingPathComponent("PowerView/ReportHistory"))
  }
  private func loadHistory() {
    do { history = try historyStore().list() } catch {
      self.error = "Історію не завантажено: \(error)"
    }
  }
  private func reportText(_ snapshot: JSONValue) -> String {
    ReportTextRenderer.render(snapshot, language: language)
  }
  private func exportPDF(_ snapshot: JSONValue) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = "power-view-report.pdf"
    panel.allowedContentTypes = [.pdf]
    guard panel.runModal() == .OK, let url = panel.url else { return }
    Task {
      do { try await ProductReportPDF.write(snapshot: snapshot, language: language, to: url) } catch
      { self.error = "Could not save PDF: " + error.localizedDescription }
    }
  }
}
