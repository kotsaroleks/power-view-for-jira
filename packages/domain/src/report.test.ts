import type { NormalizedIssue } from "./jira-issue";
import {
  buildBoardHealthReport,
  buildSprintHealthReport,
  reportPercentage,
} from "./report";

import { describe, expect, it } from "vitest";

function issue(
  key: string,
  category: NormalizedIssue["status"]["category"],
  options: Partial<NormalizedIssue> = {},
): NormalizedIssue {
  return {
    id: key,
    key,
    browseUrl: `https://jira.example.test/browse/${key}`,
    summary: key,
    issueType: { id: "task", name: "Task", subtask: false },
    status: {
      name: category === "done" ? "Done" : "Open",
      ...(category === undefined ? {} : { category }),
    },
    project: { id: "1", key: "POWER" },
    labels: [],
    components: [],
    fixVersions: [],
    issueLinks: [],
    rawFieldPresence: {
      hasStartDate: false,
      hasDueDate: false,
      hasParent: false,
      hasEpic: false,
    },
    ...options,
  };
}

const activeSprint = {
  id: "101",
  name: "Sprint 8.1",
  state: "active" as const,
  boardId: "7",
  startDate: "2026-08-01T00:00:00.000Z",
  endDate: "2026-08-14T00:00:00.000Z",
};

describe("report metrics", () => {
  it("keeps status and planning axes separate", () => {
    const result = buildBoardHealthReport(
      [
        issue("POWER-1", "done", { resolvedAt: "2026-08-02T10:00:00.000Z" }),
        issue("POWER-2", "in-progress", {
          assignee: { displayName: "Alex", accountId: "alex" },
          sprints: [activeSprint],
        }),
        issue("POWER-3", "to-do", {
          sprints: [{ id: "102", name: "Future", state: "future" }],
        }),
        issue("POWER-4", "to-do"),
      ],
      {
        now: new Date("2026-08-03T12:00:00.000Z"),
        sprintDataAvailable: true,
      },
    );

    expect(result.statuses).toEqual({
      total: 4,
      toDo: 2,
      inProgress: 1,
      done: 1,
      unknown: 0,
    });
    expect(result.planning).toEqual({
      totalOpen: 3,
      currentSprint: 1,
      futureSprint: 1,
      unscheduled: 1,
    });
    expect(result.unassignedOpen).toBe(2);
    expect(result.recentDone).toBe(1);
  });

  it("builds the current sprint breakdown by assignee and status", () => {
    const issues = [
      issue("POWER-1", "done", {
        assignee: { displayName: "Alex", accountId: "alex" },
        storyPoints: 3,
        sprints: [activeSprint],
      }),
      issue("POWER-2", "in-progress", {
        assignee: { displayName: "Alex", accountId: "alex" },
        storyPoints: 5,
        sprints: [activeSprint],
      }),
      issue("POWER-3", "to-do", { sprints: [activeSprint] }),
      issue("POWER-4", "to-do", {
        sprints: [{ id: "102", name: "Future", state: "future" }],
      }),
    ];
    const result = buildSprintHealthReport(issues, activeSprint, new Set(["POWER-2"]));

    expect(result.issues).toEqual({
      total: 3,
      done: 1,
      inProgress: 1,
      notStarted: 1,
      unknown: 0,
    });
    expect(result.storyPoints).toEqual({
      total: 8,
      done: 3,
      inProgress: 5,
      notStarted: 0,
      unknown: 0,
    });
    expect(result.storyPointsCoverage).toBe(2 / 3);
    expect(result.unassigned).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.people.map((person) => [person.name, person.issues.total])).toEqual([
      ["Alex", 2],
      ["Unassigned", 1],
    ]);
  });

  it("does not invent a percentage for an empty denominator", () => {
    expect(reportPercentage(5, 0)).toBe(0);
  });
});
