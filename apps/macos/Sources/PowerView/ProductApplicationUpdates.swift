import PowerViewCore
import SwiftUI

struct ProductApplicationUpdates: View {
  @Environment(\.dismiss) private var dismiss
  @State private var release: ApplicationRelease?
  @State private var checking = true
  @State private var failure = ""
  private var current: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      HStack {
        Text("Power View updates").font(.title2.bold())
        Spacer()
        Button("Close") { dismiss() }
      }
      Text("Installed version: " + current).foregroundStyle(PV.secondary)
      if checking {
        ProgressView("Checking for a macOS release…")
      } else if let release {
        if release.newer {
          Text("Version " + release.version + " is available").font(.headline)
          if let package = release.package {
            Link("Download macOS update ↗", destination: package).buttonStyle(
              ProductButton(primary: true))
          } else {
            Text("This release does not include a macOS download yet.").foregroundStyle(
              PV.secondary)
          }
        } else {
          Text("You have the latest published version.").font(.headline)
        }
        Link("View release notes ↗", destination: release.page).foregroundStyle(PV.accent)
      } else {
        Text(failure).foregroundStyle(PV.secondary)
        Button("Try again") { Task { await check() } }.buttonStyle(ProductButton())
      }
    }.padding(24).frame(width: 460).task { await check() }
  }
  private func check() async {
    checking = true
    failure = ""
    defer { checking = false }
    do { release = try await ApplicationUpdates.check(currentVersion: current) } catch {
      failure =
        "The published macOS release could not be checked. Your installed app is ready to use."
    }
  }
}
