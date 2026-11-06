import PowerViewCore
import SwiftUI

struct ProductJiraMetadata: View {
  let issue: WorkspaceIssue
  let assignee: Bool
  @ObservedObject var jira: JiraSession
  let prepare: (JiraWriteProposal) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var context: JiraMetadataEditContext?
  @State private var query = ""
  @State private var users: [JiraUser] = []
  @State private var searched = false
  @State private var busy = false
  @State private var error = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(assignee ? "Change assignee" : "Change status").font(.system(size: 14, weight: .bold))
        Spacer()
        Button {
          dismiss()
        } label: {
          Image(systemName: "xmark")
        }.buttonStyle(.plain).accessibilityLabel("Close")
      }
      if let context {
        if assignee {
          if context.canAssign {
            TextField("Name or email", text: $query).textFieldStyle(.roundedBorder)
              .onSubmit { Task { await search() } }
            Button(busy ? "Searching…" : "Search Jira users") { Task { await search() } }
              .buttonStyle(ProductButton()).disabled(busy)
            if !context.assigneeRequired {
              Button("Set \(issue.key) unassigned") { assign(nil, context: context) }.buttonStyle(
                ProductButton())
            }
            ForEach(users, id: \.accountId) { user in
              Button {
                assign(user, context: context)
              } label: {
                VStack(alignment: .leading) {
                  Text(user.displayName)
                  if let email = user.emailAddress {
                    Text(email).font(.caption).foregroundStyle(PV.secondary)
                  }
                }
              }.buttonStyle(ProductButton())
            }
            if !busy && searched && users.isEmpty {
              Text("No people found").foregroundStyle(PV.secondary)
            }
          } else {
            Text("You do not have permission to assign this issue.")
          }
        } else {
          if context.transitions.isEmpty { Text("No transitions available") }
          ForEach(context.transitions) { transition in
            Button {
              propose { client, user in
                try .transition(
                  origin: client.connection.origin, authorID: user.accountId, role: .coordinator,
                  context: context, transitionID: transition.id)
              }
            } label: {
              HStack {
                Text(transition.to.name)
                Spacer()
                if transition.needsAdditionalFields {
                  Text("Requires additional fields").font(.system(size: 10)).foregroundStyle(
                    PV.secondary)
                }
              }
            }.buttonStyle(ProductButton()).disabled(transition.needsAdditionalFields)
          }
        }
      } else if error.isEmpty {
        ProgressView("Loading Jira actions…")
      }
      if !error.isEmpty { Text(error).font(.system(size: 12)).foregroundStyle(.red) }
    }.padding(16).frame(width: 300).task {
      guard let client = jira.client else {
        error = "Connect to Jira to edit this issue."
        return
      }
      do { context = try await client.metadataEditContext(key: issue.key) } catch {
        self.error = error.localizedDescription
      }
    }
  }
  private func assign(_ user: JiraUser?, context: JiraMetadataEditContext) {
    propose { client, author in
      try .assignee(
        origin: client.connection.origin, authorID: author.accountId, role: .coordinator,
        context: context, user: user)
    }
  }
  @MainActor private func search() async {
    guard assignee, !busy, let client = jira.client else {
      users = []
      return
    }
    let requested = query
    busy = true
    searched = true
    error = ""
    defer { busy = false }
    do {
      let result = try await client.assignableUsers(key: issue.key, query: requested)
      try Task.checkCancellation()
      if query == requested { users = result }
    } catch is CancellationError {} catch {
      if query == requested { self.error = error.localizedDescription }
    }
  }
  private func propose(_ action: (JiraClient, JiraUser) throws -> JiraWriteProposal) {
    guard let client = jira.client, let user = jira.user else { return }
    do {
      prepare(try action(client, user))
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
