import { describe, expect, it } from "vitest";
import type { GeneratedReportSnapshot, PersonReportBlock } from "@power-view/domain";

import { renderStandupText } from "./standup";

function makePerson(overrides: Partial<PersonReportBlock> = {}): PersonReportBlock {
  return {
    user: { id: "u1", displayName: "Alice" },
    assignedIssues: [],
    createdIssues: [],
    completedIssues: [],
    reopenedIssues: [],
    changes: [],
    authoredWorklogs: [],
    worklogSeconds: 0,
    ...overrides,
  };
}

function makeSnapshot(people: PersonReportBlock[]): GeneratedReportSnapshot {
  return {
    schemaVersion: 1,
    id: "report-1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    generatorVersion: "0.2.1",
    jira: { baseUrl: "https://example.atlassian.net", deploymentType: "cloud" },
    request: {
      type: "daily",
      boardId: "10",
      scope: { kind: "team" },
      period: {
        timeZone: "Europe/Kyiv",
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-01-02T00:00:00.000Z",
        dataCutoff: "2026-01-02T00:00:00.000Z",
      },
    },
    board: { id: "10", name: "Alpha", type: "scrum", projectKeys: ["AL"] },
    statusMapping: {
      schemaVersion: 1,
      jiraBaseUrl: "https://example.atlassian.net",
      boardId: "10",
      completedStatusIds: ["6"],
      completedStatusNames: ["Done"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    issues: [],
    changes: [],
    worklogs: [],
    result: {
      executiveSummary: {
        totalIssues: 0,
        completedIssues: 0,
        incompleteIssues: 0,
        createdIssues: 0,
        completedDuringPeriod: 0,
        reopenedDuringPeriod: 0,
        totalTimeSpentSeconds: 0,
        worklogSeconds: 0,
        unassignedIssues: 0,
      },
      people,
      unassigned: { issues: [], changes: [] },
      activity: [],
    },
    completeness: { complete: true, issueCount: 0, truncated: false, warnings: [] },
  };
}

describe("renderStandupText", () => {
  it("includes a changed-issues breakdown for a person with changes", () => {
    const person = makePerson({
      changes: [
        {
          id: "evt-1",
          type: "status-changed",
          issueId: "1",
          issueKey: "AL-1",
          occurredAt: "2026-01-01T12:00:00.000Z",
          actor: { id: "u1", displayName: "Alice" },
          from: "To Do",
          to: "In Progress",
        },
      ],
    });
    const text = renderStandupText(makeSnapshot([person]), "en");
    expect(text).toContain("Changed issues:");
    expect(text).toContain("AL-1");
    expect(text).toContain('set status to "In Progress"');
  });

  it("omits the changed-issues header for a person with no changes", () => {
    const person = makePerson({ changes: [] });
    const text = renderStandupText(makeSnapshot([person]), "en");
    expect(text).not.toContain("Changed issues:");
  });
});
