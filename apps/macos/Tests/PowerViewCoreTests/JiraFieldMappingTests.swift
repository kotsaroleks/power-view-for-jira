import Testing

@testable import PowerViewCore

@Test func fieldMappingUsesOriginalChromePreferredIDsAndRankedTenantFields() {
  func field(_ id: String, _ title: String, _ type: String) -> JSONValue {
    .object(["id": .string(id), "name": .string(title), "schema": .object(["type": .string(type)])])
  }
  let fields = [
    field("customfield_20", "Target Start", "date"),
    field("customfield_21", "Planned_start", "datetime"),
    field("customfield_22", "Start date", "string"), field("due", "End date", "date"),
    field("epic", "Epic Link", "string"),
  ]
  #expect(
    JiraFieldMapping.infer(fields) == [
      "startDateFieldId": "customfield_21", "endDateFieldId": "due", "hierarchyFieldId": "epic",
    ])
  let preferred =
    fields + [
      field("customfield_10015", "Tenant renamed start", "date"),
      field("duedate", "Due date", "date"),
    ]
  #expect(JiraFieldMapping.infer(preferred)["startDateFieldId"] == "customfield_10015")
  #expect(JiraFieldMapping.infer(preferred)["endDateFieldId"] == "duedate")
  #expect(
    JiraFieldMapping.validate(
      [
        "startDateFieldId": "customfield_22", "endDateFieldId": "customfield_22",
        "storyPointsFieldId": "epic", "sprintFieldId": "missing",
      ], fields: fields
    ).count == 5)
}
