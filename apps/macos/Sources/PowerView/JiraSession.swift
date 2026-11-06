import PowerViewCore
import Security
import SwiftUI

@MainActor
final class JiraSession: ObservableObject {
  @Published var origin = UserDefaults.standard.string(forKey: "jira.origin") ?? ""
  @Published var email = UserDefaults.standard.string(forKey: "jira.email") ?? ""
  @Published var token = ""
  @Published var deployment =
    JiraDeployment(rawValue: UserDefaults.standard.string(forKey: "jira.deployment") ?? "cloud")
    ?? .cloud
  @Published var user: JiraUser?
  @Published var status = "Jira не підключено"
  @Published var busy = false
  struct CommentUpdate: Equatable {
    let comments: [JiraComment]
    let unreadIDs: Set<String>
    let syncedAt: Date
  }
  @Published private(set) var commentUpdates: [String: CommentUpdate] = [:]
  @Published private(set) var commentErrors: [String: String] = [:]
  static var auditDirectory: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("PowerView/JiraWriteAudit")
  }
  let writer: JiraWriteExecutor
  init(client: JiraClient? = nil, user: JiraUser? = nil, auditDirectory: URL? = nil) {
    self.client = client
    self.user = user
    writer = JiraWriteExecutor(auditDirectory: auditDirectory ?? Self.auditDirectory)
    if let client {
      origin = client.connection.origin.absoluteString
      email = client.connection.email
    }
  }
  private(set) var client: JiraClient?
  private var pendingCredential: Task<String, Error>?
  private var credentialWait: CheckedContinuation<String, Error>?
  private var credentialTimeout: Task<Void, Never>?
  private func savedCredential(origin: URL, email: String, allowInteraction: Bool) async throws -> String {
    guard pendingCredential == nil else { throw JiraError.keychain(errSecInteractionNotAllowed) }
    let read = Task.detached { try JiraKeychain.load(origin: origin, email: email, allowInteraction: allowInteraction) }
    pendingCredential = read
    return try await withCheckedThrowingContinuation { continuation in
      credentialWait = continuation
      credentialTimeout = Task {
        do { try await Task.sleep(for: .seconds(15)) } catch { return }
        let waiting = credentialWait
        credentialWait = nil
        waiting?.resume(throwing: URLError(.timedOut))
      }
      Task {
        let result = await read.result
        pendingCredential = nil
        credentialTimeout?.cancel()
        credentialTimeout = nil
        let waiting = credentialWait
        credentialWait = nil
        waiting?.resume(with: result)
      }
    }
  }
  func connect(saved: Bool = false, allowInteraction: Bool = true) async {
    guard !busy else { return }
    let requestedOrigin = origin
    let requestedEmail = email
    let enteredToken = token
    let requestedDeployment = deployment
    busy = true
    defer { busy = false }
    do {
      let supplied: String
      if saved {
        guard let url = URL(string: requestedOrigin) else { throw JiraError.invalidOrigin }
        supplied = try await savedCredential(origin: url, email: requestedEmail, allowInteraction: allowInteraction)
      } else {
        supplied = enteredToken
      }
      let connection = try JiraConnection(
        origin: requestedOrigin, email: requestedEmail, token: supplied,
        deployment: requestedDeployment)
      let next = JiraClient(connection: connection)
      let verified = try await next.myself()
      var stored = true
      if !saved {
        do {
          try await Task.detached {
            try JiraKeychain.save(
              token: supplied, origin: connection.origin, email: connection.email)
          }.value
        } catch { stored = false }
      }
      UserDefaults.standard.set(connection.origin.absoluteString, forKey: "jira.origin")
      UserDefaults.standard.set(requestedEmail, forKey: "jira.email")
      UserDefaults.standard.set(requestedDeployment.rawValue, forKey: "jira.deployment")
      commentUpdates = [:]
      commentErrors = [:]
      client = next
      user = verified
      token = ""
      status =
        "Підключено: \(verified.displayName)"
        + (stored ? "" : " · Keychain недоступний; вхід діє лише в цьому сеансі.")
    } catch {
      client = nil
      user = nil
      status = "Не вдалося підключити Jira: \(error)"
    }
  }
  private func commentStore(client: JiraClient, accountID: String) throws -> CommentReadStore {
    let root = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    return try CommentReadStore(
      directory: root.appendingPathComponent("PowerView/CommentReadState"), accountID: accountID,
      origin: client.connection.origin)
  }
  func refreshReleaseComments(keys: [String]) async {
    guard let client, let accountID = user?.accountId else { return }
    for key in keys {
      if Task.isCancelled { return }
      do {
        let comments = try await client.comments(key)
        guard !Task.isCancelled, user?.accountId == accountID,
          self.client?.connection.origin == client.connection.origin
        else { return }
        let store = try commentStore(client: client, accountID: accountID)
        let checkpoint = try store.load(issueKey: key) ?? store.markRead(comments, issueKey: key)
        commentUpdates[key] = .init(
          comments: comments, unreadIDs: CommentReadStore.unreadIDs(comments, since: checkpoint),
          syncedAt: Date())
        commentErrors[key] = nil
      } catch {
        if Task.isCancelled { return }
        guard user?.accountId == accountID else { return }
        commentErrors[key] = "Коментарі не оновлені"
      }
    }
  }
  func markCommentsRead(key: String, comments: [JiraComment]) throws {
    guard let client, let accountID = user?.accountId else { throw JiraError.missingCredentials }
    _ = try commentStore(client: client, accountID: accountID).markRead(comments, issueKey: key)
    commentUpdates[key] = .init(comments: comments, unreadIDs: [], syncedAt: Date())
  }
  func disconnect() {
    do {
      if let connection = client?.connection {
        try JiraKeychain.delete(origin: connection.origin, email: connection.email)
      }
      client = nil
      user = nil
      token = ""
      commentUpdates = [:]
      commentErrors = [:]
      status = "Jira відключено"
    } catch { status = "Не вдалося видалити авторизацію: \(error)" }
  }
}
struct JiraSettingsView: View {
  @Environment(\.dismiss) private var dismiss
  @ObservedObject var session: JiraSession
  var body: some View {
    Form {
      HStack {
        Text("Власне підключення Jira Cloud").font(.title2)
        Spacer()
        Button("Закрити") { dismiss() }
      }
      TextField("https://company.atlassian.net", text: $session.origin).disabled(session.busy)
      TextField("Email", text: $session.email).disabled(session.busy)
      SecureField("Ваш API-токен", text: $session.token).disabled(session.busy)
      Text("Токен зберігається лише в macOS Keychain. У файл релізу він не потрапляє.").font(
        .caption)
      Text(session.status)
      HStack {
        Button("Підключити") { Task { await session.connect() } }.disabled(session.token.isEmpty)
        Button("Використати Keychain") { Task { await session.connect(saved: true) } }
        Button("Відключити й видалити токен") { session.disconnect() }.disabled(session.user == nil)
      }.disabled(session.busy)
      Text("Ця версія читає Jira Cloud REST v3. Data Center ще не підтримується.").font(.caption)
    }.formStyle(.grouped).frame(width: 620, height: 390)
  }
}
struct ExcelImportView: View {
  let url: URL
  let project: String
  let existing: Set<String>
  let commit: ([String]) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var sheets: [ExcelSheet] = []
  @State private var path = ""
  @State private var sheet: Worksheet?
  @State private var column = "A"
  @State private var error = ""
  var rows: [ImportRow] {
    sheet?.preview(column: column, project: project, existingKeys: existing) ?? []
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Імпорт Jira-ключів з Excel").font(.title2)
      Picker("Аркуш", selection: $path) { ForEach(sheets) { Text($0.name).tag($0.path) } }
        .onChange(of: path) { _, _ in loadSheet() }
      Picker("Колонка ключів", selection: $column) {
        ForEach(sheet?.columns ?? [], id: \.self) { Text($0).tag($0) }
      }
      Table(rows) {
        TableColumn("Рядок") { Text(String($0.number)) }.width(50)
        TableColumn("Значення", value: \.value)
        TableColumn("Перевірка") { row in
          Text(row.problem ?? "Готовий до імпорту").foregroundStyle(
            row.problem == nil ? .primary : .secondary)
        }
      }
      if !error.isEmpty { Text(error).foregroundStyle(.red) }
      Text(
        "Рядки з помилками пропускаються. За наявності Jira-підключення дані сторіз завантажаться автоматично."
      )
      .font(.caption)
      HStack {
        Button("Скасувати") { dismiss() }
        Spacer()
        Button("Імпортувати \(rows.compactMap(\.key).count) ключів") {
          commit(rows.compactMap(\.key))
          dismiss()
        }.disabled(rows.compactMap(\.key).isEmpty)
      }
    }.padding(24).frame(width: 800, height: 540)
      .task {
        do {
          sheets = try ExcelWorkbook.sheets(at: url)
          path = sheets.first?.path ?? ""
          loadSheet()
        } catch { self.error = String(describing: error) }
      }
  }
  private func loadSheet() {
    do {
      sheet = try ExcelWorkbook.read(at: url, sheetPath: path)
      column = sheet?.columns.first ?? "A"
      error = ""
    } catch {
      sheet = nil
      self.error = String(describing: error)
    }
  }
}
