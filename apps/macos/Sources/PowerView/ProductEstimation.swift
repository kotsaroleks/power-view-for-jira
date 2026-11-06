import AppKit
import PowerViewCore
import SwiftUI
import UniformTypeIdentifiers

struct ProductEstimation: View {
  @Binding var state: ProductWorkspace
  @State private var input = ""
  @State private var search = ""
  @State private var notice = ""
  @State private var selected: String?
  private let colors: [Color] = [
    Color(hex: 0x8798b5), Color(hex: 0xd9a340), Color(hex: 0x8f75cd), Color(hex: 0x398dbe),
    Color(hex: 0x2b9c75),
  ]
  private let hints = [
    "Estimate days and decompose work", "Answer open product questions", "Confirm the final scope",
    "Define tests and submit test data", "Prepared for development",
  ]
  private func draft(_ key: String) -> ChromeEstimationDraft {
    state.estimation.drafts[key] ?? .init()
  }
  private func title(_ key: String) -> String {
    state.snapshot?.issues.first { $0.key == key }?.title ?? "Issue details not loaded"
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack {
        VStack(alignment: .leading, spacing: 8) {
          PV.eyebrow("RELEASE PREPARATION")
          Text("Estimation board").font(.system(size: 56, weight: .bold)).tracking(-2)
          Text("Client scope → Tech Lead → Product Manager → QA Lead → Ready to dev")
            .foregroundStyle(PV.secondary)
        }
        Spacer()
        Button(state.handoffPath == nil ? "Save handoff…" : "Save handoff") { exportHandoff() }
          .buttonStyle(ProductButton()).disabled(
            state.estimation.keys.isEmpty)
      }
      Text(
        "Drafts are saved in this workspace for \(state.snapshot?.boardName ?? "the selected board"). Share the exported handoff with your leads; they can upload it here to continue. Estimates, subtasks, and readiness do not update Jira."
      ).font(.system(size: 13)).foregroundStyle(PV.secondary).lineSpacing(4)
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: 260), alignment: .top)], alignment: .leading,
        spacing: 18
      ) {
        ProductField(
          label: "Release name", text: $state.estimation.release, placeholder: "e.g. Release 8.2"
        )
        ProductField(
          label: "Client issue list", text: $input,
          placeholder: "Paste Jira keys, URLs, or CSV rows: PROJECT-123, PROJECT-124",
          multiline: true)
        VStack(alignment: .leading, spacing: 12) {
          Button("Add to release") { add(input) }.buttonStyle(ProductButton(primary: true))
            .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          Button("Upload list / handoff", action: importFile).buttonStyle(ProductButton())
        }
      }.padding(22).productCard()
      if let path = state.handoffPath {
        HStack {
          Label(URL(fileURLWithPath: path).lastPathComponent, systemImage: "doc.badge.arrow.up")
          Text("Pass the handoff to one person at a time").foregroundStyle(PV.secondary)
          Spacer()
          Button("Save a copy…") { exportHandoff(asCopy: true) }.buttonStyle(.plain)
            .foregroundStyle(PV.accent)
        }.font(.system(size: 12))
      }
      if !notice.isEmpty { Text(notice).font(.system(size: 13)).textSelection(.enabled) }
      HStack(spacing: 28) {
        metric(String(state.estimation.keys.count), "in release")
        metric(state.estimation.total.formatted(), "estimated dev days")
        metric(String(state.estimation.keys.filter { draft($0).stage == 4 }.count), "ready")
        Spacer()
        ProductField(label: "Search issues", text: $search, placeholder: "Key or summary").frame(
          width: 230)
      }
      if state.snapshot?.truncated == true {
        Text(
          "Workspace issue loading was truncated. Imported keys without loaded details remain visible."
        ).font(.system(size: 13)).foregroundStyle(PV.secondary)
      }
      ScrollView(.horizontal) {
        HStack(alignment: .top, spacing: 14) {
          ForEach(0..<5) { stage in column(stage) }
        }.padding(.bottom, 8)
      }
      if state.estimation.keys.isEmpty {
        Text("Upload the client’s release list to begin estimation.").foregroundStyle(PV.secondary)
          .frame(maxWidth: .infinity).padding(24)
      }
      if let selected { details(selected) }
    }
  }
  private func metric(_ number: String, _ label: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 5) {
      Text(number).font(.system(size: 24, weight: .bold))
      Text(label).font(.system(size: 13)).foregroundStyle(PV.secondary)
    }
  }
  private func column(_ stage: Int) -> some View {
    let keys = state.estimation.keys.filter { draft($0).stage == stage }
    return VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 6) {
        Text(String(stage + 1)).font(.system(size: 11, weight: .bold)).frame(width: 22, height: 22)
          .background(.white, in: Circle())
        Text(ChromeEstimationBoard.stages[stage]).font(.system(size: 13, weight: .bold))
        Spacer(minLength: 0)
        Text(String(keys.count)).font(.system(size: 11)).foregroundStyle(PV.secondary)
      }
      Text(hints[stage]).font(.system(size: 12)).foregroundStyle(PV.secondary).frame(
        height: 32, alignment: .top)
      ForEach(
        keys.filter {
          search.isEmpty || ($0 + " " + title($0)).localizedCaseInsensitiveContains(search)
        }, id: \.self
      ) { key in
        Button {
          selected = key
        } label: {
          VStack(alignment: .leading, spacing: 8) {
            Text(key).font(.system(size: 13, weight: .bold)).foregroundStyle(PV.accent)
            Text(title(key)).font(.system(size: 13)).lineLimit(3)
            Text(draft(key).techLead.isEmpty ? "Tech Lead unassigned" : draft(key).techLead).font(
              .system(size: 11)
            ).foregroundStyle(PV.secondary)
            if !draft(key).days.isEmpty {
              Text(draft(key).days + " dev days").font(.system(size: 11)).foregroundStyle(
                PV.secondary)
            }
          }.padding(14).frame(maxWidth: .infinity, alignment: .leading).productCard(10)
            .overlay(
              RoundedRectangle(cornerRadius: 10).stroke(
                selected == key ? PV.accent : .clear, lineWidth: 2))
        }.buttonStyle(.plain)
      }
      if keys.isEmpty {
        Text("No issues at this stage").font(.system(size: 12)).foregroundStyle(PV.secondary).frame(
          maxWidth: .infinity
        ).padding(.vertical, 24)
      }
      Spacer(minLength: 0)
    }.padding(14).containerRelativeFrame(.horizontal, count: 5, spacing: 14).frame(
      minWidth: 220, minHeight: 300, alignment: .topLeading
    ).background(
      Color(hex: 0xf3f5f8), in: RoundedRectangle(cornerRadius: 14)
    )
    .overlay(alignment: .top) { colors[stage].frame(height: 3).padding(.horizontal, 10) }
  }
  private func field(_ key: String, _ name: String, _ label: String, multiline: Bool = true)
    -> some View
  {
    ProductField(
      label: label,
      text: Binding(
        get: { draft(key).text(name) },
        set: { value in
          var next = draft(key)
          next.edit(name, text: value)
          state.estimation.drafts[key] = next
        }), placeholder: fieldPlaceholder(name), multiline: multiline,
      hint: name == "days" ? "Working days; decimals are allowed, e.g. 3.5." : "",
      error: name == "days" && !draft(key).days.isEmpty
        && (!ChromeEstimationDraft.number(draft(key).days).isFinite
          || ChromeEstimationDraft.number(draft(key).days) <= 0)
        ? "Enter a number greater than zero." : "")
  }
  private func fieldPlaceholder(_ name: String) -> String {
    switch name {
    case "techLead", "qaLead": "Name of the responsible lead"
    case "days": "e.g. 3.5"
    case "decomposition": "Break the work into concrete subtasks"
    case "questions": "List open questions, or leave blank if there are none"
    case "answers": "Record decisions and answers to the questions above"
    case "scope": "Describe the agreed result and acceptance criteria"
    case "environment": "Environment, build, accounts and access needed for testing"
    case "conditions": "Preconditions and scenarios to cover"
    case "testPlan": "Testing steps and expected results"
    case "testData": "Data or fixtures the developer will need"
    default: ""
    }
  }
  private func check(_ key: String, _ name: String, _ label: String, value: Bool, enabled: Bool)
    -> some View
  {
    Toggle(
      label,
      isOn: Binding(
        get: { value },
        set: { flag in
          var next = draft(key)
          next.edit(name, flag: flag)
          state.estimation.drafts[key] = next
        })
    ).disabled(!enabled).font(.system(size: 13))
  }
  private func details(_ key: String) -> some View {
    let value = draft(key)
    return VStack(alignment: .leading, spacing: 24) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 10) {
          PV.eyebrow(ChromeEstimationBoard.stages[value.stage])
          Text(key + " · " + title(key)).font(.system(size: 24, weight: .bold))
          if let origin = state.setup?["jiraBaseUrl"].string,
            let url = URL(
              string: origin.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/browse/"
                + key)
          {
            Link("Open in Jira ↗", destination: url).foregroundStyle(PV.accent)
          }
        }
        Spacer()
        VStack(spacing: 12) {
          Button("Close details") { selected = nil }.buttonStyle(ProductButton())
          Button("Remove from release") {
            let alert = NSAlert()
            alert.messageText = "Remove \(key) and its preparation draft from this release?"
            alert.addButton(withTitle: "Remove")
            alert.addButton(withTitle: "Cancel")
            if alert.runModal() == .alertFirstButtonReturn {
              state.estimation.keys.removeAll { $0 == key }
              state.estimation.drafts[key] = nil
              selected = nil
            }
          }.buttonStyle(.plain).foregroundStyle(PV.accent)
        }
      }
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: 480), alignment: .top)], alignment: .leading,
        spacing: 24
      ) {
        VStack(alignment: .leading, spacing: 16) {
          Text("1. Tech Lead estimation").font(.system(size: 18, weight: .bold))
          field(key, "techLead", "Tech Lead", multiline: false)
          field(key, "days", "Estimate (dev days)", multiline: false)
          field(key, "decomposition", "Subtask decomposition")
          field(key, "questions", "Questions for Product Manager")
          field(key, "answers", "Product Manager answers")
          check(
            key, "questionsResolved", "All product questions resolved",
            value: value.questionsResolved,
            enabled: !value.questions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
              && !value.answers.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          field(key, "scope", "Final scope / acceptance criteria")
          check(
            key, "scopeConfirmed", "Confirm final scope", value: value.scopeConfirmed,
            enabled: value.scopeComplete)
          Text(
            "Requires a Tech Lead, positive day estimate, decomposition, final scope, and answers to any questions. Editing these details reopens scope and QA approval."
          ).font(.system(size: 12)).foregroundStyle(PV.secondary)
        }.padding(20).productCard(12)
        VStack(alignment: .leading, spacing: 16) {
          Text("2. QA Lead preparation").font(.system(size: 18, weight: .bold))
          field(key, "qaLead", "QA Lead", multiline: false)
          field(key, "environment", "Test environment")
          field(key, "conditions", "Test conditions")
          field(key, "testPlan", "Test plan")
          field(key, "testData", "Test data for developer")
          check(
            key, "qaSubmitted", "Submit QA plan and test data", value: value.qaSubmitted,
            enabled: value.qaComplete)
          Button(value.ready ? "Ready to dev ✓" : "Mark ready for development") {
            var next = value
            next.edit("ready", flag: true)
            state.estimation.drafts[key] = next
          }.buttonStyle(ProductButton(primary: true)).disabled(
            !value.qaComplete || !value.qaSubmitted || value.ready)
          Text(
            "QA preparation opens after final scope confirmation. All QA fields and submission are required for readiness. This marks readiness in the local board."
          ).font(.system(size: 12)).foregroundStyle(PV.secondary)
        }.padding(20).productCard(12).disabled(!value.scopeConfirmed || !value.scopeComplete)
      }
    }.padding(24).productCard()
  }
  private func add(_ text: String) {
    let keys = ChromeEstimationBoard.parseKeys(text)
    guard !keys.isEmpty else {
      notice = "No Jira issue keys found. Use keys such as PROJECT-123."
      return
    }
    let count = state.estimation.add(text)
    notice = "\(count) issues added. \(keys.count - count) already on the board."
    let loaded = Set(state.snapshot?.issues.map(\.key) ?? [])
    let missing = keys.filter { !loaded.contains($0) }
    if !missing.isEmpty {
      notice +=
        " Details unavailable in the loaded workspace: " + missing.joined(separator: ", ") + "."
    }
    input = ""
  }
  private func exportHandoff(asCopy: Bool = false) {
    do {
      var raw = try JSONDecoder().decode(
        JSONValue.self, from: JSONEncoder().encode(state.estimation)
      ).object
      raw["issues"] = .array(
        state.estimation.keys.map { key in
          .object([
            "key": .string(key),
            "summary": .string(state.snapshot?.issues.first(where: { $0.key == key })?.title ?? ""),
            "stage": .string(ChromeEstimationBoard.stages[draft(key).stage]),
          ])
        })
      raw["version"] = .number(1)
      raw["boardId"] = .string(state.snapshot?.boardID ?? "")
      raw["jiraBaseUrl"] = state.setup?["jiraBaseUrl"] ?? .string(state.snapshot?.origin ?? "")
      let data = try JSONEncoder().encode(JSONValue.object(raw))
      var target: URL?
      var expected = state.handoffFingerprint
      if !asCopy, let path = state.handoffPath {
        target = URL(fileURLWithPath: path)
      } else {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.nameFieldStringValue = "release-estimation-handoff.json"
        panel.message =
          "Choose a shared Google Drive folder to continue with your team, or save locally."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        target = url
        expected = (try? HandoffFileStore.read(url)).map(HandoffFileStore.fingerprint)
      }
      guard let target else { return }
      let fingerprint = try HandoffFileStore.save(data, to: target, expected: expected)
      if !asCopy {
        state.handoffPath = target.path
        state.handoffFingerprint = fingerprint
      }
      notice = "Handoff saved. Your team can open this file using Upload list / handoff."

    } catch { notice = "Could not export handoff: " + error.localizedDescription }
  }
  private func importFile() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.json, .commaSeparatedText, .plainText, .tabSeparatedText]
    guard panel.runModal() == .OK, let url = panel.url else { return }
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    do {
      let data = try HandoffFileStore.read(url)
      if url.pathExtension.lowercased() != "json" {
        add(String(decoding: data, as: UTF8.self))
        return
      }
      let metadata = try JSONDecoder().decode(JSONValue.self, from: data)
      guard metadata["version"].number == 1,
        metadata["boardId"].identifier == state.snapshot?.boardID,
        metadata["jiraBaseUrl"].string
          == (state.setup?["jiraBaseUrl"].string ?? state.snapshot?.origin)
      else {
        notice = "Use a version 1 handoff exported from this Jira instance and board."
        return
      }
      let imported = try ChromeEstimationBoard.read(data)
      let conflicts = imported.keys.filter { state.estimation.keys.contains($0) }
      if !conflicts.isEmpty {
        let alert = NSAlert()
        alert.messageText =
          "Replace saved drafts for \(conflicts.count) existing issues with the imported handoff?"
        alert.addButton(withTitle: "Replace")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
      }
      state.estimation.release = imported.release
      for key in imported.keys {
        if !state.estimation.keys.contains(key) { state.estimation.keys.append(key) }
        state.estimation.drafts[key] = imported.drafts[key]
      }
      state.handoffPath = url.path
      state.handoffFingerprint = HandoffFileStore.fingerprint(data)
      notice =
        "Opened handoff for \(imported.keys.count) issues. Save handoff to share your changes."
    } catch { notice = "Could not read the handoff. Choose an exported JSON handoff." }
  }
}
