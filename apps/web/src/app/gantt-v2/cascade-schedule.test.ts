import type { GanttTask } from "@power-view/domain";
import type { StoredGanttDependency } from "@power-view/storage";
import { describe, expect, it } from "vitest";

import { planCascadeSchedule, wouldCreateDependencyCycle } from "./cascade-schedule";

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

function dependency(
  predecessorIssueKey: string,
  successorIssueKey: string,
  type: StoredGanttDependency["type"],
  lagWorkingDays = 0,
): StoredGanttDependency {
  return {
    id: `${predecessorIssueKey}:${successorIssueKey}:${type}`,
    predecessorIssueKey,
    successorIssueKey,
    type,
    lagWorkingDays,
  };
}

describe("planCascadeSchedule", () => {
  it("pushes an FS chain through every downstream level and skips weekends", () => {
    const result = planCascadeSchedule({
      tasks: [
        task("POWER-1", "2026-08-17", "2026-08-21"),
        task("POWER-2", "2026-08-24", "2026-08-26"),
        task("POWER-3", "2026-08-27", "2026-08-28"),
      ],
      dependencies: [
        dependency("POWER-1", "POWER-2", "FS"),
        dependency("POWER-2", "POWER-3", "FS"),
      ],
      changedIssueKey: "POWER-1",
      changedDates: { startDate: "2026-08-21", dueDate: "2026-08-25" },
      nonWorkingDays: [0, 6],
    });

    expect(result.updates).toEqual([
      {
        issueKey: "POWER-1",
        startDate: "2026-08-21",
        dueDate: "2026-08-25",
        source: "direct",
      },
      {
        issueKey: "POWER-2",
        startDate: "2026-08-26",
        dueDate: "2026-08-28",
        source: "cascade",
      },
      {
        issueKey: "POWER-3",
        startDate: "2026-08-31",
        dueDate: "2026-09-01",
        source: "cascade",
      },
    ]);
  });

  it("supports FF, SS and SF while preserving successor working duration", () => {
    const tasks = [
      task("ROOT", "2026-08-17", "2026-08-28"),
      task("FF", "2026-08-17", "2026-08-21"),
      task("SS", "2026-08-17", "2026-08-19"),
      task("SF", "2026-08-17", "2026-08-18"),
    ];
    const result = planCascadeSchedule({
      tasks,
      dependencies: [
        dependency("ROOT", "FF", "FF"),
        dependency("ROOT", "SS", "SS"),
        dependency("ROOT", "SF", "SF"),
      ],
      changedIssueKey: "ROOT",
      changedDates: { startDate: "2026-08-24", dueDate: "2026-09-04" },
      nonWorkingDays: [0, 6],
    });

    expect(result.updates).toEqual(
      expect.arrayContaining([
        {
          issueKey: "FF",
          startDate: "2026-08-31",
          dueDate: "2026-09-04",
          source: "cascade",
        },
        {
          issueKey: "SS",
          startDate: "2026-08-24",
          dueDate: "2026-08-26",
          source: "cascade",
        },
        {
          issueKey: "SF",
          startDate: "2026-08-21",
          dueDate: "2026-08-24",
          source: "cascade",
        },
      ]),
    );
  });

  it("uses the latest constraint from multiple predecessors", () => {
    const result = planCascadeSchedule({
      tasks: [
        task("A", "2026-08-17", "2026-08-21"),
        task("B", "2026-08-17", "2026-08-28"),
        task("C", "2026-08-24", "2026-08-26"),
      ],
      dependencies: [dependency("A", "C", "FS"), dependency("B", "C", "FS")],
      changedIssueKey: "A",
      changedDates: { startDate: "2026-08-24", dueDate: "2026-09-01" },
      nonWorkingDays: [0, 6],
    });

    expect(result.updates).toContainEqual({
      issueKey: "C",
      startDate: "2026-09-02",
      dueDate: "2026-09-04",
      source: "cascade",
    });
  });

  it("does not pull successors earlier when the graph is already valid", () => {
    const result = planCascadeSchedule({
      tasks: [
        task("A", "2026-08-17", "2026-08-21"),
        task("B", "2026-08-24", "2026-08-28"),
      ],
      dependencies: [dependency("A", "B", "FS")],
      changedIssueKey: "A",
      changedDates: { startDate: "2026-08-10", dueDate: "2026-08-14" },
      nonWorkingDays: [0, 6],
    });

    expect(result.updates).toEqual([
      {
        issueKey: "A",
        startDate: "2026-08-10",
        dueDate: "2026-08-14",
        source: "direct",
      },
    ]);
  });
});

describe("wouldCreateDependencyCycle", () => {
  it("rejects direct and transitive cycles without rejecting a valid edge", () => {
    const dependencies = [dependency("A", "B", "FS"), dependency("B", "C", "FS")];
    expect(wouldCreateDependencyCycle(dependencies, "C", "A")).toBe(true);
    expect(wouldCreateDependencyCycle(dependencies, "A", "A")).toBe(true);
    expect(wouldCreateDependencyCycle(dependencies, "A", "C")).toBe(false);
  });
});
