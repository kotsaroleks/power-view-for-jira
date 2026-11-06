import Foundation

public enum JiraFieldMapping {
  private static func name(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      .replacingOccurrences(of: "[_-]+", with: " ", options: .regularExpression)
      .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
  }
  private static func isDate(_ field: JSONValue) -> Bool {
    ["date", "datetime"].contains(field["schema"]["type"].string?.lowercased() ?? "")
  }
  public static func infer(_ fields: [JSONValue]) -> [String: String] {
    func ranked(_ start: Bool) -> String? {
      let exact: [String: Double] =
        start
        ? [
          "start date": 1, "planned start": 0.96, "target start": 0.93, "actual start": 0.88,
          "start time": 0.82,
        ]
        : [
          "end date": 1, "planned end": 0.96, "target end": 0.93, "due date": 0.9,
          "resolution date": 0.7,
        ]
      return fields.compactMap { field -> (String, String, Double)? in
        guard isDate(field), let id = field["id"].string else { return nil }
        let title = field["name"].plainText
        let normalized = name(title)
        let score: Double? =
          !start && id == "duedate"
          ? 0.98
          : exact[normalized]
            ?? (normalized.range(
              of: start ? "\\bstart\\b" : "\\b(end|due|finish)\\b", options: .regularExpression)
              != nil ? 0.7 : nil)
        return score.map { (id, title, $0) }
      }.sorted { $0.2 == $1.2 ? $0.1.localizedCompare($1.1) == .orderedAscending : $0.2 > $1.2 }
        .first?.0
    }
    var mapping: [String: String] = [:]
    mapping["startDateFieldId"] =
      fields.first { $0["id"].string == "customfield_10015" }?["id"].string ?? ranked(true)
    mapping["endDateFieldId"] =
      fields.first { $0["id"].string == "duedate" }?["id"].string ?? ranked(false)
    let epic =
      fields.first { $0["schema"]["custom"].plainText.lowercased().contains("gh-epic-link") }
      ?? fields.first { field in
        name(field["name"].plainText) == "epic link"
          || field["clauseNames"].array.contains { name($0.plainText) == "epic link" }
      }
    mapping["hierarchyFieldId"] = epic?["id"].string
    return mapping
  }
  public static func validate(_ mapping: [String: String], fields: [JSONValue]) -> [String] {
    var errors: [String] = []
    for (label, key) in [
      ("Start date", "startDateFieldId"), ("End date", "endDateFieldId"),
      ("Hierarchy", "hierarchyFieldId"), ("Story points", "storyPointsFieldId"),
      ("Sprint", "sprintFieldId"),
    ] {
      guard let id = mapping[key], !id.isEmpty else { continue }
      guard let field = fields.first(where: { $0["id"].string == id }) else {
        errors.append(label + " field is no longer available in Jira.")
        continue
      }
      if ["startDateFieldId", "endDateFieldId"].contains(key), !isDate(field) {
        errors.append(label + " must use a Jira date or date-time field.")
      }
      if key == "storyPointsFieldId", field["schema"]["type"].plainText.lowercased() != "number" {
        errors.append("Story points must use a numeric Jira field.")
      }
      if key == "sprintFieldId", name(field["name"].plainText) != "sprint",
        !(field["schema"]["type"].plainText.lowercased() == "array"
          && field["schema"]["custom"].plainText.lowercased().contains("gh-sprint"))
      {
        errors.append("Sprint must use Jira's Sprint field.")
      }
    }
    if let start = mapping["startDateFieldId"], !start.isEmpty, start == mapping["endDateFieldId"] {
      errors.append("Start and end dates must use different fields.")
    }
    return errors
  }
}
