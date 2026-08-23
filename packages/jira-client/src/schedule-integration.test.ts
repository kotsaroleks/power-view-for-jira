import { buildGanttScheduleModel } from "@power-view/domain";
import { makeJiraScheduleFixtures } from "@power-view/test-fixtures";
import { describe, expect, it } from "vitest";

import { mapJiraIssue } from "./mappers";
import { rawJiraIssueSchema } from "./schemas";

describe("Jira issue to schedule integration", () => {
  it("maps sanitized hierarchy fixtures into deterministic Gantt tasks", () => {
    const issues = makeJiraScheduleFixtures().map((fixture) =>
      mapJiraIssue(rawJiraIssueSchema.parse(fixture), {
        baseUrl: "https://fixture.atlassian.net",
        fieldMapping: {
          startDateFieldId: "customfield_10010",
          hierarchyFieldId: "customfield_10014",
        },
      }),
    );

    const model = buildGanttScheduleModel(issues, { today: "2026-01-15" });
    const tasks = new Map(model.tasks.map((task) => [task.issueKey, task]));

    expect(model.tasks).toHaveLength(6);
    expect(model.roots.map((root) => root.issue.key)).toEqual([
      "POWER-999",
      "POWER-1",
      "POWER-4",
    ]);
    expect(tasks.get("POWER-999")).toMatchObject({
      id: "29999",
      isHierarchyPlaceholder: true,
      expanded: true,
    });
    expect(tasks.get("POWER-5")?.parentId).toBe("29999");
    expect(tasks.get("POWER-2")?.parentId).toBe("20001");
    expect(tasks.get("POWER-3")?.parentId).toBe("20002");
    expect(tasks.get("POWER-2")?.dependencies).toEqual(["20004"]);
    expect(tasks.get("POWER-1")).toMatchObject({
      start: "2026-02-02",
      end: "2026-02-12",
      isSyntheticDate: true,
    });
    expect(model.warnings.map((warning) => warning.code)).toEqual(["INVALID_START_DATE"]);
  });
});
