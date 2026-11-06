import Foundation

/// Explicitly synthetic walkthrough data, bound to a reserved origin so it cannot target real Jira.
public enum ExampleRelease {
  public static func make() throws -> Release {
    var release = try Release(
      name: "Приклад — оцінка релізу", teamName: "Демонстраційна команда", projectKey: "DEMO",
      coordinator: .init(
        id: "example-coordinator", name: "Координатор (приклад)", role: .coordinator))
    try release.setMember(
      .init(id: "example-tl", name: "ТЛ (приклад)", role: .techLead), actorID: "example-coordinator"
    )
    try release.setMember(
      .init(id: "example-qa", name: "QA (приклад)", role: .qaLead), actorID: "example-coordinator")
    for (number, title, days) in [(1, "Вхід у кабінет", 3.0), (2, "Експорт замовлень", 5.0)] {
      let key = "DEMO-\(number)"
      var story = Story(id: key, title: title)
      story.acceptanceCriteria =
        "Користувач виконує дію; результат зберігається. Помилка показується зрозумілим повідомленням."
      story.definitionOfDone = "Код перевірено, сценарії успіху й помилки протестовано."
      story.noOpenQuestions = true
      story.tlApproved = true
      story.decompositionComplete = true
      story.development = [
        .init(
          jiraKey: "DEMO-\(number + 10)", days: days, recordedEstimateSeconds: Int(days * 28_800))
      ]
      try story.handoff(role: .techLead, canEdit: true)
      story.qaApproved = true
      story.testPlan = "Основний сценарій та обробка помилок"
      story.testData = "Штучні записи прикладу"
      story.environment = "Демонстраційне середовище"
      story.testConditions = "Авторизований і неавторизований користувач"
      story.qaTask = .init(
        jiraKey: "DEMO-\(number + 20)", days: story.qaDays,
        recordedEstimateSeconds: Int((story.qaDays * 28_800).rounded()))
      story.recordedStoryEstimateSeconds = story.originalEstimateSeconds
      try story.confirmReady(role: .qaLead, canEdit: true)
      try release.add(story, actorID: "example-coordinator")
      let json: JSONValue = .object([
        "id": .string(String(number)), "key": .string(key),
        "fields": .object([
          "summary": .string(title), "updated": .string("2026-10-19T00:00:00Z"),
          "project": .object(["id": .string("example"), "key": .string("DEMO")]),
        ]),
      ])
      let issue = try JSONDecoder().decode(JiraIssue.self, from: JSONEncoder().encode(json))
      try release.importIssue(
        issue, origin: URL(string: "https://example.powerview.invalid")!,
        actorID: "example-coordinator")
    }
    return release
  }
}
