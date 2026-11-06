// Compiled with the production views, but with a separate background-only entry point.
// No visible windows, app activation, desktop input, credentials or real network transport.
import AppKit
import PowerViewCore
import SwiftUI

private struct CheckFailure: Error, CustomStringConvertible {
  let description: String
}
@MainActor private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
  if !condition() { throw CheckFailure(description: message) }
}

@main @MainActor private struct BackgroundInterfaceChecks {
  static func main() async {
    do {
      try require(Bundle.main.bundleIdentifier == "com.powerview.background-check", "Run only inside the isolated verification bundle.")
      try require(Bundle.main.object(forInfoDictionaryKey: "LSBackgroundOnly") as? Bool == true, "A background-only bundle is required.")
      let app = NSApplication.shared
      if app.activationPolicy() != .prohibited { _ = app.setActivationPolicy(.prohibited) }
      try require(app.activationPolicy() == .prohibited, "Cannot prohibit activation (policy \(app.activationPolicy().rawValue)); no rendering was attempted.")
      try require(app.activationPolicy() == .prohibited && !app.isActive, "The verification process must remain inactive.")
      try require(app.windows.allSatisfy { !$0.isVisible }, "The verification process must not show windows.")

      let output = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "/private/tmp/power-view-background-check", isDirectory: true)
      try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
      var artifacts: [[String: String]] = []
      var unverified: [String: String] = [:]
      var scrollResults: [String: [String: Double]] = [:]
      var referenceScene: [String: Any] = [:]
      func render<V: View>(_ content: V, name: String, width: CGFloat, height: CGFloat, horizontal: CGFloat = 0, vertical: CGFloat = 0, position: NativeTimeGridPosition? = nil, prepare: (() -> Void)? = nil) throws {
        try require(app.activationPolicy() == .prohibited && !app.isActive && app.windows.allSatisfy { !$0.isVisible }, "Desktop isolation was lost; rendering stopped.")
        let view = NSHostingView(rootView: content
          .frame(width: width, height: height, alignment: .topLeading)
          .background(Color.white)
          .environment(\.colorScheme, .light)
          .environment(\.locale, Locale(identifier: "en_US")))
        view.setFrameSize(NSSize(width: width, height: height))
        view.layoutSubtreeIfNeeded()
        view.displayIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.04))
        view.layoutSubtreeIfNeeded()
        prepare?()
        for _ in 0..<3 { RunLoop.main.run(until: Date().addingTimeInterval(0.03)); view.layoutSubtreeIfNeeded(); view.displayIfNeeded() }
        if horizontal > 0 || vertical > 0 {
          guard let position else { throw CheckFailure(description: "A production scroll state is required.") }
          let x = Double(position.horizontalOffset), y = Double(position.verticalOffset)
          print("Production scroll request \(name): x=\(x), y=\(y)")
          guard (horizontal == 0 || x <= -horizontal), (vertical == 0 || y <= -vertical) else { unverified[name] = "The detached production view did not reach the requested scroll offset (x=\(x), y=\(y)); actual interaction remains unverified."; return }
          scrollResults[name] = ["horizontalOffset": x, "verticalOffset": y]
        }
        try require(view.window == nil, "Rendering must not attach to a window.")
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw CheckFailure(description: "Cannot allocate a render buffer.") }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]), png.count > 2000 else { throw CheckFailure(description: "No rendered image was produced.") }
        try require(app.activationPolicy() == .prohibited && !app.isActive && app.windows.allSatisfy { !$0.isVisible }, "Rendering created desktop UI: policy=\(app.activationPolicy().rawValue), active=\(app.isActive), visible=\(app.windows.filter(\.isVisible).count).")
        try png.write(to: output.appendingPathComponent(name + ".png"), options: .atomic)
        artifacts.append(["file": name + ".png", "width": String(bitmap.pixelsWide), "height": String(bitmap.pixelsHigh)])
      }

      try render(NativeSectionSettings(settings: .constant("{}")), name: "section-settings", width: 800, height: 540)
      let transport = NativeTimeFixtureTransport(); await transport.useDemoIssues()
      let client = JiraClient(connection: try JiraConnection(origin: NativeTimeFixtureTransport.origin, email: "fixture@example.invalid", token: "fixture-only"), transport: transport)
      let session = JiraSession(client: client, user: JiraUser(accountId: "fixture", displayName: "Fixture User", timeZone: "Europe/Kyiv"))
      let calendarTransport = NativeCalendarFixtureTransport(); let calendar = try await calendarTransport.makeStore()
      let suite = "PowerView.BackgroundFixture." + UUID().uuidString; let defaults = UserDefaults(suiteName: suite)!
      defer { defaults.removePersistentDomain(forName: suite) }
      let model = NativeTimesheetModel(calendarStore: calendar, defaults: defaults)
      await model.configure(session); model.anchor = "2026-11-04"; model.boardID = "101"; await model.loadBoard(); await model.load()
      model.expanded = ["TEST-1", "TEST-2"]
      await model.setOff("2026-11-06", enabled: true)
      let issue = try await client.timeIssue("TEST-2")
      let report = NativeTimeReportModel(calendarStore: calendar); report.attach(session); await report.discoverTeams()
      report.teamID = NativeTimeFixtureTransport.teamA; report.anchor = "2026-11-04"; await report.load()
      let requestsBefore = await transport.requests.count
      try render(NativeTimesheetView(jira: session, model: model, loadsAutomatically: false), name: "timesheet-week-wide", width: 1380, height: 850)
      try render(NativeTimesheetView(jira: session, model: model, loadsAutomatically: false), name: "timesheet-week-compact", width: 1000, height: 800)
      let weekPosition = NativeTimeGridPosition()
      try render(NativeTimesheetView(jira: session, model: model, loadsAutomatically: false, position: weekPosition), name: "timesheet-week-scroll", width: 1000, height: 800, vertical: 80, position: weekPosition, prepare: { weekPosition.reveal(issueID: "12", day: "2026-11-04") })
      try render(NativeWorklogEditor(jira: session, model: model, request: .init(issue: issue, day: "2026-11-04"), close: {}), name: "worklog-new", width: 700, height: 640)
      try render(NativeWorklogEditor(jira: session, model: model, request: .init(issue: issue, day: "2026-11-03", original: model.records.first), close: {}), name: "worklog-edit", width: 700, height: 600)
      let singleSnapshot = model.snapshot
      let secondLog = try TimeWorklog(raw: NativeTimeFixtureTransport.log(id: "88", issue: "2", day: "2026-11-03", seconds: 1800), issue: issue)
      model.snapshot?.worklogs.append(secondLog)
      try render(NativeWorklogDetails(model: model, request: .init(issue: issue, day: "2026-11-03"), edit: { _ in }, addAnother: {}), name: "worklog-details-multiple", width: 700, height: 600)
      model.snapshot = singleSnapshot
      try render(NativeTimeReportView(jira: session, model: report, loadsAutomatically: false), name: "time-report-team", width: 1280, height: 850)
      report.individual = true
      try render(NativeTimeReportView(jira: session, model: report, loadsAutomatically: false), name: "time-report-individual", width: 1000, height: 850)
      model.loading = true; model.stale = true; model.progress = "Reading worklogs: 4 / 12 issues"
      try render(NativeTimesheetView(jira: session, model: model, loadsAutomatically: false), name: "timesheet-refreshing", width: 1000, height: 800)
      model.loading = false; model.error = "Jira is temporarily unavailable. Displayed data is stale."
      try render(NativeTimesheetView(jira: session, model: model, loadsAutomatically: false), name: "timesheet-read-error", width: 1000, height: 800)
      let requestsAfter = await transport.requests.count
      try require(requestsAfter == requestsBefore, "Rendering must not fetch data or trigger actions.")
      model.error = ""; model.stale = false; model.month = true; await model.load()
      let monthRequests = await transport.requests.count
      try render(NativeTimesheetView(jira: session, model: model, loadsAutomatically: false), name: "timesheet-month-compact", width: 1000, height: 850)
      let monthPosition = NativeTimeGridPosition()
      try render(NativeTimesheetView(jira: session, model: model, loadsAutomatically: false, position: monthPosition), name: "timesheet-month-scroll", width: 1000, height: 850, horizontal: 520, position: monthPosition, prepare: { monthPosition.reveal(issueID: "2", day: "2026-11-23") })
      let afterMonth = await transport.requests.count
      try require(afterMonth == monthRequests, "Rendering must not fetch data.")
      let offline = JiraSession(); offline.origin = "https://example.atlassian.net"; offline.email = ""
      var workspace = ProductWorkspace()
      let workspaceIssues = try (1...5).map { index in
        var raw = NativeTimeFixtureTransport.issue(index).object
        var fields = raw["fields"]!.object
        fields["status"] = .object(["id": .string(index == 3 ? "3" : "1"), "name": .string(index == 3 ? "Done" : "In Progress"), "statusCategory": .object(["key": .string(index == 3 ? "done" : "indeterminate")])])
        fields["customfield_10015"] = .string("2026-11-0\(min(8, index + 1))"); fields["duedate"] = .string("2026-11-0\(min(9, index + 3))")
        raw["fields"] = .object(fields); return try WorkspaceIssue(raw: .object(raw))
      }
      workspace.snapshot = .init(boardID: "101", boardName: "Fixture board", jql: "project = TEST", issues: workspaceIssues, startField: "customfield_10015", dueField: "duedate", origin: NativeTimeFixtureTransport.origin)
      _ = workspace.estimation.add("TEST-2 TEST-3")
      var estimation = ChromeEstimationDraft(); estimation.edit("techLead", text: "Fixture TL"); estimation.edit("days", text: "3.5"); estimation.edit("decomposition", text: "Fixture implementation")
      workspace.estimation.drafts["TEST-2"] = estimation
      let schedule = TimelineSchedule.build(issues: workspaceIssues)
      try render(ProductGantt(state: .constant(workspace), jira: offline, initialSchedule: schedule), name: "gantt", width: 1380, height: 850)
      try render(ProductStatus(snapshot: workspace.snapshot), name: "status", width: 1280, height: 850)
      try render(ProductEstimation(state: .constant(workspace)), name: "estimation", width: 1380, height: 850)
      try render(ProductSetup(state: .constant(ProductWorkspace()), jira: offline, continueToWorkspace: {}), name: "jira-setup", width: 1000, height: 800)
      workspace.setup = .object(["jiraBaseUrl": .string(NativeTimeFixtureTransport.origin), "project": .object(["key": .string("TEST"), "name": .string("Fixture project")]), "board": .object(["id": .string("101"), "name": .string("Fixture board")])])
      model.month = false; await model.load()
      let rootRequests = await transport.requests.count
      defaults.set("{\"timesheet\":true,\"gantt\":true,\"status\":true,\"reports\":true,\"estimation\":true}", forKey: "app.sections.v1")
      try render(ProductRoot(document: .constant(WorkspaceDocument(state: workspace)), jira: session, initialPage: .timesheet, timeModel: model, loadsAutomatically: false).defaultAppStorage(defaults), name: "full-timesheet-1440", width: 1440, height: 900)
      try render(ProductRoot(document: .constant(WorkspaceDocument(state: workspace)), jira: session, initialPage: .timesheet, timeModel: model, loadsAutomatically: false).defaultAppStorage(defaults), name: "full-timesheet-1280", width: 1280, height: 800)
      try render(ProductRoot(document: .constant(WorkspaceDocument(state: workspace)), jira: session, initialPage: .timesheet, timeModel: model, loadsAutomatically: false).defaultAppStorage(defaults), name: "full-timesheet-minimum", width: 680, height: 700)
      let rootAfter = await transport.requests.count
      try require(rootAfter == rootRequests, "Root rendering must not fetch data.")
      if let path = ProcessInfo.processInfo.environment["POWER_VIEW_NATIVE_CHROME_SCENE"] {
        let scene = try JSONDecoder().decode(NativeChromeTimeScene.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let sceneTransport = NativeChromeSceneTransport(scene)
        let sceneClient = JiraClient(connection: try JiraConnection(origin: scene.origin, email: "fixture@example.invalid", token: "fixture-only"), transport: sceneTransport)
        let sceneUser = try JSONDecoder().decode(JiraUser.self, from: JSONEncoder().encode(scene.user))
        let sceneSession = JiraSession(client: sceneClient, user: sceneUser)
        let preferenceKey = "time.preferences." + GitHubTimeCalendar.storageKey(sceneSession.timeScope)
        defaults.set(["board": scene.boardID, "pinsByBoard": [scene.boardID: scene.pins], "priorities": scene.priorities] as [String: Any], forKey: preferenceKey)
        let sceneModel = NativeTimesheetModel(calendarStore: calendar, defaults: defaults)
        await sceneModel.configure(sceneSession); sceneModel.anchor = scene.anchor; await sceneModel.load()
        let sceneIssue = try await sceneClient.timeIssue("OTHER-6")
        let flow = NativeWorklogPresentation(); flow.openDetails(issue: sceneIssue, day: scene.anchor); flow.addAnother(); _ = flow.detailsDismissed()
        guard let createRequest = flow.editor else { throw CheckFailure(description: "Add another did not retain the shared scene issue/date.") }
        let create = NativeWorklogDraft(request: createRequest, zone: sceneModel.zone); create.duration = "90m"
        let submission = try create.submission()
        try await sceneModel.save(issue: submission.issue, original: nil, started: submission.started, seconds: submission.seconds, comment: submission.comment, onSuccess: flow.closeEditor)
        guard let created = sceneModel.lastSaved else { throw CheckFailure(description: "Shared scene create was not confirmed.") }
        flow.openDetails(issue: sceneIssue, day: scene.anchor); flow.edit(created); _ = flow.detailsDismissed()
        guard let editRequest = flow.editor else { throw CheckFailure(description: "Shared scene edit did not open.") }
        let edit = NativeWorklogDraft(request: editRequest, zone: sceneModel.zone); edit.duration = "30m"
        let edited = try edit.submission()
        try await sceneModel.save(issue: edited.issue, original: created, started: edited.started, seconds: edited.seconds, comment: edited.comment, onSuccess: flow.closeEditor)
        guard let updated = sceneModel.lastSaved else { throw CheckFailure(description: "Shared scene edit was not confirmed.") }
        flow.openDetails(issue: sceneIssue, day: scene.anchor); try await sceneModel.delete(issue: sceneIssue, log: updated); flow.deleted()
        let mutationMethods = await sceneTransport.mutationMethods
        try require(mutationMethods == ["POST", "PUT", "DELETE"] && flow.details == nil, "Shared scene CRUD did not finish with closed details.")
        try require(sceneModel.successMessage == "Worklog deleted in Jira.", "Confirmed deletion must show success.")
        let keys = sceneModel.rows(search: "").map(\.issue.key)
        let seconds = sceneModel.records.reduce(0) { $0 + $1.seconds }
        try require(sceneModel.error.isEmpty && sceneModel.snapshot?.complete == true, "Shared Chrome scene failed to load.")
        try require(keys == scene.expectedRows && seconds == scene.expectedSeconds, "Native shared-scene rows or totals differ from current Chrome.")
        let before = await sceneTransport.requests
        try render(NativeTimesheetView(jira: sceneSession, model: sceneModel, loadsAutomatically: false), name: "chrome-scene-native-1440", width: 1400, height: 800)
        try render(NativeTimesheetView(jira: sceneSession, model: sceneModel, loadsAutomatically: false), name: "chrome-scene-native-1280", width: 1240, height: 700)
        var sceneWorkspace = ProductWorkspace()
        sceneWorkspace.setup = .object(["jiraBaseUrl": .string(scene.origin), "project": .object(["key": .string("POWER")])])
        defaults.set("{}", forKey: "app.sections.v1")
        try render(ProductRoot(document: .constant(WorkspaceDocument(state: sceneWorkspace)), jira: sceneSession, initialPage: .timesheet, timeModel: sceneModel, loadsAutomatically: false).defaultAppStorage(defaults), name: "chrome-scene-full-native-1440", width: 1440, height: 900)
        try render(ProductRoot(document: .constant(WorkspaceDocument(state: sceneWorkspace)), jira: sceneSession, initialPage: .timesheet, timeModel: sceneModel, loadsAutomatically: false).defaultAppStorage(defaults), name: "chrome-scene-full-native-1280", width: 1280, height: 800)
        let after = await sceneTransport.requests
        try require(before == after, "Shared-scene rendering must not fetch data.")
        referenceScene = ["source": scene.source, "rows": keys, "seconds": seconds, "matchesCurrentChromeRowsAndHours": true, "mutationMethods": mutationMethods, "detailsClosedAfterDelete": true, "successMessage": sceneModel.successMessage]
      }
      model.explicitJQL = "project = OTHER"; await model.load()
      let emptyRequests = await transport.requests.count
      try render(NativeTimesheetView(jira: session, model: model, loadsAutomatically: false), name: "timesheet-empty", width: 1000, height: 650)
      let afterEmpty = await transport.requests.count
      try require(afterEmpty == emptyRequests, "Empty rendering must not fetch data.")
      await transport.failIssue("TEST-2"); await report.load()
      let partialRequests = await transport.requests.count
      try render(NativeTimeReportView(jira: session, model: report, loadsAutomatically: false), name: "time-report-partial", width: 1000, height: 850)
      let afterPartial = await transport.requests.count
      try require(afterPartial == partialRequests, "Partial report rendering must not fetch data.")
      await transport.setTimeoutWrite(true)
      let unresolvedIssue = try await client.timeIssue("TEST-3")
      do { try await model.save(issue: unresolvedIssue, original: nil, started: "2026-11-04T09:00:00Z", seconds: 1800, comment: "Fixture unresolved write", onSuccess: {}) }
      catch { try require(error as? TimeTrackingError == .unknownOutcome, "Expected a fixture unknown outcome.") }
      let recoveryID = "3:2026-11-04"
      try require(model.recoveries[recoveryID]?.records?.count == 1, "Unknown write must reread its actual fixture result.")
      let recoveryRequests = await transport.requests.count
      try render(NativeWorklogRecoveryNotice(model: model, id: recoveryID), name: "worklog-unknown-result", width: 900, height: 350)
      let unresolvedRequest = TimeEditorRequest(issue: unresolvedIssue, day: "2026-11-04")
      let unresolvedDraft = NativeWorklogDraft(request: unresolvedRequest, zone: model.zone); unresolvedDraft.duration = "30m"; unresolvedDraft.comment = "Fixture unresolved write"
      try render(NativeWorklogEditor(jira: session, model: model, request: unresolvedRequest, draft: unresolvedDraft, close: {}), name: "worklog-retained-unknown-draft", width: 700, height: 850)
      let afterRecovery = await transport.requests.count
      try require(afterRecovery == recoveryRequests, "Recovery rendering must not fetch or replay writes.")
      var installation: [String: Any] = [:]
      if let path = CommandLine.arguments.dropFirst(2).first {
        let bundle = URL(fileURLWithPath: path, isDirectory: true)
        let plist = try Data(contentsOf: bundle.appendingPathComponent("Contents/Info.plist"))
        let info = try PropertyListSerialization.propertyList(from: plist, format: nil) as! [String: Any]
        installation["bundlePath"] = path
        installation["bundleID"] = info["CFBundleIdentifier"] as? String ?? ""
        installation["build"] = info["CFBundleVersion"] as? String ?? ""
        let dockURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Preferences/com.apple.dock.plist")
        if let data = try? Data(contentsOf: dockURL), let dock = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] {
          let tiles = dock["persistent-apps"] as? [[String: Any]] ?? []
          for tile in tiles {
            guard let item = tile["tile-data"] as? [String: Any], item["bundle-identifier"] as? String == "com.powerview.native" else { continue }
            installation["dockURL"] = (item["file-data"] as? [String: Any])?["_CFURLString"] as? String ?? ""
            if let bookmark = item["book"] as? Data {
              var stale = false
              do {
                let resolved = try URL(resolvingBookmarkData: bookmark, options: [.withoutUI, .withoutMounting], relativeTo: nil, bookmarkDataIsStale: &stale)
                installation["dockBookmarkPath"] = resolved.path; installation["dockBookmarkStale"] = stale
                installation["dockBookmarkMatchesCurrentBundle"] = resolved.standardizedFileURL == bundle.standardizedFileURL
              } catch { installation["dockBookmarkResolution"] = "unavailable" }
            }
          }
        }
        if let name = info["CFBundleIconFile"] as? String, let icon = NSImage(contentsOf: bundle.appendingPathComponent("Contents/Resources/" + name)) {
          if let tiff = icon.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) { try png.write(to: output.appendingPathComponent("bundle-icon.png")); installation["bundleIconDecoded"] = true }
        }
        let icon = NSWorkspace.shared.icon(forFile: path)
        if let tiff = icon.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) { try png.write(to: output.appendingPathComponent("system-file-icon.png")); installation["systemFileIconDecoded"] = true }
      }
      try require(app.activationPolicy() == .prohibited && !app.isActive && app.windows.allSatisfy { !$0.isVisible }, "Verification touched the desktop.")
      let evidence: [String: Any] = [
        "status": "passed", "activationProhibited": true, "active": app.isActive, "windows": app.windows.filter(\.isVisible).count, "hiddenWindows": app.windows.filter { !$0.isVisible }.count,
        "realNetworkTransports": 0, "fixtureRequestsBeforeRendering": requestsBefore,
        "fixtureRequestsAfterRendering": requestsAfter, "artifacts": artifacts, "unverifiedInteractions": unverified,
        "installation": installation,
        "programmaticScrollChecks": scrollResults,
        "sharedChromeScene": referenceScene,
      ]
      try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("verification.json"), options: .atomic)
      print("Rendered \(artifacts.count) production views; activation prohibited; zero visible windows; zero desktop input.")
    } catch {
      FileHandle.standardError.write(Data("Background interface verification failed: \(error)\n".utf8))
      exit(1)
    }
  }
}
