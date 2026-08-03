import { describe, expect, it } from "vitest";

import { buildDailyPeriod, buildWeeklyPeriod, calculateReportResult } from "./index";
import type { BoardReportConfiguration, ReportingIssueSnapshot } from "./reporting";

const mapping: BoardReportConfiguration = {
  schemaVersion: 1,
  jiraBaseUrl: "https://example.atlassian.net",
  boardId: "1",
  completedStatusIds: ["done"],
  completedStatusNames: ["Done"],
  updatedAt: "2026-08-01T10:00:00.000Z",
};

const issue = (
  id: string,
  statusId: string,
  assigneeId?: string,
): ReportingIssueSnapshot => ({
  id,
  key: `POWER-${id}`,
  browseUrl: `https://example.atlassian.net/browse/POWER-${id}`,
  summary: `Issue ${id}`,
  issueType: { id: "10001", name: "Task" },
  status: { id: statusId, name: statusId === "done" ? "Done" : "Open" },
  ...(assigneeId ? { assignee: { id: assigneeId, displayName: "Ada" } } : {}),
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  sprintIds: [],
});

describe("reporting domain", () => {
  it("uses Kyiv 08:00 boundaries for daily and Monday weekly periods", () => {
    const daily = buildDailyPeriod("2026-08-03", "2026-08-03T10:00:00.000Z");
    const weekly = buildWeeklyPeriod("2026-08-05", "2026-08-05T10:00:00.000Z");
    expect(daily.start).toBe("2026-08-02T05:00:00.000Z");
    expect(daily.end).toBe("2026-08-03T05:00:00.000Z");
    expect(weekly.start).toBe("2026-08-03T05:00:00.000Z");
    expect(weekly.end).toBe("2026-08-10T05:00:00.000Z");
  });

  it("builds people, unassigned and activity metrics", () => {
    const result = calculateReportResult({
      issues: [issue("1", "done", "ada"), issue("2", "open")],
      changes: [
        {
          id: "c1",
          issueId: "1",
          issueKey: "POWER-1",
          type: "issue-completed",
          occurredAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      worklogs: [],
      period: buildDailyPeriod("2026-08-02", "2026-08-02T10:00:00.000Z"),
      type: "daily",
      scope: { kind: "team" },
      statusMapping: mapping,
    });
    expect(result.executiveSummary).toMatchObject({
      totalIssues: 2,
      completedIssues: 1,
      completedDuringPeriod: 1,
      unassignedIssues: 1,
    });
    expect(result.people[0]?.user.id).toBe("ada");
    expect(result.unassigned.issues).toHaveLength(1);
  });
});
