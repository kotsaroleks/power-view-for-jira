import { describe, expect, it } from "vitest";

import { mapReportingIssue } from "./reporting-mappers";

describe("mapReportingIssue", () => {
  it("maps the parent issue id and key when present", () => {
    const issue = mapReportingIssue(
      {
        id: "101",
        key: "POWER-101",
        fields: {
          summary: "Subtask under a Task",
          issuetype: { id: "10003", name: "Subtask" },
          status: { id: "1", name: "To Do" },
          parent: { id: "100", key: "POWER-100" },
        },
      },
      "https://example.atlassian.net",
    );

    expect(issue.parentId).toBe("100");
    expect(issue.parentKey).toBe("POWER-100");
  });

  it("omits parent fields when the issue has no parent", () => {
    const issue = mapReportingIssue(
      {
        id: "100",
        key: "POWER-100",
        fields: {
          summary: "A top-level Story",
          issuetype: { id: "10001", name: "Story" },
          status: { id: "1", name: "To Do" },
        },
      },
      "https://example.atlassian.net",
    );

    expect(issue.parentId).toBeUndefined();
    expect(issue.parentKey).toBeUndefined();
  });
});
