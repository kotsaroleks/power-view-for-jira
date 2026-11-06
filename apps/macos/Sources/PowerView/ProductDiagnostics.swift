import AppKit
import PowerViewCore
import SwiftUI

struct ProductDiagnostics: View {
  let state: ProductWorkspace
  @ObservedObject var jira: JiraSession
  @State private var loaded = false
  @State private var copied = false
  private var values: [(String, String)] {
    [
      (
        "Application",
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "Development build"
      ),
      ("Runtime", "Native Swift · " + ProcessInfo.processInfo.operatingSystemVersionString),
      ("Jira", state.snapshot?.origin ?? state.setup?["jiraBaseUrl"].string ?? "Not configured"),
      ("Deployment", jira.deployment == .cloud ? "Cloud" : "Data Center"),
      (
        "Connection",
        state.matches(jira.client) ? "Connected to workspace" : "Not connected to workspace"
      ),
      ("Storage", "Local workspace document"),
      ("Issues", String(state.snapshot?.issues.count ?? 0)),
      (
        "Scope",
        state.snapshot?.truncated == true
          ? "Truncated" : state.snapshot == nil ? "Not loaded" : "Complete"
      ),
    ]
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack {
        Text("Connection diagnostics").font(.system(size: 18, weight: .bold))
        Spacer()
        Text("SANITIZED").font(.system(size: 10, weight: .bold)).foregroundStyle(PV.secondary)
          .padding(8).background(PV.subtle, in: Capsule())
      }
      if loaded {
        ForEach(values, id: \.0) { label, value in
          HStack(alignment: .top) {
            Text(label).foregroundStyle(PV.secondary).frame(width: 160, alignment: .leading)
            Text(value).textSelection(.enabled)
            Spacer()
          }.font(.system(size: 13))
          Divider()
        }
        Text(
          "Cookies, authorization headers, session values, and issue content are never included."
        ).font(.system(size: 12)).foregroundStyle(PV.secondary)
        HStack {
          Button("Copy diagnostics") {
            let object = Dictionary(
              uniqueKeysWithValues: values.map { ($0.0, JSONValue.string($0.1)) })
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(JSONValue.object(object).prettyJSON, forType: .string)
            copied = true
          }.buttonStyle(ProductButton(primary: true))
          if copied {
            Text("Diagnostics copied.").font(.system(size: 12)).foregroundStyle(PV.green)
          }
        }
      } else {
        Text("Load a sanitized diagnostics snapshot.").foregroundStyle(PV.secondary)
        Button("Load diagnostics") { loaded = true }.buttonStyle(ProductButton())
      }
    }.padding(28).productCard(20)
  }
}
