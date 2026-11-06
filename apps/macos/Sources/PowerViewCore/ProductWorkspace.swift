import Foundation

public struct ProductBoardArchive: Codable, Equatable, Sendable {
  public var estimation: ChromeEstimationBoard
  public var plans: [String: LocalIssuePlan]
  public var links: [TimelineLink]
  public var preferences: TimelinePreferences
  public var reconciledDates: [String: LocalIssuePlan]?
  public var importedConfiguration: JSONValue?
  public var setup: JSONValue?
  public var handoffPath: String?
  public var handoffFingerprint: String?
}
public struct ProductWorkspace: Codable, Equatable, Sendable {
  public var setup: JSONValue?
  public var handoffPath: String?
  public var handoffFingerprint: String?
  public var snapshot: WorkspaceSnapshot?
  public var estimation = ChromeEstimationBoard()
  public var plans: [String: LocalIssuePlan] = [:]
  public var links: [TimelineLink] = []
  public var preferences = Self.defaultPreferences
  public var savedBoards: [String: ProductBoardArchive]?
  public var reconciledDates: [String: LocalIssuePlan]?
  public var importedConfiguration: JSONValue?
  public init() {}
  public static var defaultPreferences: TimelinePreferences {
    var value = TimelinePreferences()
    value.hideDone = false
    value.dayWidth = 24
    return value
  }
  public static func scope(origin: String?, board: String) -> String {
    (origin?.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? "unbound") + "|" + board
  }
  public var identity: String? {
    guard let snapshot else { return nil }
    return Self.scope(
      origin: snapshot.origin ?? setup?["jiraBaseUrl"].string, board: snapshot.boardID)
  }
  public func matches(_ client: JiraClient?) -> Bool {
    guard let client, let expected = snapshot?.origin ?? setup?["jiraBaseUrl"].string else {
      return false
    }
    return expected.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      == client.connection.origin.absoluteString.trimmingCharacters(
        in: CharacterSet(charactersIn: "/"))
  }
  public mutating func activate(
    _ next: WorkspaceSnapshot, setup nextSetup: JSONValue?,
    preferences override: TimelinePreferences? = nil
  ) {
    let nextIdentity = Self.scope(
      origin: next.origin ?? nextSetup?["jiraBaseUrl"].string, board: next.boardID)
    if identity != nextIdentity {
      var saved = savedBoards ?? [:]
      if let identity {
        saved[identity] = .init(
          estimation: estimation, plans: plans, links: links, preferences: preferences,
          reconciledDates: reconciledDates, importedConfiguration: importedConfiguration,
          setup: setup, handoffPath: handoffPath, handoffFingerprint: handoffFingerprint)
      }
      savedBoards = saved
      let target = saved[nextIdentity]
      estimation = target?.estimation ?? .init()
      plans = target?.plans ?? [:]
      links = target?.links ?? []
      preferences = target?.preferences ?? Self.defaultPreferences
      reconciledDates = target?.reconciledDates
      handoffPath = target?.handoffPath
      handoffFingerprint = target?.handoffFingerprint
      importedConfiguration = target?.importedConfiguration
    }
    snapshot = next
    setup = nextSetup
    if let override { preferences = override }
  }
}

extension ProductWorkspace {
  public func exportPortableConfiguration(now: Date = Date()) throws -> JSONValue {
    guard let setup, let origin = setup["jiraBaseUrl"].string,
      let project = setup["project"]["key"].string, let board = setup["board"]["id"].identifier,
      setup["project"]["id"].string != nil, setup["project"]["name"].string != nil,
      let name = setup["board"]["name"].string
    else { throw ReleaseError.unsupportedFormat }
    var configuration = importedConfiguration?["configuration"].object ?? [:]
    var rawSetup = setup.object
    rawSetup["nonWorkingDays"] = .array(
      (preferences.nonWorkingDays ?? [0, 6]).map { .number(Double($0)) })
    let defaults: [String: Double] = [
      "subtask": 1, "task": 3, "bug": 3, "story": 5, "epic": 10, "unknown": 3,
    ]
    rawSetup["defaultDurations"] = .object(
      defaults.mapValues { .number($0) }.merging(
        (preferences.defaultDurations ?? [:]).mapValues(JSONValue.number)
      ) { _, new in new })
    rawSetup["updatedAt"] = .string(now.ISO8601Format())
    configuration["setup"] = .object(rawSetup)
    var filters =
      configuration["ganttFilters"]?.object ?? [
        "statuses": .array([]), "statusCategories": .array([]), "assignees": .array([]),
        "issueTypes": .array([]), "priorities": .array([]), "labels": .array([]),
        "dateFilters": .array([]), "riskFilters": .array([]), "logic": .string("and"),
        "includeDescendants": .bool(false),
      ]
    filters["search"] = .string(preferences.search)
    filters["excludeDone"] = .bool(preferences.hideDone)
    configuration["ganttFilters"] = .object(filters)
    let sorts: [TimelineSort: String] = [
      .rank: "default", .start: "startDate", .due: "endDate", .name: "name", .status: "status",
      .assignee: "assignee", .key: "issueKey",
    ]
    configuration["ganttViewPreferences"] = .object([
      "zoom": .string(
        preferences.dayWidth == 40 ? "day" : preferences.dayWidth == 10 ? "month" : "week"),
      "sortBy": .string(sorts[preferences.sort]!),
      "sortDirection": .string(preferences.ascending ? "asc" : "desc"),
    ])
    configuration["ganttBoardState"] = .object([
      "dependencies": .array(
        links.map { link in
          .object([
            "id": .string(link.id), "predecessorIssueKey": .string(link.predecessor),
            "successorIssueKey": .string(link.successor), "type": .string(link.kind.rawValue),
            "lagWorkingDays": .number(Double(link.lagWorkingDays ?? 0)),
          ])
        }),
      "reconciledDates": .object(
        (reconciledDates ?? [:]).mapValues { value in
          var dates: [String: JSONValue] = [:]
          if let start = value.start { dates["startDate"] = .string(start) }
          if let due = value.due { dates["dueDate"] = .string(due) }
          return .object(dates)
        }),
    ])
    return .object([
      "kind": .string("power-view-board-configuration"), "version": .number(1),
      "exportedAt": .string(now.ISO8601Format()),
      "board": .object([
        "jiraBaseUrl": .string(origin), "projectKey": .string(project), "boardId": .string(board),
        "boardName": .string(name),
      ]), "configuration": .object(configuration),
    ])
  }
}

extension ProductWorkspace {
  public mutating func addDependency(
    _ link: TimelineLink, schedule: [String: TimelineScheduleEntry]
  ) {
    links.append(link)
    var accepted = reconciledDates ?? [:]
    for key in [link.predecessor, link.successor] {
      guard let entry = schedule[key], entry.state != "unscheduled" else { continue }
      accepted[key] = .init(start: entry.start, due: entry.end, dependencies: [])
    }
    reconciledDates = accepted
  }
}
