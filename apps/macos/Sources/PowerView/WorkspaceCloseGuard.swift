import AppKit
import SwiftUI

/// Forward SwiftUI's existing window delegate, adding the same pending-input guard
/// used by Open/New/Quit. No window is created or activated by this view.
struct WorkspaceCloseGuard: NSViewRepresentable {
  let store: WorkspaceDocumentStore
  final class Host: NSView {
    var attach: ((NSWindow) -> Void)?
    override func viewDidMoveToWindow() { super.viewDidMoveToWindow(); if let window { attach?(window) } }
  }
  @MainActor final class Coordinator: NSObject, NSWindowDelegate {
    weak var store: WorkspaceDocumentStore?
    weak var previous: (any NSWindowDelegate)?
    weak var window: NSWindow?
    init(store: WorkspaceDocumentStore) { self.store = store }
    func attach(_ window: NSWindow) {
      guard window.delegate !== self else { return }
      self.window = window; previous = window.delegate; window.delegate = self
    }
    func permitsClosing() -> Bool { store?.mayReplaceWorkspace() ?? true }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
      guard permitsClosing() else { return false }
      return previous?.windowShouldClose?(sender) ?? true
    }
    override func responds(to selector: Selector!) -> Bool {
      if super.responds(to: selector) { return true }
      return MainActor.assumeIsolated { previous?.responds(to: selector) ?? false }
    }
    // Objective-C delegates are forwarded synchronously on AppKit's main thread.
    private struct ForwardTarget: @unchecked Sendable { var value: Any? }
    override func forwardingTarget(for selector: Selector!) -> Any? {
      MainActor.assumeIsolated { ForwardTarget(value: previous?.responds(to: selector) == true ? previous : super.forwardingTarget(for: selector)) }.value
    }
  }
  func makeCoordinator() -> Coordinator { Coordinator(store: store) }
  func makeNSView(context: Context) -> Host {
    let view = Host(); view.attach = { [weak coordinator = context.coordinator] window in coordinator?.attach(window) }; return view
  }
  func updateNSView(_ view: Host, context: Context) { context.coordinator.store = store; if let window = view.window { context.coordinator.attach(window) } }
  static func dismantleNSView(_ view: Host, coordinator: Coordinator) {
    if let window = coordinator.window, window.delegate === coordinator { window.delegate = coordinator.previous }
    view.attach = nil
  }
}
