import AppKit
import PowerViewCore
import SwiftUI

struct ProductGantt: View {
  @Binding var state: ProductWorkspace
  @ObservedObject var jira: JiraSession
  @State private var search = ""
  @FocusState private var focusedCell: String?
  @FocusState private var focusedDependency: String?
  @State private var hideDone = false
  @State private var sort = TimelineSort.rank
  @State private var ascending = true
  @State private var zoom = 10.0
  @State private var collapsed: Set<String> = []
  @State private var message = ""
  @State private var metadata: WorkspaceIssue?
  @State private var editingAssignee = false
  @State private var proposal: JiraWriteProposal?
  @State private var saving = false
  @State private var preparing = false
  @State private var pendingProposal: JiraWriteProposal?
  @State private var model: [String: TimelineScheduleEntry] = [:]
  @State private var serverModel: [String: TimelineScheduleEntry] = [:]
  @State private var externalConflicts: [TimelineExternalConflict] = []
  @State private var resolvedConflicts: Set<String> = []
  @State private var keepDatesNotice = false
  @State private var pendingSchedule: (key: String, date: String)?
  @State private var leftWidth = 520.0
  @State private var splitStart: Double?
  @State private var dependencyStart: (String, Bool)?
  init(state: Binding<ProductWorkspace>, jira: JiraSession, initialSchedule: [String: TimelineScheduleEntry] = [:]) {
    _state = state; self.jira = jira
    _model = State(initialValue: initialSchedule); _serverModel = State(initialValue: initialSchedule)
  }
  private var issues: [WorkspaceIssue] { state.snapshot?.issues ?? [] }
  private var rows: [TimelineRow] {
    TimelineHierarchy.rows(
      issues: issues, plans: state.plans, collapsed: collapsed, query: search, hideDone: hideDone,
      sort: sort, ascending: ascending, resolved: model)
  }
  private var origin: Date {
    let today = TimelineDates.string(Date())
    let first = (model.values.filter { $0.state != "unscheduled" }.map(\.start) + [today]).min()!
    return TimelineDates.parse(first)!.addingTimeInterval(-14 * 86400)
  }
  private var count: Int {
    let today = TimelineDates.string(Date())
    let last = (model.values.filter { $0.state != "unscheduled" }.map(\.end) + [today]).max()!
    return max(45, TimelineDates.dayOffset(TimelineDates.parse(last)!, from: origin) + 31)
  }
  private func tint(_ issue: WorkspaceIssue) -> Color {
    issue.category == "done"
      ? Color(hex: 0x39a06f)
      : issue.status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression) == "in review"
        ? Color(hex: 0x7a61d1)
        : issue.category == "indeterminate" ? Color(hex: 0x4f8df7) : Color(hex: 0x8794a9)
  }
  var body: some View {
    VStack(spacing: 0) {
      toolbar
      if let conflict = externalConflicts.first(where: { !resolvedConflicts.contains($0.issueKey) })
      {
        HStack(spacing: 12) {
          VStack(alignment: .leading, spacing: 4) {
            Text(conflict.issueKey + " changed in Jira without its dependent schedule.").fontWeight(
              .bold)
            Text("\(conflict.repairUpdates.count) downstream tasks need attention.").font(
              .system(size: 12))
          }
          Spacer()
          Button("Repair schedule automatically") {
            Task { await reviewSchedule(conflict.repairUpdates) }
          }.buttonStyle(ProductButton(primary: true)).disabled(!state.matches(jira.client))
          Button("Keep Jira dates") {
            resolvedConflicts.insert(conflict.issueKey)
            keepDatesNotice = true
          }.buttonStyle(ProductButton())
        }.padding(12).background(Color(hex: 0xfff1f1)).foregroundStyle(Color(hex: 0x8e2525))
      }
      if keepDatesNotice {
        Text("No Jira dates were changed. Resolve the highlighted dependencies manually.").font(
          .system(size: 13)
        ).padding(10).frame(maxWidth: .infinity, alignment: .leading).background(
          Color(hex: 0xfff8df))
      }
      if !message.isEmpty {
        Text(message).font(.system(size: 12))
          .foregroundStyle(Color(hex: message.hasPrefix("Saved.") ? 0x21633c : 0x9c2d2d)).padding(12)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Color(hex: message.hasPrefix("Saved.") ? 0xedf8f0 : 0xfff2f2))
      }
      if let start = dependencyStart {
        HStack {
          Text("Choose a start or finish handle on another task to link from \(start.0).")
          Spacer()
          Button("Cancel") { dependencyStart = nil }
        }.padding(12).background(Color(hex: 0xfff8df))
      }
      ScrollViewReader { verticalProxy in
        ScrollView(.vertical) {
          HStack(alignment: .top, spacing: 0) {
            taskTable.frame(width: leftWidth)
            PV.border.frame(width: 6)
              .contentShape(Rectangle()).gesture(
                DragGesture().onChanged { value in
                  if splitStart == nil { splitStart = leftWidth }
                  leftWidth = min(760, max(320, splitStart! + value.translation.width))
                }.onEnded { _ in splitStart = nil }
              )
              .focusable().accessibilityLabel("Resize task table").accessibilityValue(
                String(Int(leftWidth))
              )
              .onKeyPress(.leftArrow) {
                leftWidth = max(320, leftWidth - 20)
                return .handled
              }
              .onKeyPress(.rightArrow) {
                leftWidth = min(760, leftWidth + 20)
                return .handled
              }
            ScrollViewReader { proxy in
              ScrollView(.horizontal) {
                timeline
                  .overlay(alignment: .topLeading) {
                    Color.clear.frame(width: 1, height: 1).offset(
                      x: Double(TimelineDates.dayOffset(Date(), from: origin)) * zoom
                    ).id("today")
                  }
              }.onChange(of: todayRequest) { _, _ in proxy.scrollTo("today", anchor: .center) }
            }
          }
        }.frame(minHeight: 420, maxHeight: 650)
          .onChange(of: focusedCell) { _, cell in
            guard let key = cell?.split(separator: "|").first else { return }
            verticalProxy.scrollTo(String(key), anchor: .center)
          }
      }
    }.productCard(12).clipShape(RoundedRectangle(cornerRadius: 12)).shadow(
      color: PV.ink.opacity(0.08), radius: 18, y: 14
    )
    .onAppear {
      search = state.preferences.search
      hideDone = state.preferences.hideDone
      zoom = state.preferences.dayWidth
      sort = state.preferences.sort
      ascending = state.preferences.ascending
      collapsed = Set(state.preferences.collapsed)
    }
    .onChange(of: preferences) { _, value in state.preferences = value }
    .task(id: ScheduleKey(issues: issues, plans: state.plans, preferences: state.preferences)) {
      let input = ScheduleKey(issues: issues, plans: state.plans, preferences: state.preferences)
      let next = await Task.detached {
        let server = TimelineSchedule.build(
          issues: input.issues, nonWorkingDays: Set(input.preferences.nonWorkingDays ?? [0, 6]),
          defaultDurations: input.preferences.defaultDurations ?? [:])
        let local =
          input.plans.isEmpty
          ? server
          : TimelineSchedule.build(
            issues: input.issues, plans: input.plans,
            nonWorkingDays: Set(input.preferences.nonWorkingDays ?? [0, 6]),
            defaultDurations: input.preferences.defaultDurations ?? [:])
        return (local, server)
      }.value
      if !Task.isCancelled {
        model = next.0
        serverModel = next.1
      }
    }

    .task(
      id: ConflictKey(
        schedule: serverModel, links: state.links, reconciled: state.reconciledDates ?? [:],
        order: issues.map(\.key), days: state.preferences.nonWorkingDays ?? [0, 6])
    ) {
      let input = ConflictKey(
        schedule: serverModel, links: state.links, reconciled: state.reconciledDates ?? [:],
        order: issues.map(\.key), days: state.preferences.nonWorkingDays ?? [0, 6])
      let next = await Task.detached {
        (try? TimelineExternalConflicts.find(
          schedule: input.schedule, order: input.order, links: input.links,
          reconciled: input.reconciled, nonWorkingDays: Set(input.days))) ?? []
      }.value
      if !Task.isCancelled { externalConflicts = next }
    }
    .onChange(of: metadata?.key) { _, key in
      if key == nil, let pendingProposal {
        proposal = pendingProposal
        self.pendingProposal = nil
      }
    }
    .task(id: proposal?.id) {
      guard let value = proposal, !saving, state.matches(jira.client), let client = jira.client,
        let user = jira.user
      else { return }
      let expectedScope = state.identity
      saving = true
      defer {
        saving = false
        proposal = nil
      }
      do {
        let approval = try value.approve(by: user)
        let results = try await jira.writer.execute(approval, client: client)
        guard state.identity == expectedScope else { return }
        await refreshAfterWrite(results, operations: value.operations)
      } catch { message = "Could not save Jira changes: " + error.localizedDescription }
    }
    .disabled(saving || preparing)
    .overlay {
      if saving || preparing {
        ProgressView("Saving Jira changes…").padding(20).background(
          .regularMaterial, in: RoundedRectangle(cornerRadius: 12))
      }
    }
  }
  private struct ConflictKey: Equatable {
    let schedule: [String: TimelineScheduleEntry]
    let links: [TimelineLink]
    let reconciled: [String: LocalIssuePlan]
    let order: [String]
    let days: [Int]
  }
  private struct ScheduleKey: Equatable {
    let issues: [WorkspaceIssue]
    let plans: [String: LocalIssuePlan]
    let preferences: TimelinePreferences
  }
  @State private var todayRequest = 0
  private var toolbar: some View {
    HStack(spacing: 12) {
      ProductField(label: "", text: $search, placeholder: "Search tasks").frame(width: 230)
      Toggle("Hide completed matching tasks", isOn: $hideDone).font(.system(size: 13))
        .foregroundStyle(PV.secondary)
      Spacer(minLength: 0)
      Picker("Sort tasks", selection: $sort) {
        Text("Board order").tag(TimelineSort.rank)
        Text("Start date").tag(TimelineSort.start)
        Text("Due date").tag(TimelineSort.due)
        Text("Task name").tag(TimelineSort.name)
        Text("Status").tag(TimelineSort.status)
        Text("Issue key").tag(TimelineSort.key)
        Text("Assignee").tag(TimelineSort.assignee)
      }.labelsHidden().frame(width: 130)
      Button(ascending ? "↑" : "↓") { ascending.toggle() }.buttonStyle(ProductButton())
      Button("Today") { todayRequest += 1 }.buttonStyle(ProductButton())
      HStack(spacing: 0) {
        ForEach([40.0, 24, 10], id: \.self) { value in
          Button(value == 40 ? "Day" : value == 24 ? "Week" : "Month") { zoom = value }.buttonStyle(
            .plain
          ).font(.system(size: 13)).padding(.horizontal, 12).frame(height: 34).background(
            zoom == value ? Color(hex: 0xeaf2ff) : .white
          ).foregroundStyle(zoom == value ? PV.accent : PV.ink).overlay(
            Rectangle().stroke(PV.border))
        }
      }
    }.padding(.horizontal, 14).frame(height: 64).background(.white).overlay(alignment: .bottom) {
      PV.border.frame(height: 1)
    }
  }
  private var preferences: TimelinePreferences {
    var value = state.preferences
    value.search = search
    value.hideDone = hideDone
    value.sort = sort
    value.ascending = ascending
    value.dayWidth = zoom
    value.collapsed = collapsed.sorted()
    return value
  }
  private var taskTable: some View {
    LazyVStack(spacing: 0) {
      HStack(spacing: 0) {
        Text("TASK").frame(width: max(40, leftWidth - 266), alignment: .leading)
        Text("STATUS").frame(width: 116, alignment: .leading)
        Text("ASSIGNEE").frame(width: 150, alignment: .leading)
      }.font(.system(size: 11, weight: .bold)).tracking(0.8).foregroundStyle(PV.secondary).padding(
        .horizontal, 12
      ).frame(height: 48).background(PV.background)
      ForEach(rows) { row in
        HStack(spacing: 0) {
          HStack(spacing: 6) {
            if issues.contains(where: { $0.parentKey == row.id }) {
              Button(collapsed.contains(row.id) ? "›" : "⌄") {
                if !collapsed.insert(row.id).inserted { collapsed.remove(row.id) }
              }.buttonStyle(.plain)
            }
            ProductIssueTypeIcon(name: row.issue.issueTypeName ?? "")
            VStack(alignment: .leading, spacing: 3) {
              if let origin = state.snapshot?.origin ?? state.setup?["jiraBaseUrl"].string,
                let url = URL(
                  string: origin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                    + "/browse/" + row.id)
              {
                Link(row.id, destination: url).font(.system(size: 13, weight: .semibold))
                  .foregroundStyle(PV.accent)
              } else {
                Text(row.id).font(.system(size: 13, weight: .semibold))
              }
              Text(row.issue.title).font(.system(size: 11)).foregroundStyle(PV.secondary).lineLimit(
                1
              ).help(row.issue.title)
            }

          }.padding(.leading, CGFloat(row.depth * 14)).frame(
            width: max(40, leftWidth - 266), alignment: .leading
          )
          .focusable().focused($focusedCell, equals: row.id + "|0")
          .accessibilityLabel(row.id + " " + row.issue.title)
          Button {
            if state.matches(jira.client) {
              editingAssignee = false
              metadata = row.issue
            } else {
              message = "Connect to the Jira instance saved in this workspace."
            }
          } label: {
            Text(row.issue.status.uppercased()).font(.system(size: 10, weight: .bold)).lineLimit(1)
              .foregroundStyle(tint(row.issue)).padding(.horizontal, 8).padding(.vertical, 4)
              .background(tint(row.issue).opacity(0.1), in: RoundedRectangle(cornerRadius: 4))
          }.buttonStyle(.plain).frame(width: 116, alignment: .leading)
            .focusable()
            .focused($focusedCell, equals: row.id + "|1")
            .popover(isPresented: metadataBinding(row.id, assignee: false)) {
              ProductJiraMetadata(issue: row.issue, assignee: false, jira: jira) {
                pendingProposal = $0
              }
            }
          Button {
            if state.matches(jira.client) {
              editingAssignee = true
              metadata = row.issue
            } else {
              message = "Connect to the Jira instance saved in this workspace."
            }
          } label: {
            Text(row.issue.assignee ?? "Unassigned").font(.system(size: 12)).foregroundStyle(
              PV.secondary
            ).lineLimit(1)
          }.buttonStyle(.plain).frame(width: 150, alignment: .leading)
            .focusable()
            .focused($focusedCell, equals: row.id + "|2")
            .popover(isPresented: metadataBinding(row.id, assignee: true)) {
              ProductJiraMetadata(issue: row.issue, assignee: true, jira: jira) {
                pendingProposal = $0
              }
            }
        }.frame(height: 52).background(
          row.depth == 0 ? Color(hex: 0xf7f8fa) : .white
        ).overlay(alignment: .bottom) { PV.border.opacity(0.5).frame(height: 1) }.id(row.id)
      }
    }.onMoveCommand { direction in
      guard let value = focusedCell else { return }
      let parts = value.split(separator: "|")
      guard parts.count == 2, let row = rows.firstIndex(where: { $0.id == parts[0] }),
        let column = Int(parts[1])
      else { return }
      let nextRow: Int
      let nextColumn: Int
      switch direction {
      case .up:
        nextRow = max(0, row - 1)
        nextColumn = column
      case .down:
        nextRow = min(rows.count - 1, row + 1)
        nextColumn = column
      case .left:
        nextRow = row
        nextColumn = max(0, column - 1)
      case .right:
        nextRow = row
        nextColumn = min(2, column + 1)
      @unknown default: return
      }
      focusedCell = rows[nextRow].id + "|" + String(nextColumn)
    }
    .onKeyPress(keys: [.home, .end]) { press in
      guard let cell = focusedCell, let row = cell.split(separator: "|").first, !rows.isEmpty else {
        return .ignored
      }
      let start = press.key == .home
      let target =
        press.modifiers.contains(.control) ? (start ? rows.first!.id : rows.last!.id) : String(row)
      focusedCell = target + (start ? "|0" : "|2")
      return .handled
    }
    .onKeyPress(KeyEquivalent("\u{F705}")) {
      guard let cell = focusedCell else { return .ignored }
      let parts = cell.split(separator: "|")
      guard parts.count == 2, parts[1] != "0", state.matches(jira.client),
        let issue = issues.first(where: { $0.key == parts[0] })
      else { return .ignored }
      editingAssignee = parts[1] == "2"
      metadata = issue
      return .handled
    }
    .onKeyPress(.escape) {
      metadata = nil
      dependencyStart = nil
      pendingSchedule = nil
      return .handled
    }
  }

  private func metadataBinding(_ key: String, assignee: Bool) -> Binding<Bool> {
    Binding(
      get: { metadata?.key == key && editingAssignee == assignee },
      set: { if !$0 { metadata = nil } })
  }
  private var timeline: some View {
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        ForEach(headerGroups, id: \.offset) { item in
          Text(item.label).font(.system(size: 10, weight: .semibold)).foregroundStyle(PV.secondary)
            .padding(.leading, 8).frame(
              width: Double(item.days) * zoom, height: 48, alignment: .leading
            )
            .overlay(alignment: .trailing) { PV.border.frame(width: 1) }
        }
      }.background(PV.background)
      ZStack(alignment: .topLeading) {
        LazyVStack(spacing: 0) { ForEach(rows) { row in timelineRow(row.issue) } }
        dependencyLines.allowsHitTesting(false)
        dependencyControls
      }.coordinateSpace(name: "gantt-grid")
    }.frame(width: Double(count) * zoom)
      .overlay(alignment: .topLeading) {
        Rectangle().fill(Color(hex: 0xe04444)).frame(width: 2)
          .offset(x: Double(TimelineDates.dayOffset(Date(), from: origin)) * zoom)
          .allowsHitTesting(false).accessibilityLabel("Today, " + TimelineDates.string(Date()))
      }
  }
  private var headerGroups: [(offset: Int, days: Int, label: String)] {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US")
    formatter.timeZone = calendar.timeZone
    formatter.dateFormat = zoom == 10 ? "MMM yyyy" : "MMM d"
    let starts = (0..<count).filter { offset in
      let date = origin.addingTimeInterval(Double(offset) * 86400)
      return offset == 0 || zoom == 40
        || (zoom == 24
          ? calendar.component(.weekday, from: date) == 2
          : calendar.component(.day, from: date) == 1)
    }
    return starts.enumerated().map { index, offset in
      let date = origin.addingTimeInterval(Double(offset) * 86400)
      return (
        offset, (index + 1 < starts.count ? starts[index + 1] : count) - offset,
        zoom == 40 ? String(TimelineDates.string(date).suffix(5)) : formatter.string(from: date)
      )
    }
  }
  private func timelineRow(_ issue: WorkspaceIssue) -> some View {
    let entry = model[issue.key]
    return ZStack(alignment: .leading) {
      Canvas { context, size in
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        for day in 0..<count {
          let date = origin.addingTimeInterval(Double(day) * 86400)
          let weekday = calendar.component(.weekday, from: date) - 1
          let rect = CGRect(x: Double(day) * zoom, y: 0, width: zoom, height: size.height)
          context.fill(
            Path(rect),
            with: .color(
              (state.preferences.nonWorkingDays ?? [0, 6]).contains(weekday)
                ? Color(hex: 0xf3f5f8) : .white))
          var line = Path()
          line.move(to: CGPoint(x: rect.maxX, y: 0))
          line.addLine(to: CGPoint(x: rect.maxX, y: size.height))
          context.stroke(line, with: .color(PV.border.opacity(0.25)), lineWidth: 1)
        }
      }.frame(width: Double(count) * zoom, height: 52).contentShape(Rectangle())
        .onTapGesture { location in
          guard entry?.state == "unscheduled" else { return }
          guard state.matches(jira.client) else {
            message = "Jira editing is not available for this board."
            return
          }
          let day = max(0, min(count - 1, Int(location.x / zoom)))
          let value = TimelineDates.string(origin.addingTimeInterval(Double(day) * 86400))
          if let pendingSchedule, pendingSchedule.key == issue.key {
            applySchedule(
              issue.key, start: min(pendingSchedule.date, value),
              end: max(pendingSchedule.date, value))
            self.pendingSchedule = nil
          } else {
            pendingSchedule = (issue.key, value)
          }
        }

      if let entry, entry.state != "unscheduled", let start = TimelineDates.parse(entry.start),
        let end = TimelineDates.parse(entry.end)
      {
        let left = Double(TimelineDates.dayOffset(start, from: origin)) * zoom
        let width = Double(TimelineDates.dayOffset(end, from: start) + 1) * zoom
        ProductTaskBar(
          key: issue.key, color: tint(issue), width: max(zoom, width), progress: entry.progress,
          zoom: zoom, start: entry.start, end: entry.end,
          canMove: state.matches(jira.client) && entry.startSource == "jira"
            && entry.endSource == "jira",
          canStart: state.matches(jira.client) && entry.startSource == "jira",
          canEnd: state.matches(jira.client) && entry.endSource == "jira",
          rollup: entry.state == "rollup",
          conflict: externalConflicts.contains { $0.issueKey == issue.key },
          onMove: { delta in changeDates(issue, start: start, end: end, delta: delta, edge: 0) },
          onStart: { delta in changeDates(issue, start: start, end: end, delta: delta, edge: -1) },
          onEnd: { delta in changeDates(issue, start: start, end: end, delta: delta, edge: 1) },
          onLink: { finish in link(issue.key, finish: finish) },
          onDependencyDrag: { sourceFinish, location in
            let index = Int(location.y / 52)
            guard rows.indices.contains(index) else { return }
            let target = rows[index].issue.key
            guard target != issue.key, let entry = model[target],
              let start = TimelineDates.parse(entry.start), let end = TimelineDates.parse(entry.end)
            else { return }
            let startX = Double(TimelineDates.dayOffset(start, from: origin)) * zoom
            let endX = Double(TimelineDates.dayOffset(end, from: origin) + 1) * zoom
            let finish = abs(location.x - endX) < abs(location.x - startX)
            guard min(abs(location.x - startX), abs(location.x - endX)) <= 18 else { return }
            dependencyStart = (issue.key, sourceFinish)
            link(target, finish: finish)
          }
        ).offset(x: left)
      } else {
        Text(
          pendingSchedule?.key == issue.key
            ? "Choose the second date" : "Unscheduled — click twice to set dates"
        ).font(.system(size: 11)).foregroundStyle(
          PV.secondary
        ).padding(.leading, 12).allowsHitTesting(false)
      }
    }.frame(height: 52).overlay(alignment: .bottom) { PV.border.opacity(0.5).frame(height: 1) }
  }
  private func changeDates(_ issue: WorkspaceIssue, start: Date, end: Date, delta: Int, edge: Int) {
    guard delta != 0 else { return }
    let a = start.addingTimeInterval(Double(edge == 1 ? 0 : delta) * 86400)
    let b = end.addingTimeInterval(Double(edge == -1 ? 0 : delta) * 86400)
    guard a <= b else {
      message = "End date must not precede start date."
      return
    }
    guard let entry = model[issue.key], edge == 1 || entry.startSource == "jira",
      edge == -1 || entry.endSource == "jira"
    else {
      message = "Dragging requires the edited dates to be Jira fields. Set explicit dates first."
      return
    }
    applySchedule(issue.key, start: TimelineDates.string(a), end: TimelineDates.string(b))
  }
  private func applySchedule(_ key: String, start: String, end: String) {
    do {
      let updates = try TimelineCascade.plan(
        schedule: model, order: issues.map(\.key), links: state.links, changedKey: key,
        start: start, end: end, nonWorkingDays: Set(state.preferences.nonWorkingDays ?? [0, 6]))
      guard state.matches(jira.client) else {
        message = "Jira editing is not available for this board."
        return
      }
      Task { await reviewSchedule(updates) }
    } catch { message = "Could not plan schedule: " + error.localizedDescription }
  }
  private func reviewSchedule(_ updates: [TimelineCascade.Update]) async {
    guard state.matches(jira.client), let client = jira.client, let user = jira.user else {
      message = "Connect to the Jira instance saved in this workspace."
      return
    }
    guard !preparing && !saving, let snapshot = state.snapshot else { return }
    let identity = state.identity
    let startField = snapshot.startField ?? ""
    let dueField = snapshot.dueField ?? ""
    preparing = true
    defer { preparing = false }
    do {
      var parts: [JiraWriteProposal] = []
      for update in updates {
        let context = try await client.dateEditContext(
          key: update.issueKey, startField: startField, dueField: dueField)
        parts.append(
          try .dates(
            origin: client.connection.origin, authorID: user.accountId, role: .coordinator,
            context: context, start: update.startDate, due: update.dueDate))
      }
      guard state.identity == identity, state.matches(jira.client),
        jira.user?.accountId == user.accountId
      else { return }
      proposal = try .combiningDateChanges(parts)
    } catch { message = "Could not prepare Jira schedule update: " + error.localizedDescription }
  }

  private func link(_ key: String, finish: Bool) {
    guard let source = dependencyStart else {
      dependencyStart = (key, finish)
      return
    }
    let kind: TimelineLinkKind = source.1 ? (finish ? .FF : .FS) : (finish ? .SF : .SS)
    let next = TimelineLink(predecessor: source.0, successor: key, kind: kind)
    if let error = TimelineLinks.validate(
      next, existing: state.links, issues: issues, plans: state.plans)
    {
      message = error
    } else {
      state.addDependency(next, schedule: model)
      message = ""
    }
    dependencyStart = nil
  }
  private var dependencyLines: some View {
    Canvas { context, _ in
      let index = Dictionary(
        uniqueKeysWithValues: rows.enumerated().map { ($0.element.id, $0.offset) })
      for link in state.links {
        guard let from = index[link.predecessor], let to = index[link.successor],
          let a = model[link.predecessor], let b = model[link.successor], a.state != "unscheduled",
          b.state != "unscheduled",
          let start = TimelineDates.parse(link.kind == .FS || link.kind == .FF ? a.end : a.start),
          let end = TimelineDates.parse(link.kind == .FF || link.kind == .SF ? b.end : b.start)
        else { continue }
        let x =
          Double(
            TimelineDates.dayOffset(start, from: origin)
              + (link.kind == .FS || link.kind == .FF ? 1 : 0)) * zoom
        let y = Double(from) * 52 + 26
        let target =
          Double(
            TimelineDates.dayOffset(end, from: origin)
              + (link.kind == .FF || link.kind == .SF ? 1 : 0)) * zoom
        let ty = Double(to) * 52 + 26
        var path = Path()
        path.move(to: .init(x: x, y: y))
        path.addLine(to: .init(x: x + 10, y: y))
        path.addLine(to: .init(x: x + 10, y: ty))
        path.addLine(to: .init(x: target, y: ty))
        let conflicting = externalConflicts.contains {
          $0.issueKey == link.predecessor || $0.issueKey == link.successor
        }
        let color =
          focusedDependency == link.id ? PV.accent : conflicting ? Color.red : PV.secondary
        context.stroke(
          path, with: .color(color), lineWidth: focusedDependency == link.id ? 2.5 : 1.5)
        let direction = target >= x + 10 ? 1.0 : -1.0
        var arrow = Path()
        arrow.move(to: .init(x: target - 6 * direction, y: ty - 4))
        arrow.addLine(to: .init(x: target, y: ty))
        arrow.addLine(to: .init(x: target - 6 * direction, y: ty + 4))
        context.stroke(arrow, with: .color(color), lineWidth: 1.5)

      }
    }
  }
  private struct DependencyMarker: Identifiable {
    let id: String
    let title: String
    let kind: String
    let x: Double
    let y: Double
  }
  private var dependencyMarkers: [DependencyMarker] {
    let index = Dictionary(
      uniqueKeysWithValues: rows.enumerated().map { ($0.element.id, $0.offset) })
    var occupied: [String: Int] = [:]
    return state.links.compactMap { edge in
      guard let row = index[edge.successor], let entry = model[edge.successor],
        entry.state != "unscheduled"
      else { return nil }
      let finish = edge.kind == .FF || edge.kind == .SF
      guard let date = TimelineDates.parse(finish ? entry.end : entry.start) else { return nil }
      let x = Double(TimelineDates.dayOffset(date, from: origin) + (finish ? 1 : 0)) * zoom
      let group = edge.successor + (finish ? "|end" : "|start")
      let slot = occupied[group, default: 0]
      occupied[group] = slot + 1
      return DependencyMarker(
        id: edge.id, title: edge.predecessor + " → " + edge.successor, kind: edge.kind.rawValue,
        x: max(0, x - 32 - Double(slot) * 30), y: Double(row) * 52 + 3)
    }
  }
  private func removeDependency(_ id: String) {
    state.links.removeAll { $0.id == id }
    if focusedDependency == id { focusedDependency = nil }
  }
  private var dependencyControls: some View {
    ZStack(alignment: .topLeading) {
      ForEach(dependencyMarkers) { marker in
        dependencyControl(marker)
      }
    }.frame(width: Double(count) * zoom, height: Double(rows.count) * 52, alignment: .topLeading)
  }
  private func dependencyControl(_ marker: DependencyMarker) -> some View {
    let label = Text(marker.kind).font(.system(size: 10, weight: .semibold))
      .foregroundStyle(focusedDependency == marker.id ? PV.accent : PV.secondary)
      .padding(.horizontal, 4).padding(.vertical, 2)
      .background(.white, in: RoundedRectangle(cornerRadius: 3))
      .overlay(
        RoundedRectangle(cornerRadius: 3).stroke(
          focusedDependency == marker.id ? PV.accent : PV.border))
    let control = label.focusable().focused($focusedDependency, equals: marker.id)
      .onTapGesture(count: 2) { removeDependency(marker.id) }
      .onTapGesture { focusedDependency = marker.id }
      .onDeleteCommand { removeDependency(marker.id) }
    return control.contextMenu { Button("Remove dependency") { removeDependency(marker.id) } }
      .help(
        marker.title + " (" + marker.kind + "). Select and press Delete, or double-click to remove."
      )
      .accessibilityLabel(marker.title + ", " + marker.kind + " dependency")
      .offset(x: marker.x, y: marker.y)
  }
  private func refreshAfterWrite(_ results: [JiraWriteResult], operations: [JiraWriteOperation])
    async
  {
    guard state.matches(jira.client), let client = jira.client, let previous = state.snapshot else {
      return
    }
    let identity = state.identity
    do {
      let next = try await client.loadWorkspace(
        boardID: previous.boardID, boardName: previous.boardName, jql: previous.jql,
        startField: previous.startField ?? "",
        dueField: previous.dueField ?? "", fieldMapping: previous.fieldMapping ?? [:])
      guard state.identity == identity, state.matches(jira.client) else { return }
      for result in results where result.outcome == .succeeded {
        state.plans[result.targetKey] = nil
        if operations.contains(where: {
          $0.targetKey == result.targetKey && $0.before?["startField"].string != nil
        }), let issue = next.issues.first(where: { $0.key == result.targetKey }) {
          var accepted = state.reconciledDates ?? [:]
          accepted[issue.key] = .init(start: issue.start, due: issue.due, dependencies: [])
          state.reconciledDates = accepted
        }
      }
      state.activate(next, setup: state.setup)
      message =
        results.allSatisfy { $0.outcome == .succeeded }
        ? "Saved. Workspace refreshed from Jira."
        : "Some operations did not succeed. Workspace refreshed; inspect each result."
    } catch { message = "Could not verify current Jira state: " + error.localizedDescription }
  }

}
private struct ProductTaskBar: View {
  let key: String, color: Color, width: Double, progress: Double, zoom: Double
  let start: String, end: String
  let canMove: Bool, canStart: Bool, canEnd: Bool, rollup: Bool, conflict: Bool
  var onMove: (Int) -> Void, onStart: (Int) -> Void, onEnd: (Int) -> Void, onLink: (Bool) -> Void
  var onDependencyDrag: (Bool, CGPoint) -> Void
  private struct Preview {
    let edge: Int
    let days: Int
  }
  @GestureState private var preview: Preview?
  private var deltaStart: Int { preview?.edge == 1 ? 0 : preview?.days ?? 0 }
  private var deltaEnd: Int { preview?.edge == -1 ? 0 : preview?.days ?? 0 }
  private var allowed: Bool {
    guard let preview else { return true }
    let sourceAllowed = preview.edge == 0 ? canMove : preview.edge == -1 ? canStart : canEnd
    return sourceAllowed && width / zoom + Double(deltaEnd - deltaStart) >= 1
  }
  private var displayedWidth: Double {
    max(18, width + (allowed ? Double(deltaEnd - deltaStart) * zoom : 0))
  }
  private func date(_ value: String, days: Int) -> String {
    TimelineDates.parse(value).map {
      TimelineDates.string($0.addingTimeInterval(Double(days) * 86400))
    } ?? value
  }
  private func drag(edge: Int) -> some Gesture {
    DragGesture(coordinateSpace: .named("gantt-grid")).updating($preview) { value, state, _ in
      state = Preview(edge: edge, days: Int((value.translation.width / zoom).rounded()))
    }.onEnded { value in
      let days = Int((value.translation.width / zoom).rounded())
      guard edge == 0 ? canMove : edge == -1 ? canStart : canEnd,
        width / zoom + Double(edge == 0 ? 0 : edge == 1 ? days : -days) >= 1
      else { return }
      if edge == 0 { onMove(days) } else if edge == -1 { onStart(days) } else { onEnd(days) }
    }
  }
  private func handle(finish: Bool) -> some View {
    Circle().fill(Color(hex: 0x2d5ea8)).overlay(Circle().stroke(.white, lineWidth: 2)).frame(
      width: 10, height: 10
    )
    .frame(width: 24, height: 24, alignment: finish ? .leading : .trailing).contentShape(
      Rectangle()
    )
    .onTapGesture { onLink(finish) }
    .simultaneousGesture(
      DragGesture(minimumDistance: 3, coordinateSpace: .named("gantt-grid")).onEnded { value in
        onDependencyDrag(finish, value.location)
      }
    )
    .help(
      finish ? "Drag to create a dependency from finish" : "Drag to create a dependency from start"
    )
    .accessibilityLabel(key + (finish ? " finish dependency handle" : " start dependency handle"))
  }
  var body: some View {
    ZStack(alignment: .leading) {
      RoundedRectangle(cornerRadius: rollup ? 4 : 6).fill(color.opacity(0.55))
      RoundedRectangle(cornerRadius: rollup ? 4 : 6).fill(color).frame(
        width: displayedWidth * max(0, min(100, progress)) / 100)
      HStack(spacing: 0) {
        if !rollup {
          Color.clear.frame(width: 8).contentShape(Rectangle()).gesture(drag(edge: -1))
            .accessibilityLabel("Resize start of " + key)
        }
        Text(key).font(.system(size: 10, weight: .semibold)).lineLimit(1).frame(
          maxWidth: .infinity, maxHeight: .infinity
        )
        .contentShape(Rectangle()).gesture(drag(edge: 0), including: rollup ? .none : .all)
        .accessibilityLabel("Move " + key)
        if !rollup {
          Color.clear.frame(width: 8).contentShape(Rectangle()).gesture(drag(edge: 1))
            .accessibilityLabel("Resize end of " + key)
        }
      }.foregroundStyle(.white)
    }.frame(width: displayedWidth, height: 32)
      .overlay(
        RoundedRectangle(cornerRadius: 6).stroke(
          conflict || !allowed ? Color(hex: 0xe04444) : Color.clear, lineWidth: 2)
      )
      .shadow(color: PV.ink.opacity(0.18), radius: 3, y: 2)
      .overlay(alignment: .leading) { if !rollup { handle(finish: false).offset(x: -24) } }
      .overlay(alignment: .trailing) { if !rollup { handle(finish: true).offset(x: 24) } }
      .overlay(alignment: .top) {
        if preview != nil {
          Text(key + " · " + date(start, days: deltaStart) + " → " + date(end, days: deltaEnd))
            .font(.system(size: 10, weight: .semibold)).fixedSize().padding(5)
            .foregroundStyle(allowed ? PV.ink : Color(hex: 0xc9372c)).background(
              .white, in: RoundedRectangle(cornerRadius: 4)
            ).offset(y: -26)
        }
      }
      .offset(x: allowed ? Double(deltaStart) * zoom : 0)
      .help(key + " · " + start + " → " + end)
  }
}
