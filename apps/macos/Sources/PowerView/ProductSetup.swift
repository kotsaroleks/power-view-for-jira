import AppKit
import PowerViewCore
import SwiftUI
import UniformTypeIdentifiers

struct ProductSetup: View {
  @Binding var state: ProductWorkspace
  @ObservedObject var jira: JiraSession
  var continueToWorkspace: () -> Void
  @State private var project = ""
  @State private var board = ""
  @State private var jql = ""
  @State private var query = ""
  @State private var startField = "customfield_10015"
  @State private var endField = "duedate"
  @State private var hierarchyField = ""
  @State private var storyPointsField = ""
  @State private var sprintField = ""
  @State private var projects: [JSONValue] = []
  @State private var fields: [JSONValue] = []
  @State private var statuses: [JSONValue] = []
  @State private var boards: [JiraBoardChoice] = []
  @State private var completed: Set<String> = []
  @State private var preferences = ProductWorkspace.defaultPreferences
  @State private var importedSetup: ChromeSetup?
  @State private var catalogBusy = false
  @State private var statusBusy = false
  @State private var catalogRequest = UUID()
  @State private var statusRequest = UUID()
  @State private var metadataRequest = UUID()
  @State private var inferredOrigin: URL?
  @State private var offset = 0
  @State private var projectTotal = 0
  @State private var busy = false
  @State private var message = ""
  @State private var loginStep = false
  @State private var addressError = ""
  @State private var boardLink = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack(alignment: .top, spacing: 18) {
        Text("⚙").font(.system(size: 28)).foregroundStyle(PV.accent).frame(width: 54, height: 54)
          .background(Color(hex: 0xe9f2ff), in: RoundedRectangle(cornerRadius: 14))
        VStack(alignment: .leading, spacing: 8) {
          PV.eyebrow(jira.client == nil ? "GET STARTED" : "WORKSPACE")
          Text(jira.client == nil ? "Open your Jira in Power View" : "Your workspace").font(
            .system(size: 28, weight: .bold))
          Text(
            jira.client == nil
              ? "Connect once, then choose the board you work with."
              : "Choose your project and board."
          ).foregroundStyle(
            PV.secondary)
        }
        Spacer()
        if let user = jira.user {
          Label("Connected as " + user.displayName, systemImage: "circle.fill").font(
            .system(size: 12)
          ).foregroundStyle(PV.green)
        }
      }
      if jira.client == nil {
        VStack(alignment: .leading, spacing: 20) {
          if !loginStep {
            Text("1. Where is your Jira?").font(.system(size: 20, weight: .bold))
            ProductField(
              label: "Jira address", text: $jira.origin,
              placeholder: "company.atlassian.net",
              hint: "Copy the address from the browser where you use Jira.", error: addressError)
            Button("Continue") { continueLogin() }.buttonStyle(ProductButton(primary: true))
              .disabled(jira.origin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          } else {
            HStack {
              Text("2. Connect your account").font(.system(size: 20, weight: .bold))
              Spacer()
              Button("Change address") { loginStep = false }.buttonStyle(.plain).foregroundStyle(
                PV.accent)
            }
            Text(jira.origin).font(.system(size: 13)).foregroundStyle(PV.secondary).textSelection(
              .enabled)
            if jira.deployment == .cloud {
              ProductField(
                label: "Your work email", text: $jira.email, placeholder: "you@company.com")
            }
            ProductField(
              label: "Access token", text: $jira.token, placeholder: "Paste the token here",
              hint: "A token lets Power View connect to Jira. It is saved securely on this Mac.",
              secure: true)
            DisclosureGroup("Where do I get a token?") {
              VStack(alignment: .leading, spacing: 10) {
                if jira.deployment == .cloud {
                  Text(
                    "1. Open your Atlassian account using the link below.\n2. Create an API token without scopes and copy it.\n3. Return here and paste it into Access token."
                  )
                  Link(
                    "Open Atlassian token page ↗",
                    destination: URL(
                      string: "https://id.atlassian.com/manage-profile/security/api-tokens")!)
                } else {
                  Text(
                    "In Jira, open your profile → Personal access tokens. Create a token, copy it and paste it here. If this option is missing, ask your Jira administrator."
                  )
                }
              }.font(.system(size: 13)).foregroundStyle(PV.secondary).padding(.top, 10)
            }
            Button(jira.busy ? "Connecting…" : "Connect") { Task { await connectAccount() } }
              .buttonStyle(ProductButton(primary: true))
              .disabled(
                jira.busy || jira.token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                  || (jira.deployment == .cloud
                    && jira.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
              )
            Button("Reconnect with saved account") { Task { await connectAccount(saved: true) } }
              .buttonStyle(.plain).foregroundStyle(PV.accent).disabled(jira.busy)
            DisclosureGroup("Connection options") {
              Picker("Your Jira", selection: $jira.deployment) {
                Text("Atlassian Cloud").tag(JiraDeployment.cloud)
                Text("Company-managed server").tag(JiraDeployment.dataCenter)
              }.padding(.top, 10)
            }
            if jira.status != "Jira не підключено" {
              Text(jira.status).font(.system(size: 12)).textSelection(.enabled)
            }
          }
        }.frame(maxWidth: 520).disabled(jira.busy)
      } else {
        VStack(alignment: .leading, spacing: 20) {
          ProductField(
            label: "Open a board by link", text: $boardLink,
            placeholder: "Paste the board link from Jira")
          Button("Use this board") { Task { await selectLinkedBoard() } }
            .buttonStyle(ProductButton()).disabled(
              boardLink.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || catalogBusy)
          ProductField(
            label: "Search Jira projects", text: $query, placeholder: "Project name or key")
          HStack {
            Button("Search") {
              offset = 0
              Task { await metadata() }
            }
            Spacer()
            Text(
              "\(min(projectTotal, offset + 1))–\(min(projectTotal, offset + projects.count)) of \(projectTotal)"
            ).foregroundStyle(PV.secondary)
            Button("Previous") {
              offset = max(0, offset - 50)
              Task { await metadata() }
            }.disabled(offset == 0)
            Button("Next") {
              offset += 50
              Task { await metadata() }
            }.disabled(offset + projects.count >= projectTotal)
          }.buttonStyle(ProductButton())
          HStack(spacing: 24) {
            VStack(alignment: .leading) {
              Text("Jira project").fontWeight(.semibold)
              Picker("Jira project", selection: Binding(get: { project }, set: chooseProject)) {
                Text("Choose a project…").tag("")
                ForEach(projects, id: \.self) { item in
                  Text((item["key"].string ?? "") + " · " + (item["name"].string ?? "")).tag(
                    item["key"].string ?? "")
                }
              }.labelsHidden().modifier(ProductControlSurface())
            }
            VStack(alignment: .leading) {
              Text("Jira board").fontWeight(.semibold)
              Picker(
                "Jira board",
                selection: Binding(get: { board }, set: { chooseBoard($0, restore: false) })
              ) {
                Text("Choose a board…").tag("")
                ForEach(boards) { Text($0.name).tag($0.id) }
              }.labelsHidden().modifier(ProductControlSurface()).disabled(project.isEmpty)
            }
          }
          DisclosureGroup("Advanced: query, completed statuses, and date fields") {
            VStack(alignment: .leading, spacing: 16) {
              ProductField(
                label: "JQL query", text: $jql, placeholder: "e.g. project = APP ORDER BY Rank ASC",
                multiline: true, hint: "Defines which issues appear in this workspace.")
              Text("Completed statuses").fontWeight(.semibold)
              Text("This board-level mapping is inherited by Board Health and every report.")
                .foregroundStyle(PV.secondary)
              ForEach(statuses, id: \.self) { item in
                let id = item["id"].identifier ?? ""
                Toggle(
                  item["name"].string ?? id,
                  isOn: Binding(
                    get: { completed.contains(id) },
                    set: { if $0 { completed.insert(id) } else { completed.remove(id) } }))
              }
              fieldPicker("Start date field", value: $startField, optional: true, datesOnly: true)
              fieldPicker("End date field", value: $endField, optional: true, datesOnly: true)
            }.padding(.top, 16)
          }
          DisclosureGroup("Optional reporting, hierarchy, and story-point fields") {
            VStack(alignment: .leading, spacing: 16) {
              Text(
                "Map Sprint to enable planning coverage and the current-sprint report. Missing report data is shown as unavailable, never as zero."
              ).font(.system(size: 12)).foregroundStyle(PV.secondary)
              fieldPicker("Sprint field", value: $sprintField, optional: true)
              fieldPicker("Hierarchy field", value: $hierarchyField, optional: true)
              fieldPicker("Story points field", value: $storyPointsField, optional: true)
            }.padding(.top, 16)
          }
          TimelineCalendarSettings(
            nonWorkingDays: Binding(
              get: { preferences.nonWorkingDays ?? [0, 6] },
              set: { preferences.nonWorkingDays = $0 }),
            durations: Binding(
              get: { preferences.defaultDurations ?? [:] },
              set: { preferences.defaultDurations = $0 }), canEdit: true)
          HStack {
            Button(busy ? "Loading issues…" : "Save and continue") { Task { await load() } }
              .buttonStyle(ProductButton(primary: true)).disabled(
                busy || catalogBusy || statusBusy || board.isEmpty)
            Button("Change Jira connection") { jira.disconnect() }.buttonStyle(ProductButton())
          }
        }
      }
      if !message.isEmpty { Text(message).foregroundStyle(PV.secondary).textSelection(.enabled) }
      if state.snapshot != nil && jira.client == nil {
        Button("Continue with saved workspace", action: continueToWorkspace)
          .buttonStyle(ProductButton())
      }
      DisclosureGroup("Transfer settings") {
        VStack(alignment: .leading, spacing: 12) {
          Text("Bring your settings from the Chrome version or another workspace.")
            .font(.system(size: 12)).foregroundStyle(PV.secondary)
          Button("Import settings…", action: importWorkspace).buttonStyle(ProductButton())
          if state.setup != nil {
            Button("Export settings…", action: exportSettings).buttonStyle(ProductButton())
          }
        }.padding(.top, 12)
      }

    }.padding(32).productCard(20).disabled(busy)
      .onAppear {
        preferences = state.preferences
        if let setup = state.setup {
          project = setup["project"]["key"].string ?? ""
          board = setup["board"]["id"].identifier ?? ""
          jql = setup["jql"].string ?? ""
          completed = Set(setup["reporting"]["completedStatusIds"].array.compactMap(\.identifier))
          startField = setup["fieldMapping"]["startDateFieldId"].string ?? startField
          endField = setup["fieldMapping"]["endDateFieldId"].string ?? endField
          hierarchyField = setup["fieldMapping"]["hierarchyFieldId"].string ?? ""
          storyPointsField = setup["fieldMapping"]["storyPointsFieldId"].string ?? ""
          sprintField = setup["fieldMapping"]["sprintFieldId"].string ?? ""
        }
      }
      .task(id: jira.user?.accountId) {
        guard jira.client != nil else { return }
        await metadata()
        await loadBoards(restore: true)
        chooseBoard(board, restore: true)
      }
  }
  private func chooseProject(_ value: String) {
    guard project != value else { return }
    project = value
    board = ""
    boards = []
    statuses = []
    completed = []
    importedSetup = nil
    preferences = ProductWorkspace.defaultPreferences
    jql = "project = \"\(value)\" ORDER BY Rank ASC"
    statusRequest = UUID()
    statusBusy = false
    Task { await loadBoards(restore: false) }
  }
  private func loadBoards(restore: Bool) async {
    guard !project.isEmpty, let client = jira.client else { return }
    let selectedProject = project
    let origin = client.connection.origin
    let request = UUID()
    catalogRequest = request
    catalogBusy = true
    defer { if catalogRequest == request { catalogBusy = false } }
    do {
      let loaded = try await client.reportBoards(projectKey: selectedProject)
      guard catalogRequest == request, project == selectedProject,
        jira.client?.connection.origin == origin
      else { return }
      boards = loaded
      if !restore, !loaded.contains(where: { $0.id == board }) { board = "" }
    } catch { if catalogRequest == request { message = error.localizedDescription } }
  }
  private func chooseBoard(_ value: String, restore: Bool) {
    board = value
    guard !value.isEmpty, let client = jira.client else { return }
    let selectedProject = project
    let origin = client.connection.origin
    let request = UUID()
    statusRequest = request
    statusBusy = true
    statuses = []
    let archivedSetup = state.savedBoards?[
      ProductWorkspace.scope(origin: origin.absoluteString, board: value)]?.setup
    if !restore, let archivedSetup {
      jql = archivedSetup["jql"].string ?? jql
      let mapping = archivedSetup["fieldMapping"]
      startField = mapping["startDateFieldId"].string ?? ""
      endField = mapping["endDateFieldId"].string ?? ""
      hierarchyField = mapping["hierarchyFieldId"].string ?? ""
      storyPointsField = mapping["storyPointsFieldId"].string ?? ""
      sprintField = mapping["sprintFieldId"].string ?? ""
    }
    if !restore {
      completed = []
      preferences =
        state.savedBoards?[ProductWorkspace.scope(origin: origin.absoluteString, board: value)]?
        .preferences ?? ProductWorkspace.defaultPreferences
      importedSetup = nil
    }
    Task {
      defer { if statusRequest == request { statusBusy = false } }
      do {
        let loaded = try await client.reportStatuses(boardID: value)
        guard statusRequest == request, project == selectedProject, board == value,
          jira.client?.connection.origin == origin
        else { return }
        statuses = loaded
        if !restore, let archivedSetup {
          let known = Set(loaded.compactMap { $0["id"].identifier })
          completed = Set(
            archivedSetup["reporting"]["completedStatusIds"].array.compactMap(\.identifier)
          ).intersection(known)
        } else if !restore {
          completed = Set(
            loaded.filter { $0["statusCategory"]["key"].string == "done" }.compactMap {
              $0["id"].identifier
            })
        }
      } catch { if statusRequest == request { message = error.localizedDescription } }
    }
  }
  private func selectLinkedBoard() async {
    guard let client = jira.client,
      let url = URL(string: boardLink.trimmingCharacters(in: .whitespacesAndNewlines)),
      url.host?.lowercased() == client.connection.origin.host?.lowercased()
    else {
      message = "Paste a board link from the Jira account you connected."
      return
    }
    let parts = url.pathComponents
    guard let projectIndex = parts.firstIndex(of: "projects"),
      parts.indices.contains(projectIndex + 1),
      let boardIndex = parts.firstIndex(of: "boards"), parts.indices.contains(boardIndex + 1),
      Int(parts[boardIndex + 1]) != nil
    else {
      message = "Use the board link copied from your browser."
      return
    }
    let linkedProject = parts[projectIndex + 1]
    let linkedBoard = parts[boardIndex + 1]
    project = linkedProject
    board = ""
    boards = []
    jql = "project = \"\(linkedProject)\" ORDER BY Rank ASC"
    await loadBoards(restore: false)
    guard jira.client?.connection.origin == client.connection.origin, project == linkedProject,
      boards.contains(where: { $0.id == linkedBoard })
    else {
      message = "This board is not available in your project. Check your Jira access."
      return
    }
    chooseBoard(linkedBoard, restore: false)
    message = "Board selected. Save and continue to load its issues."
  }
  private func continueLogin() {
    var address = jira.origin.trimmingCharacters(in: .whitespacesAndNewlines)
    if !address.contains("://") { address = "https://" + address }
    guard let url = URL(string: address), let host = url.host, !host.isEmpty,
      ["https", "http"].contains(url.scheme?.lowercased() ?? "")
    else {
      addressError = "Enter the address you use to open Jira in your browser."
      return
    }
    addressError = ""
    jira.origin = address
    jira.deployment = host.lowercased().hasSuffix(".atlassian.net") ? .cloud : .dataCenter
    loginStep = true
  }
  private func connectAccount(saved: Bool = false) async {
    await jira.connect(saved: saved)
    if jira.client != nil {
      await metadata()
      await loadBoards(restore: true)
      chooseBoard(board, restore: true)
    }
  }
  private func fieldPicker(
    _ title: String, value: Binding<String>, optional: Bool = false, datesOnly: Bool = false
  )
    -> some View
  {
    VStack(alignment: .leading, spacing: 7) {
      Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(PV.ink)
      Picker(title, selection: value) {
        if optional { Text("Not configured").tag("") }
        if !value.wrappedValue.isEmpty { Text(value.wrappedValue).tag(value.wrappedValue) }
        ForEach(
          fields.filter {
            $0["id"].string != value.wrappedValue
              && (!datesOnly
                || ["date", "datetime"].contains($0["schema"]["type"].string?.lowercased() ?? ""))
          }, id: \.self
        ) { item in
          Text((item["name"].string ?? "") + " · " + (item["id"].string ?? "")).tag(
            item["id"].string ?? "")
        }
      }.labelsHidden().modifier(ProductControlSurface())
    }
  }
  private func metadata() async {
    guard let client = jira.client else { return }
    let requestedQuery = query
    let requestedOffset = offset
    let origin = client.connection.origin
    let request = UUID()
    metadataRequest = request
    do {
      let result = try await client.workspaceProjects(
        query: requestedQuery, startAt: requestedOffset)
      let loadedFields = try await client.workspaceFields()
      guard metadataRequest == request, query == requestedQuery, offset == requestedOffset,
        jira.client?.connection.origin == origin
      else { return }
      projects = result["values"].array
      projectTotal = Int(result["total"].number ?? Double(projects.count))
      fields = loadedFields
      if state.setup == nil && importedSetup == nil && inferredOrigin != origin {
        inferredOrigin = origin
        let detected = JiraFieldMapping.infer(loadedFields)
        startField = detected["startDateFieldId"] ?? ""
        endField = detected["endDateFieldId"] ?? ""
        hierarchyField = detected["hierarchyFieldId"] ?? ""
      }
    } catch { if metadataRequest == request { message = error.localizedDescription } }
  }
  private func load() async {
    guard let client = jira.client else { return }
    let requestedProject = project
    let requestedBoard = board
    let requestedJql = jql
    let requestedStart = startField
    let requestedEnd = endField
    let requestedPreferences = preferences
    let requestedHierarchy = hierarchyField
    let requestedPoints = storyPointsField
    let requestedSprint = sprintField
    let requestedCompleted = completed
    busy = true
    defer { busy = false }
    do {
      let name = boards.first { $0.id == board }?.name ?? board
      var mapping =
        importedSetup?.raw["fieldMapping"].object
        ?? (state.snapshot?.boardID == requestedBoard && state.matches(client)
          ? state.setup?["fieldMapping"].object : nil) ?? [:]
      mapping["startDateFieldId"] = requestedStart.isEmpty ? nil : .string(requestedStart)
      mapping["endDateFieldId"] = requestedEnd.isEmpty ? nil : .string(requestedEnd)
      for (name, value) in [
        ("hierarchyFieldId", hierarchyField), ("storyPointsFieldId", storyPointsField),
        ("sprintFieldId", sprintField),
      ] {
        if value.isEmpty { mapping[name] = nil } else { mapping[name] = .string(value) }
      }
      let mappingErrors = JiraFieldMapping.validate(
        mapping.compactMapValues(\.string), fields: fields)
      guard mappingErrors.isEmpty else {
        message = mappingErrors.joined(separator: "\n")
        return
      }
      let snapshot = try await client.loadWorkspace(
        boardID: requestedBoard, boardName: name, jql: requestedJql, startField: requestedStart,
        dueField: requestedEnd, fieldMapping: mapping.compactMapValues(\.string))
      guard project == requestedProject, board == requestedBoard, jql == requestedJql,
        startField == requestedStart, endField == requestedEnd,
        hierarchyField == requestedHierarchy, storyPointsField == requestedPoints,
        sprintField == requestedSprint, completed == requestedCompleted,
        preferences == requestedPreferences,
        jira.client?.connection.origin == client.connection.origin
      else {
        message = "Workspace selection changed. Choose Save and continue again."
        return
      }
      let nextSetup: JSONValue = .object([
        "jiraBaseUrl": .string(client.connection.origin.absoluteString),
        "project": .object([
          "id": projects.first(where: { $0["key"].string == project })?["id"] ?? importedSetup?.raw[
            "project"]["id"] ?? state.setup?["project"]["id"] ?? .string(project),
          "key": .string(project),
          "name": projects.first(where: { $0["key"].string == project })?["name"] ?? importedSetup?
            .raw["project"]["name"] ?? state.setup?["project"]["name"] ?? .string(project),
        ]),
        "board": .object([
          "id": .string(board), "name": .string(name),
          "type": .string(boards.first(where: { $0.id == board })?.type ?? "unknown"),
          "projectKeys": .array([.string(project)]),
        ]), "jql": .string(jql),
        "fieldMapping": .object(mapping),
        "reporting": .object([
          "completedStatusIds": .array(completed.sorted().map(JSONValue.string)),
          "completedStatusNames": .array(
            statuses.filter { completed.contains($0["id"].identifier ?? "") }.compactMap {
              $0["name"].string
            }.map(JSONValue.string)),
        ]),
      ])
      state.activate(snapshot, setup: nextSetup, preferences: requestedPreferences)
      if let importedSetup {
        state.importedConfiguration = importedSetup.archive
        state.links = importedSetup.links
        state.reconciledDates = importedSetup.reconciledDates
      }
      continueToWorkspace()
    } catch { message = "Could not load workspace: " + error.localizedDescription }
  }
  private func exportSettings() {
    do {
      let value = try state.exportPortableConfiguration()
      let panel = NSSavePanel()
      panel.allowedContentTypes = [.json]
      panel.nameFieldStringValue = "power-view-board-configuration.json"
      guard panel.runModal() == .OK, let url = panel.url else { return }
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      try encoder.encode(value).write(to: url, options: .atomic)
      message = "Settings exported."
    } catch { message = "Could not export settings: " + error.localizedDescription }
  }
  private func importWorkspace() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.json]
    guard panel.runModal() == .OK, let url = panel.url else { return }
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    do {
      let data = try Data(contentsOf: url)
      if let saved = try? JSONDecoder().decode(ProductWorkspace.self, from: data) {
        state = saved
        continueToWorkspace()
      } else if let setup = try? ChromeSetup.decode(data) {
        importedSetup = setup
        preferences = setup.preferences
        project = setup.project
        board = setup.boardID
        jql = setup.jql
        startField = setup.startField
        endField = setup.dueField
        hierarchyField = setup.raw["fieldMapping"]["hierarchyFieldId"].string ?? ""
        storyPointsField = setup.raw["fieldMapping"]["storyPointsFieldId"].string ?? ""
        sprintField = setup.raw["fieldMapping"]["sprintFieldId"].string ?? ""
        completed = Set(setup.raw["reporting"]["completedStatusIds"].array.compactMap(\.identifier))
        Task {
          await loadBoards(restore: true)
          chooseBoard(board, restore: true)
        }
        message = "Settings imported. Connect to Jira and choose Save and continue to load issues."
      } else {
        let snapshot = try WorkspaceCodec.decode(data)
        let setup: JSONValue? = snapshot.origin.map { origin in
          .object([
            "jiraBaseUrl": .string(origin), "project": .object(["key": .string(project)]),
            "board": .object(["id": .string(snapshot.boardID), "name": .string(snapshot.boardName)]
            ), "jql": .string(snapshot.jql),
          ])
        }
        state.activate(snapshot, setup: setup)
        continueToWorkspace()
      }
    } catch { message = "Could not import workspace: " + error.localizedDescription }
  }
}
