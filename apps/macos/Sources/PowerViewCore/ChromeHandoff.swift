import Foundation

public enum ChromeHandoffImporter {
  public static func decode(_ data: Data) throws -> Release {
    guard data.count <= 5 * 1024 * 1024 else { throw ReleaseError.unsupportedFormat }
    let value = try JSONDecoder().decode(JSONValue.self, from: data)
    guard value["version"] == .null || value["version"].number == 1 else {
      throw ReleaseError.unsupportedFormat
    }
    let origin: URL?
    if let rawOrigin = value["jiraBaseUrl"].string {
      guard let url = URL(string: rawOrigin), url.scheme == "https", url.host != nil,
        url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
        url.path.isEmpty || url.path == "/"
      else { throw JiraError.invalidOrigin }
      origin = url
    } else {
      origin = nil
    }
    guard let name = value["release"].string, case .array(let rawKeys) = value["keys"],
      case .object = value["drafts"], !rawKeys.isEmpty
    else { throw ReleaseError.unsupportedFormat }
    var keys: [String] = []
    var seen: Set<String> = []
    for raw in rawKeys {
      guard let key = raw.string,
        key.range(of: "^[A-Z][A-Z0-9_]*-[1-9][0-9]*$", options: .regularExpression) != nil
      else { throw ReleaseError.wrongProject }
      if seen.insert(key).inserted { keys.append(key) }
    }
    let project = String(keys[0].split(separator: "-")[0])
    guard keys.allSatisfy({ $0.hasPrefix(project + "-") }) else { throw ReleaseError.wrongProject }
    let coordinator = "chrome-coordinator"
    var release = try Release(
      name: name, teamName: "Команда з Chrome", projectKey: project,
      coordinator: .init(id: coordinator, name: "Координатор", role: .coordinator))
    var names: Set<String> = []
    for key in keys {
      let old = value["drafts"][key]
      let title =
        value["issues"].array.first(where: { $0["key"].string == key })?["summary"].string ?? key
      var story = Story(id: key, title: title.isEmpty ? key : title, requiresJiraEvidence: false)
      story.techLeadName = old["techLead"].string
      story.qaLeadName = old["qaLead"].string
      story.questions = old["questions"].string
      story.answers = old["answers"].string
      story.acceptanceCriteria = old["scope"].string ?? ""
      story.noOpenQuestions =
        (story.questions ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        || (old["questionsResolved"].boolean
          && !(story.answers ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      let days = old["days"].number ?? old["days"].string.flatMap(Double.init)
      let decomposition = old["decomposition"].string ?? ""
      if let days, days.isFinite, days > 0 {
        story.development = [.init(days: days, summary: decomposition)]
      }
      story.decompositionComplete =
        !story.development.isEmpty
        && !decomposition.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && !(story.techLeadName ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      story.tlApproved = old["scopeConfirmed"].boolean
      story.testPlan = old["testPlan"].string ?? ""
      story.testData = old["testData"].string ?? ""
      story.environment = old["environment"].string ?? ""
      story.testConditions = old["conditions"].string ?? ""
      if story.tlRequirements.isEmpty {
        try story.handoff(role: .techLead, canEdit: true)
        story.qaApproved =
          old["qaSubmitted"].boolean
          && !(story.qaLeadName ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if old["ready"].boolean && story.qaRequirements.isEmpty {
          try story.confirmReady(role: .qaLead, canEdit: true)
        }
      }
      try release.add(story, actorID: coordinator)
      if let origin {
        let raw: JSONValue = .object([
          "id": .string(String(keys.firstIndex(of: key)! + 1)), "key": .string(key),
          "fields": .object([
            "summary": .string(story.title), "updated": .string("imported-handoff"),
            "project": .object(["id": .string(project), "key": .string(project)]),
          ]),
        ])
        let issue = try JSONDecoder().decode(JiraIssue.self, from: JSONEncoder().encode(raw))
        try release.importIssue(issue, origin: origin, actorID: coordinator)
      }
      for (role, name) in [(Role.techLead, story.techLeadName), (Role.qaLead, story.qaLeadName)] {
        if let name, !name.isEmpty, names.insert(role.rawValue + "|" + name).inserted {
          try release.setMember(
            .init(id: "chrome-member-\(names.count)", name: name, role: role), actorID: coordinator)
        }
      }
    }
    release.chromeHandoffArchive = value
    return release
  }
}
