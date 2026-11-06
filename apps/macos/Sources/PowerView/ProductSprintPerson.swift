import PowerViewCore
import SwiftUI

struct ProductSprintPerson: View {
  let person: JSONValue
  let issues: [JSONValue]
  let state: ProductWorkspace
  let pointsAvailable: Bool
  @State private var expanded = false
  @State private var showFinished = false
  private var owned: [JSONValue] {
    issues.filter { SprintPresentation.owner($0) == person["key"].string }
  }
  private func finished(_ issue: JSONValue) -> Bool {
    SprintPresentation.category(
      issue, completedIDs: state.setup?["reporting"]["completedStatusIds"].array ?? [],
      completedNames: state.setup?["reporting"]["completedStatusNames"].array ?? []) == "done"
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Button {
        expanded.toggle()
      } label: {
        HStack {
          Image(systemName: expanded ? "chevron.down" : "chevron.right")
          Text(person["name"].plainText).frame(maxWidth: .infinity, alignment: .leading)
          SprintDistribution(counts: person["issues"]).frame(width: 100)

          Text(person["issues"]["done"].plainText).frame(width: 90)
          Text(person["issues"]["inProgress"].plainText).frame(width: 100)
          Text(person["issues"]["notStarted"].plainText).frame(width: 90)
          Text(person["issues"]["total"].plainText).frame(width: 70)
        }.font(.system(size: 12)).padding(.vertical, 8)
      }.buttonStyle(.plain)
      if expanded {
        Toggle("Show finished", isOn: $showFinished).font(.system(size: 12))
        let visible = owned.filter { showFinished || !finished($0) }
        Text("\(visible.count) of \(owned.count) issues").font(.system(size: 12, weight: .semibold))
        if visible.isEmpty {
          Text("No issues matching this filter").font(.system(size: 12)).foregroundStyle(
            PV.secondary)
        }
        ForEach(visible, id: \.self) { issue in
          HStack {
            if let origin = state.snapshot?.origin,
              let url = URL(
                string: origin.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/browse/"
                  + issue["key"].plainText)
            {
              Link(issue["key"].plainText, destination: url).foregroundStyle(PV.accent)
            }
            Text(issue["summary"].plainText).frame(maxWidth: .infinity, alignment: .leading)
            Text(issue["status"]["name"].plainText).foregroundStyle(PV.secondary)
          }.font(.system(size: 12)).padding(.vertical, 6)
        }
      }
      Divider()
    }
  }
}
