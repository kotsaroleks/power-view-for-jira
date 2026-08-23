import type { GanttTask } from "@power-view/domain";
import type { GanttBoardState } from "@power-view/storage";
import { describe, expect, it } from "vitest";

import { findExternalScheduleConflicts } from "./external-schedule-conflicts";

function task(issueKey: string, start: string, end: string): GanttTask {
  return {
    id: issueKey,
    issueKey,
    browseUrl: `https://example.atlassian.net/browse/${issueKey}`,
    name: issueKey,
    start,
    end,
    progress: 0,
    progressSource: "status",
    depth: 0,
    expanded: false,
    statusName: "To Do",
    statusCategory: "to-do",
    issueTypeName: "Task",
    scheduleState: "confirmed",
    isSyntheticDate: false,
    startSource: "jira",
    endSource: "jira",
    dependencies: [],
  };
}

const state: GanttBoardState = {
  dependencies: [
    {
      id: "A:B:FS",
      predecessorIssueKey: "A",
      successorIssueKey: "B",
      type: "FS",
      lagWorkingDays: 0,
    },
  ],
  reconciledDates: {
    A: { startDate: "2026-08-17", dueDate: "2026-08-21" },
    B: { startDate: "2026-08-24", dueDate: "2026-08-26" },
  },
};

describe("findExternalScheduleConflicts", () => {
  it("reports a Jira-changed predecessor when its successor now violates the graph", () => {
    const conflicts = findExternalScheduleConflicts({
      tasks: [
        task("A", "2026-08-21", "2026-08-25"),
        task("B", "2026-08-24", "2026-08-26"),
      ],
      boardState: state,
      nonWorkingDays: [0, 6],
    });

    expect(conflicts).toEqual([
      expect.objectContaining({
        issueKey: "A",
        expectedDates: { startDate: "2026-08-17", dueDate: "2026-08-21" },
        jiraDates: { startDate: "2026-08-21", dueDate: "2026-08-25" },
        repairUpdates: [
          {
            issueKey: "B",
            startDate: "2026-08-26",
            dueDate: "2026-08-28",
            source: "cascade",
          },
        ],
      }),
    ]);
  });

  it("does not warn when Jira already contains a graph-valid downstream schedule", () => {
    expect(
      findExternalScheduleConflicts({
        tasks: [
          task("A", "2026-08-21", "2026-08-25"),
          task("B", "2026-08-26", "2026-08-28"),
        ],
        boardState: state,
        nonWorkingDays: [0, 6],
      }),
    ).toEqual([]);
  });
});
