import AppKit
import PowerViewCore
import SwiftUI
import UniformTypeIdentifiers

extension UTType {
  static let powerViewWorkspace = UTType(exportedAs: "com.powerview.workspace", conformingTo: .json)
}
#if !POWER_VIEW_BACKGROUND_CHECK
@main
#endif
struct PowerViewApp: App {
  @NSApplicationDelegateAdaptor(WorkspaceApplicationDelegate.self) private var lifecycle
  @StateObject private var store = WorkspaceDocumentStore()
  var body: some Scene {
    Window("Power View", id: "workspace") {
      ProductRoot(document: $store.document, onTimeDirty: { store.hasPendingTimeInput = $0 })
        .disabled(store.switching)
        .id(store.sessionID)
        .onAppear { lifecycle.store = store }
        .background(WorkspaceCloseGuard(store: store).frame(width: 0, height: 0))
        .navigationTitle(store.fileURL?.lastPathComponent ?? "Power View")
        .onOpenURL { url in Task { await store.open(url) } }
        .alert(
          "Workspace",
          isPresented: Binding(get: { !store.error.isEmpty }, set: { if !$0 { store.error = "" } })
        ) {
          Button("Retry saving") { store.error = ""; Task { do { try await store.flush() } catch { store.error = "Could not save workspace: " + error.localizedDescription } } }
          Button("OK") { store.error = "" }
        } message: {
          Text(store.error)
        }
    }
    .defaultSize(width: 1440, height: 960)
    .commands {
      CommandGroup(replacing: .newItem) {
        Button("New Workspace") { Task { await store.newWorkspace() } }.keyboardShortcut("n")
        Button("Open…") { store.chooseOpen() }.keyboardShortcut("o")
        Button("Open Previous Workspace") { store.openPrevious() }
      }
      CommandGroup(replacing: .saveItem) {
        Button("Save") { store.save() }.keyboardShortcut("s")
        Button("Save As…") { store.save(asNewFile: true) }.keyboardShortcut(
          "s", modifiers: [.command, .shift])
      }
    }
  }
}
enum ProductPage: String, CaseIterable {
  case workspace = "Workspace"
  case timesheet = "Timesheet"
  case reports = "Reports"
  case gantt = "Gantt"
  case status = "Status"
  case estimation = "Estimation"
  case settings = "Settings"
  case diagnostics = "Diagnostics"
}
struct ProductRoot: View {
  @Binding var document: WorkspaceDocument
  var onTimeDirty: (Bool) -> Void = { _ in }
  private let loadsAutomatically: Bool
  private let timeModel: NativeTimesheetModel?
  @StateObject private var jira = JiraSession()
  @State private var page = ProductPage.settings
  @State private var message = ""
  @State private var reloadID = UUID()
  @State private var viewportWidth: CGFloat = 1440
  @State private var showUpdates = false
  @State private var refreshing = false
  @State private var resumed = false
  @State private var reconnecting = false
  @State private var connectionNotice = ""
  @AppStorage("app.sections.v1") private var sectionSettings = ""
  @State private var timeDirty = false
  @State private var timeBusy = false
  @State private var pendingPage: ProductPage?
  @State private var timeReportTab = false
  init(document: Binding<WorkspaceDocument>, onTimeDirty: @escaping (Bool) -> Void = { _ in }, jira: JiraSession? = nil, initialPage: ProductPage = .settings, timeModel: NativeTimesheetModel? = nil, loadsAutomatically: Bool = true) {
    _document = document; self.onTimeDirty = onTimeDirty; self.timeModel = timeModel; self.loadsAutomatically = loadsAutomatically
    _jira = StateObject(wrappedValue: jira ?? JiraSession()); _page = State(initialValue: initialPage)
  }
  private var ready: Bool { document.state.snapshot != nil }
  private func visible(_ target: ProductPage) -> Bool {
    NativeSectionSettings.values(sectionSettings)[target.rawValue.lowercased()] ?? true
  }
  private var navigationPages: [ProductPage] {
    [ProductPage.workspace, .reports, .timesheet, .gantt, .status, .estimation].filter { visible($0) }
  }
  private func available(_ target: ProductPage) -> Bool { ready || [.workspace, .timesheet, .reports].contains(target) }
  private func navigate(_ target: ProductPage) {
    if page == .timesheet && timeBusy && target != page { message = "Finish saving time before leaving Timesheet."; return }
    if page == .timesheet && timeDirty && target != page { pendingPage = target } else { page = target }
  }
  var body: some View {
    VStack(spacing: 0) {
      topbar
      if reconnecting || !connectionNotice.isEmpty {
        HStack(spacing: 10) {
          if reconnecting { ProgressView().controlSize(.small) }
          Text(
            reconnecting
              ? (ready
                ? "Reconnecting to Jira… Your saved board is available." : "Reconnecting to Jira…")
              : connectionNotice
          )
          .font(.system(size: 12)).foregroundStyle(PV.secondary)
          Spacer()
          if !reconnecting {
            Button("Retry") { Task { await reconnect(allowInteraction: true) } }.buttonStyle(.plain).foregroundStyle(
              PV.accent)
            Button("Settings") { navigate(.settings) }.buttonStyle(.plain).foregroundStyle(PV.accent)
          }
        }.padding(.horizontal, 24).padding(.vertical, 10).background(PV.subtle)
      }
      ScrollView {
        VStack(alignment: .leading, spacing: 30) {
          switch page {
          case .workspace: chooser
          case .settings:
            ProductSetup(state: $document.state, jira: jira) { page = .workspace }
            NativeSectionSettings(settings: $sectionSettings)
          case .timesheet:
            if jira.client?.connection.deployment == .cloud, jira.user != nil {
              NativeTimesheetView(jira: jira, savedJQL: document.state.setup?["jql"].string ?? "", onDirty: { timeDirty = $0 }, model: timeModel, loadsAutomatically: loadsAutomatically, onBusy: { timeBusy = $0 }).id(jira.timeScope)
            } else { Text("Connect to Jira Cloud in Settings to open Timesheet.").foregroundStyle(PV.secondary) }
          case .estimation:
            Button("← Workspace") { page = .workspace }.buttonStyle(.plain).foregroundStyle(
              PV.secondary)
            ProductEstimation(state: $document.state)
          case .gantt:
            heading("PLANNING", "Gantt", "Review schedule health, dependencies, and delivery risk.")
            ProductGantt(state: $document.state, jira: jira)
          case .status:
            heading("OVERVIEW", "Status chart", "See every Jira status across the selected board.")
            ProductStatus(snapshot: document.state.snapshot)
          case .reports:
            Picker("Reports", selection: $timeReportTab) { Text("Existing Reports").tag(false); Text("Time Report").tag(true) }.pickerStyle(.segmented).frame(maxWidth: 400)
            ZStack(alignment: .top) {
              VStack(alignment: .leading, spacing: 30) {
              if ready {
              heading(
              "REPORTING", "Reports", "Generate decision-ready team updates from live Jira data.")
            ProductBoardHealth(state: document.state)
            ProductCurrentSprint(state: document.state, jira: jira)
            NativeReportsView(
              jira: jira, projectKey: document.state.setup?["project"]["key"].string ?? "",
              members: [], importedSetup: document.state.setup,
              workspaceIssues: document.state.snapshot?.issues ?? [])
              } else { Text("Choose a board in Settings to open existing reports. Time Report only needs a Jira connection.").foregroundStyle(PV.secondary) }
              }.opacity(timeReportTab ? 0 : 1).frame(height: timeReportTab ? 0 : nil).clipped().accessibilityHidden(timeReportTab)
              if jira.client?.connection.deployment == .cloud, jira.user != nil {
                NativeTimeReportView(jira: jira, active: timeReportTab).id(jira.timeScope)
                  .opacity(timeReportTab ? 1 : 0).frame(height: timeReportTab ? nil : 0).clipped().accessibilityHidden(!timeReportTab)
              } else if timeReportTab { Text("Time Report requires a Jira Cloud connection.") }
            }
          case .diagnostics:
            heading(
              "SUPPORT", "Diagnostics",
              "Sanitized technical information for troubleshooting Power View.")
            ProductDiagnostics(state: document.state, jira: jira)
          }
        }.frame(
          maxWidth: (page == .gantt || page == .estimation) ? .infinity : page == .timesheet ? 1680 : 1180, alignment: .leading
        ).padding(
          .horizontal, page == .timesheet ? 20 : 24
        ).padding(.top, page == .timesheet ? 12 : 56).padding(.bottom, page == .timesheet ? 28 : 72).frame(maxWidth: .infinity)
      }.id(page)
    }.id(reloadID).background {
      ZStack {
        Color(hex: 0xf6f7f9)
        RadialGradient(
          colors: [Color(hex: 0x579dff).opacity(0.13), .clear], center: UnitPoint(x: 0.12, y: 0.08),
          startRadius: 0, endRadius: 448)
        RadialGradient(
          colors: [Color(hex: 0x4bce97).opacity(0.1), .clear], center: UnitPoint(x: 0.92, y: 0.18),
          startRadius: 0, endRadius: 384)
      }
    }.foregroundStyle(PV.ink).font(.system(size: 14))
      .background(
        GeometryReader { geometry in
          Color.clear.onAppear { viewportWidth = geometry.size.width }
            .onChange(of: geometry.size.width) { _, width in viewportWidth = width }
        }
      )
      .preferredColorScheme(.light).frame(minWidth: 680, minHeight: 600)
      .task {
        guard loadsAutomatically, !resumed else { return }
        resumed = true
        restorePage()
        await reconnect()
      }
      .onChange(of: page) { _, next in
        guard let identity = document.state.identity,
          WorkspaceResumePolicy.pages.contains(next.rawValue)
        else { return }
        UserDefaults.standard.set(next.rawValue, forKey: "workspace.page." + identity)
      }
      .onChange(of: document.state.identity) { _, _ in if loadsAutomatically { restorePage() } }
      .onChange(of: jira.user?.accountId) { _, _ in
        if document.state.matches(jira.client) { connectionNotice = "" }
      }
      .onChange(of: timeDirty) { _, value in onTimeDirty(value) }
      .onChange(of: sectionSettings) { _, _ in if !visible(page) { page = .workspace } }
      .confirmationDialog("Discard unsaved Timesheet changes?", isPresented: Binding(get: { pendingPage != nil }, set: { if !$0 { pendingPage = nil } })) {
        Button("Discard and continue", role: .destructive) { if let target = pendingPage { timeDirty = false; pendingPage = nil; page = target } }
        Button("Keep editing", role: .cancel) { pendingPage = nil }
      }
      .sheet(isPresented: $showUpdates) { ProductApplicationUpdates() }
      .alert(
        "Power View",
        isPresented: Binding(get: { !message.isEmpty }, set: { if !$0 { message = "" } })
      ) {
        Button("OK") { message = "" }
      } message: {
        Text(message)
      }
  }
  private func restorePage() {
    guard ready, let identity = document.state.identity else {
      page = .settings
      return
    }
    let saved = UserDefaults.standard.string(forKey: "workspace.page." + identity)
    let restored = ProductPage(rawValue: WorkspaceResumePolicy.page(saved)) ?? .workspace
    page = visible(restored) ? restored : .workspace
  }
  private func reconnect(allowInteraction: Bool = false) async {
    guard !reconnecting, !jira.busy, jira.client == nil else { return }
    let expected = document.state.snapshot?.origin ?? document.state.setup?["jiraBaseUrl"].string
    guard WorkspaceResumePolicy.mayReconnect(savedOrigin: jira.origin, workspaceOrigin: expected)
    else {
      if ready {
        connectionNotice = "Saved board opened offline. Connect to its Jira account in Settings."
      }
      return
    }
    let identity = document.state.identity
    reconnecting = true
    connectionNotice = ""
    defer { reconnecting = false }
    await jira.connect(saved: true, allowInteraction: allowInteraction)
    guard document.state.identity == identity else { return }
    guard jira.client != nil else {
      connectionNotice =
        "Saved board opened offline. Jira could not reconnect; retry or check Settings."
      return
    }
    if ready && document.state.matches(jira.client) { await refreshWorkspace() }
  }
  private func refreshWorkspace() async {
    guard !refreshing else { return }
    refreshing = true
    defer { refreshing = false }
    guard let client = jira.client, document.state.matches(client),
      let previous = document.state.snapshot
    else {
      reloadID = UUID()
      return
    }
    let identity = document.state.identity
    do {
      let next = try await client.loadWorkspace(
        boardID: previous.boardID, boardName: previous.boardName, jql: previous.jql,
        startField: previous.startField ?? "",
        dueField: previous.dueField ?? "", fieldMapping: previous.fieldMapping ?? [:])
      guard document.state.identity == identity, document.state.matches(jira.client) else { return }
      document.state.activate(next, setup: document.state.setup)
      reloadID = UUID()
    } catch { message = "Could not refresh workspace: " + error.localizedDescription }
  }
  private var topbar: some View {
    ViewThatFits(in: .horizontal) {
      topbarContents(compact: false)
      topbarContents(compact: true)
    }.padding(.horizontal, max(24, min(72, viewportWidth * 0.05))).frame(height: 72).background(
      .white
    ).overlay(alignment: .bottom) {
      PV.border.frame(height: 1)
    }
  }
  private func topbarContents(compact: Bool) -> some View {
    HStack(spacing: 24) {
      Button {
        navigate(ready ? .workspace : .settings)
      } label: {
        HStack(spacing: 12) {
          Text("PV").font(.system(size: 12, weight: .heavy)).foregroundStyle(.white).frame(
            width: 34, height: 34
          ).background(PV.accent, in: RoundedRectangle(cornerRadius: 10))
          VStack(alignment: .leading, spacing: 2) {
            Text("Power View for Jira").font(.system(size: 14, weight: .bold))
            Text(page == .timesheet ? "Personal time" : document.state.setup?["project"]["key"].string ?? "Jira workspace").font(
              .system(size: 10, weight: .semibold)
            ).foregroundStyle(PV.secondary)
          }
        }
      }.buttonStyle(.plain).fixedSize()
      Spacer(minLength: 0)
      if (ready || jira.client != nil) && !compact {
        HStack(spacing: 4) {
          ForEach(navigationPages, id: \.self) {
            item in
            Button(item.rawValue) { navigate(item) }.buttonStyle(.plain).font(
              .system(size: 12, weight: .bold)
            ).foregroundStyle(page == item ? PV.accent : PV.ink)
              .disabled(!available(item)).opacity(available(item) ? 1 : 0.45)
              .padding(.horizontal, 13).frame(height: 34).background(
                page == item ? Color.white : Color.clear, in: RoundedRectangle(cornerRadius: 7))
          }
        }.padding(4).background(PV.subtle, in: RoundedRectangle(cornerRadius: 10)).fixedSize()
      } else if ready || jira.client != nil {
        Menu(page.rawValue) {
          ForEach(navigationPages, id: \.self) { item in
            Button(item.rawValue) { navigate(item) }.disabled(!available(item))
          }
        }.fixedSize()
      }
      Spacer(minLength: 0)
      HStack(spacing: 6) {
        Button(refreshing ? "Refreshing…" : "↻ Refresh Jira") { Task { await refreshWorkspace() } }
          .disabled(refreshing || !document.state.matches(jira.client))
        Button("Update app") { showUpdates = true }
        Button("?") { navigate(.diagnostics) }
        Button("Settings") { navigate(.settings) }
      }.buttonStyle(.plain).font(.system(size: 12, weight: .bold)).fixedSize()
    }
  }
  private func heading(_ eyebrow: String, _ title: String, _ subtitle: String) -> some View {
    HStack(alignment: .top, spacing: 32) {
      Button("← Workspace") { page = .workspace }.buttonStyle(.plain).foregroundStyle(PV.secondary)
        .padding(.top, 8)
      VStack(alignment: .leading, spacing: 14) {
        PV.eyebrow(eyebrow)
        Text(title).font(.system(size: 56, weight: .bold)).tracking(-2)
        Text(subtitle).font(.system(size: 16)).foregroundStyle(PV.secondary)
      }
      Spacer()
    }
  }
  private var chooser: some View {
    VStack(spacing: 24) {
      VStack(spacing: 16) {
        Text("✓").font(.system(size: 22, weight: .heavy)).foregroundStyle(PV.green).frame(
          width: 54, height: 54
        ).background(Color(hex: 0xdcfff1), in: RoundedRectangle(cornerRadius: 18)).padding(
          .bottom, 4)
        PV.eyebrow("WORKSPACE READY")
        Text("What do you want to open?").font(
          .system(size: viewportWidth > 860 ? 56 : 36, weight: .bold)
        ).tracking(-2)
        Text(
          document.state.matches(jira.client)
            ? "Your Jira connection and project settings are ready."
            : "Your saved workspace is ready. Connect to Jira in Settings to refresh or edit Jira."
        ).font(.system(size: 16))
          .foregroundStyle(PV.secondary)
      }.frame(maxWidth: .infinity)
      LazyVGrid(
        columns: Array(
          repeating: GridItem(.flexible(), spacing: 20), count: viewportWidth > 860 ? 3 : 1),
        spacing: 20
      ) {
        tool(.timesheet, "T", "MY TIME", "Timesheet", "Log your time and manage Day Off.", PV.accent, 0xe9f2ff)
        tool(
          .reports, "R", "COMMUNICATION", "Reports",
          "Create Daily, Weekly, and Sprint summaries for your team.", PV.accent, 0xe9f2ff)
        tool(
          .gantt, "G", "PLANNING", "Gantt",
          "Explore schedule, dependencies, risks, and delivery dates.", PV.green, 0xdcfff1)
        tool(
          .status, "S", "OVERVIEW", "Status chart",
          "See every Jira status across the selected board.", PV.purple, 0xf3edff)
        tool(
          .estimation, "E", "RELEASE PREPARATION", "Estimation board",
          "Estimate client scope, clarify requirements, and prepare QA handoffs.", PV.green,
          0xdcfff1)
      }.frame(maxWidth: 1120).padding(.top, 14)
      Button("Edit workspace settings") { page = .settings }.buttonStyle(.plain).foregroundStyle(
        PV.accent)
    }
  }
  @ViewBuilder private func tool(
    _ target: ProductPage, _ icon: String, _ eyebrow: String, _ title: String,
    _ description: String, _ color: Color, _ tint: UInt32
  ) -> some View {
    if visible(target) {
    Button {
      navigate(target)
    } label: {
      VStack(alignment: .leading, spacing: 24) {
        Text(icon).font(.system(size: 16, weight: .heavy)).foregroundStyle(.white).frame(
          width: 48, height: 48
        ).background(color, in: RoundedRectangle(cornerRadius: 14))
        VStack(alignment: .leading, spacing: 7) {
          Text(eyebrow).font(.system(size: 9, weight: .heavy)).tracking(1.2).foregroundStyle(color)
          Text(title).font(.system(size: 28, weight: .bold)).tracking(-1)
          Text(description).font(.system(size: 13)).foregroundStyle(PV.secondary).lineSpacing(4)
            .padding(.trailing, 30)
        }
        Spacer(minLength: 0)
      }.padding(24).frame(maxWidth: .infinity, minHeight: 250, alignment: .topLeading)
        .background(alignment: .bottomTrailing) {
          Circle().fill(Color(hex: tint)).frame(width: 220, height: 220).offset(x: 70, y: 90)
        }
        .productCard(22).clipShape(RoundedRectangle(cornerRadius: 22))
        .overlay(alignment: .bottomTrailing) { Text("→").font(.system(size: 24)).padding(26) }
        .shadow(color: Color(hex: 0x091e42).opacity(0.09), radius: 20, y: 16)
    }.buttonStyle(.plain)
    }
  }
}
