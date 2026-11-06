import AppKit
import Combine
import PowerViewCore
import SwiftUI

struct WorkspaceDocument: Sendable {
  var state = ProductWorkspace()
}

@MainActor final class WorkspaceDocumentStore: ObservableObject {
  @Published var document = WorkspaceDocument() { didSet { scheduleAutosave() } }
  @Published private(set) var fileURL: URL?
  @Published private(set) var sessionID = UUID()
  @Published private(set) var switching = false
  @Published var error = ""
  @Published var hasPendingTimeInput = false
  @Published private(set) var saved = false
  private var loading = false
  private var revision = 0
  private var autosave: Task<Void, Never>?
  private let persistence = WorkspacePersistence()
  private let recoveryURL: URL
  private let defaults: UserDefaults

  init(recoveryURL override: URL? = nil, defaults: UserDefaults = .standard) {
    self.defaults = defaults
    recoveryURL =
      override
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("PowerView/WorkspaceRecovery/workspace.pvworkspace")
    let preferred = defaults.string(forKey: "workspace.lastOpenPath").map {
      URL(fileURLWithPath: $0)
    }
    if let restored = WorkspaceRecovery.restore(preferred: preferred, recovery: recoveryURL) {
      loading = true
      document = WorkspaceDocument(state: restored.state)
      fileURL = restored.source == recoveryURL ? nil : restored.source
      saved = true
      loading = false
      if restored.usedFallback { defaults.removeObject(forKey: "workspace.lastOpenPath") }
    }
  }
  private func scheduleAutosave() {
    guard !loading else { return }
    saved = false
    revision += 1
    let current = revision
    let state = document.state
    let target = fileURL ?? recoveryURL
    autosave?.cancel()
    autosave = Task {
      do {
        try await Task.sleep(for: .milliseconds(300))
        try Task.checkCancellation()
        try await persist(state, to: target, revision: current)
        if current == revision { saved = true }
      } catch is CancellationError {} catch {
        self.error = "Could not save workspace: " + error.localizedDescription
      }
    }
  }
  func mayReplaceWorkspace() -> Bool {
    guard !hasPendingTimeInput else { error = "Finish saving or close the unsaved Timesheet form before closing Power View or changing the workspace."; return false }
    return true
  }
  func chooseOpen() {
    guard mayReplaceWorkspace() else { return }
    guard !switching else { return }
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.powerViewWorkspace, .json]
    guard panel.runModal() == .OK, let url = panel.url else { return }
    Task { await open(url) }
  }
  func open(_ url: URL) async {
    guard mayReplaceWorkspace() else { return }
    guard !switching, url.standardizedFileURL != fileURL?.standardizedFileURL else { return }
    switching = true
    defer { switching = false }
    do {
      let access = url.startAccessingSecurityScopedResource()
      defer { if access { url.stopAccessingSecurityScopedResource() } }
      let state = try JSONDecoder().decode(ProductWorkspace.self, from: Data(contentsOf: url))
      let previous = preservationURL
      try await saveCurrent(to: previous, mirror: false)
      defaults.set(previous.path, forKey: "workspace.previousPath")
      replace(state, url: url)
      let openedRevision = revision
      do {
        try await persist(state, to: recoveryURL, revision: openedRevision)
        if revision == openedRevision { saved = true }
      } catch {
        self.error = "Workspace opened, but its recovery copy could not be saved: " + error.localizedDescription
      }
    } catch { self.error = "Could not open workspace: " + error.localizedDescription }
  }
  func openPrevious() {
    guard let path = defaults.string(forKey: "workspace.previousPath") else { return }
    Task { await open(URL(fileURLWithPath: path)) }
  }
  private var preservationURL: URL {
    fileURL
      ?? recoveryURL.deletingLastPathComponent().appendingPathComponent(
        sessionID.uuidString + ".pvworkspace")
  }
  func newWorkspace() async {
    guard mayReplaceWorkspace() else { return }
    guard !switching else { return }
    switching = true
    defer { switching = false }
    do {
      let previous = preservationURL
      try await saveCurrent(to: previous, mirror: false)
      defaults.set(previous.path, forKey: "workspace.previousPath")
      replace(ProductWorkspace(), url: nil)
      let newRevision = revision
      do {
        try await persist(document.state, to: recoveryURL, revision: newRevision)
        if revision == newRevision { saved = true }
      } catch {
        self.error = "New workspace created, but it could not be saved. The previous workspace is preserved: " + error.localizedDescription
      }
    } catch { self.error = "Could not preserve current workspace: " + error.localizedDescription }
  }
  private func replace(_ state: ProductWorkspace, url: URL?) {
    autosave?.cancel()
    loading = true
    document = WorkspaceDocument(state: state)
    fileURL = url
    sessionID = UUID()
    revision += 1
    loading = false
    saved = false
    if let url {
      defaults.set(url.path, forKey: "workspace.lastOpenPath")
    } else {
      defaults.removeObject(forKey: "workspace.lastOpenPath")
    }
  }
  private func persist(_ state: ProductWorkspace, to target: URL, revision: Int) async throws {
    try await persistence.save(state, to: target, revision: revision)
    if target != recoveryURL {
      try await persistence.save(state, to: recoveryURL, revision: revision)
    }
  }
  // Lifecycle operations are serialized by switching; revisions advance only for document changes.
  private func saveCurrent(to target: URL, mirror: Bool) async throws {
    while true {
      autosave?.cancel()
      let current = revision
      let state = document.state
      if mirror {
        try await persist(state, to: target, revision: current)
      } else {
        try await persistence.save(state, to: target, revision: current)
      }
      if revision == current {
        saved = true
        return
      }
    }
  }
  func flush() async throws {
    while switching { try await Task.sleep(for: .milliseconds(20)) }
    switching = true
    defer { switching = false }
    try await saveCurrent(to: fileURL ?? recoveryURL, mirror: true)
  }
  func save(asNewFile: Bool = false) {
    guard !switching else { return }
    var target = fileURL
    if target == nil || asNewFile {
      let panel = NSSavePanel()
      panel.allowedContentTypes = [.powerViewWorkspace]
      panel.nameFieldStringValue = fileURL?.lastPathComponent ?? "Power View.pvworkspace"
      guard panel.runModal() == .OK else { return }
      target = panel.url
    }
    guard let target else { return }
    switching = true
    Task {
      defer { switching = false }
      do {
        try await saveCurrent(to: target, mirror: true)
        fileURL = target
        defaults.set(target.path, forKey: "workspace.lastOpenPath")
      } catch { self.error = "Could not save workspace: " + error.localizedDescription }
    }
  }
}

@MainActor final class WorkspaceApplicationDelegate: NSObject, NSApplicationDelegate {
  weak var store: WorkspaceDocumentStore?
  func applicationDidFinishLaunching(_ notification: Notification) {
    if let url = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
      let icon = NSImage(contentsOf: url)
    {
      NSApplication.shared.applicationIconImage = icon
    }
  }
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let store else { return .terminateNow }
    guard store.mayReplaceWorkspace() else { return .terminateCancel }
    Task {
      do {
        try await store.flush()
        sender.reply(toApplicationShouldTerminate: true)
      } catch {
        store.error = "Could not save workspace before quitting: " + error.localizedDescription
        sender.reply(toApplicationShouldTerminate: false)
      }
    }
    return .terminateLater
  }
}
