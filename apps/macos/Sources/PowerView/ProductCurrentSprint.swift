import PowerViewCore
import SwiftUI

struct ProductCurrentSprint: View {
  let state: ProductWorkspace
  @ObservedObject var jira: JiraSession
  @State private var snapshot: JSONValue?
  @State private var error = ""
  @State private var loading = false
  @State private var loadID = UUID()
  @State private var selected = ""
  @State private var selectedCategory: String?
  private var taskKey: String {
    let identity = state.identity ?? "unconfigured"
    let loaded = state.snapshot?.loadedAt.description ?? ""
    return [identity, loaded, String(state.matches(jira.client)), jira.user?.accountId ?? ""].joined(separator: "|")
  }
  private var sprints: [JSONValue] { snapshot?["result"]["sprintHealth"].array ?? [] }
  private var health: JSONValue {
    sprints.first { $0["sprint"]["id"].identifier == selected } ?? sprints.first ?? .null
  }
  private var sprintIssues: [JSONValue] {
    let ids = Set(health["issueIds"].array.compactMap(\.string))
    return (snapshot?["issues"].array ?? []).filter { ids.contains($0["id"].plainText) }
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack {
        VStack(alignment: .leading, spacing: 6) {
          PV.eyebrow("CURRENT SPRINT")
          Text(health["sprint"]["name"].string ?? "Current sprint").font(
            .system(size: 24, weight: .bold))
          Text("Delivery and ownership across the verified sprint scope.").font(.system(size: 12))
            .foregroundStyle(PV.secondary)
        }
        Spacer()
        if sprints.count > 1 {
          Picker("Active sprint", selection: $selected) {
            ForEach(sprints, id: \.self) { sprint in
              Text(sprint["sprint"]["name"].plainText).tag(sprint["sprint"]["id"].identifier ?? "")
            }
          }.frame(maxWidth: 240)
        }
      }
      ForEach(snapshot?["completeness"]["warnings"].array ?? [], id: \.self) { warning in
        Text(warning["message"].plainText).font(.system(size: 12)).foregroundStyle(
          Color(hex: 0x7f5f01))
      }
      if loading {
        ProgressView("Verifying sprint membership in Jira…")
      } else if !error.isEmpty {
        Text(error).foregroundStyle(PV.secondary)
      } else if health == .null {
        Text("No active sprint found").fontWeight(.semibold)
        Text("The report will appear when the board has an active sprint.").foregroundStyle(
          PV.secondary)
      } else {
        let counts = health["issues"]
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), alignment: .top)], spacing: 14) {
          ProductMetric(
            label: "Sprint scope", value: counts["total"].plainText,
            note: "Verified current sprint issues")
          ProductMetric(
            label: "Completed", value: counts["done"].plainText,
            note: percent(counts["done"].number ?? 0, counts["total"].number ?? 0)
              + " of sprint scope", color: PV.green)
          ProductMetric(
            label: "Remaining",
            value: ((counts["total"].number ?? 0) - (counts["done"].number ?? 0)).formatted(),
            note: "Not completed")
          ProductMetric(
            label: "Unassigned", value: health["unassigned"].plainText,
            note: "Issues without an owner")
          ProductMetric(
            label: "Blocked",
            value: snapshot?["result"]["blockedAvailable"].boolean == true
              ? health["blocked"].plainText : "—",
            note: snapshot?["result"]["blockedAvailable"].boolean == true
              ? "Blocked issues in sprint" : "Blocked data unavailable")
        }
        HStack(alignment: .top, spacing: 20) {
          VStack(alignment: .leading, spacing: 12) {
            Text("Sprint progress").font(.system(size: 18, weight: .bold))
            progress("Completed", counts["done"], total: counts["total"], color: PV.green)
            progress("In progress", counts["inProgress"], total: counts["total"], color: PV.accent)
            progress(
              "Not started", counts["notStarted"], total: counts["total"],
              color: Color(hex: 0x8794a9))
            if (counts["unknown"].number ?? 0) > 0 {
              progress("Unknown", counts["unknown"], total: counts["total"], color: PV.secondary)
            }
          }.frame(maxWidth: .infinity, alignment: .leading)
          VStack(alignment: .leading, spacing: 12) {
            Text("Story points").font(.system(size: 18, weight: .bold))
            if snapshot?["result"]["storyPointsDataAvailable"].boolean == true {
              Text(
                health["storyPoints"]["done"].plainText + " / "
                  + health["storyPoints"]["total"].plainText + " completed"
              ).font(.system(size: 22, weight: .bold))
              Text(
                percent(health["storyPointsCoverage"].number ?? 0, 1)
                  + " of sprint issues have story points"
              ).font(.system(size: 12)).foregroundStyle(PV.secondary)
            } else {
              Text("Story points data is unavailable").fontWeight(.semibold)
              Text("Map the Story Points field in Project setup.").font(.system(size: 12))
                .foregroundStyle(PV.secondary)
            }
          }.frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.vertical, 8)
        Text("Team breakdown").font(.system(size: 18, weight: .bold))
        HStack {
          Text("Person").frame(maxWidth: .infinity, alignment: .leading)
          Text("Distribution").frame(width: 100)
          Text("Done").frame(width: 90)
          Text("In progress").frame(width: 100)
          Text("Not started").frame(width: 90)
          Text("Total").frame(width: 70)
        }.font(.system(size: 11, weight: .semibold)).foregroundStyle(PV.secondary)
        ForEach(health["people"].array, id: \.self) { person in
          ProductSprintPerson(
            person: person, issues: sprintIssues, state: state,
            pointsAvailable: snapshot?["result"]["storyPointsDataAvailable"].boolean == true)
        }
      }
    }.padding(24).productCard(14).task(id: taskKey) { await load() }
      .sheet(
        isPresented: Binding(
          get: { selectedCategory != nil }, set: { if !$0 { selectedCategory = nil } })
      ) {
        VStack(alignment: .leading, spacing: 18) {
          HStack {
            Text(selectedCategory ?? "Sprint issues").font(.title2.bold())
            Spacer()
            Button("Close") { selectedCategory = nil }.buttonStyle(ProductButton())
          }
          let category =
            selectedCategory == "Completed"
            ? "done"
            : selectedCategory == "In progress"
              ? "in-progress" : selectedCategory == "Not started" ? "to-do" : "unknown"
          let matches = sprintIssues.filter {
            SprintPresentation.category(
              $0, completedIDs: state.setup?["reporting"]["completedStatusIds"].array ?? [],
              completedNames: state.setup?["reporting"]["completedStatusNames"].array ?? [])
              == category
          }
          Text("\(matches.count) issues in this sprint").foregroundStyle(PV.secondary)
          ScrollView {
            VStack(alignment: .leading, spacing: 12) {
              ForEach(matches, id: \.self) { issue in
                if let origin = state.snapshot?.origin,
                  let url = URL(
                    string: origin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                      + "/browse/" + issue["key"].plainText)
                {
                  Link(destination: url) {
                    HStack {
                      Text(issue["key"].plainText).bold()
                      Text(issue["summary"].plainText).frame(
                        maxWidth: .infinity, alignment: .leading)
                      Text(issue["status"]["name"].plainText).foregroundStyle(PV.secondary)
                    }.font(.system(size: 13)).padding(12).productCard(8)
                  }.buttonStyle(.plain)
                }
              }
            }
          }
        }.padding(24).frame(minWidth: 620, minHeight: 380)
      }
  }
  private func percent(_ value: Double, _ total: Double) -> String {
    (total > 0 ? value / total * 100 : 0).formatted(.number.precision(.fractionLength(0))) + "%"
  }
  private func progress(_ title: String, _ count: JSONValue, total: JSONValue, color: Color)
    -> some View
  {
    Button {
      selectedCategory = title
    } label: {
      VStack(spacing: 6) {
        HStack {
          Text(title)
          Spacer()
          Text(count.plainText).bold()
          Image(systemName: "chevron.right")
        }.font(.system(size: 12))
        ProgressView(value: count.number ?? 0, total: max(1, total.number ?? 0)).tint(color)
      }.contentShape(Rectangle())
    }.buttonStyle(.plain).help("Show sprint issues: " + title)
  }

  @MainActor private func load() async {
    let requestID = UUID()
    loadID = requestID
    let accountID = jira.user?.accountId
    loading = false
    snapshot = nil
    error = ""
    guard state.matches(jira.client), let client = jira.client, let workspace = state.snapshot
    else {
      error = "Connect to this workspace’s Jira to verify current-sprint membership."
      return
    }
    let completed = state.setup?["reporting"]["completedStatusIds"].array.compactMap(\.string) ?? []
    guard !completed.isEmpty else {
      error = "Configure completed statuses in Project setup."
      return
    }
    loading = true
    defer { if loadID == requestID { loading = false } }
    do {
      let result = try await client.generateReport(
        .init(
          type: "board-health", boardID: workspace.boardID, localDate: TimelineDates.string(Date()),
          jql: workspace.jql, completedStatusIDs: completed,
          fieldMapping: workspace.fieldMapping ?? state.setup?["fieldMapping"].object
            .compactMapValues(\.string) ?? [:], verifiedUserID: accountID))
      try Task.checkCancellation()
      guard loadID == requestID, jira.user?.accountId == accountID, state.matches(jira.client) else { return }
      snapshot = result
      selected = result["result"]["sprintHealth"].array.first?["sprint"]["id"].identifier ?? ""
      if result["result"]["sprintHealth"].array.isEmpty,
        let warning = result["completeness"]["warnings"].array.first
      {
        error = warning["message"].plainText
      }
    } catch is CancellationError {} catch {
      guard loadID == requestID, jira.user?.accountId == accountID else { return }
      self.error = "Current-sprint data is unavailable: " + error.localizedDescription
    }
  }
}
