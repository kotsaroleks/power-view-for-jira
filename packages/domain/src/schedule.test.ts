import { describe, expect, it } from "vitest";

import type {
  JiraStatusCategory,
  NormalizedIssue,
  NormalizedIssueLink,
} from "./jira-issue";
import {
  buildGanttScheduleModel,
  buildIssueHierarchy,
  normalizeDefaultDurations,
} from "./schedule";

interface IssueOptions {
  parentKey?: string;
  epicKey?: string;
  startDate?: string;
  dueDate?: string;
  createdAt?: string;
  resolvedAt?: string;
  issueType?: string;
  subtask?: boolean;
  statusCategory?: JiraStatusCategory;
  progress?: NormalizedIssue["progress"];
  links?: NormalizedIssueLink[];
  priority?: string;
  labels?: string[];
  statusName?: string;
}

function issue(key: string, options: IssueOptions = {}): NormalizedIssue {
  return {
    id: `id-${key}`,
    key,
    browseUrl: `https://fixture.atlassian.net/browse/${key}`,
    summary: `Summary ${key}`,
    issueType: {
      id: "10000",
      name: options.issueType ?? "Task",
      subtask: options.subtask ?? false,
    },
    status: {
      name: options.statusName ?? (options.statusCategory === "done" ? "Done" : "To Do"),
      category: options.statusCategory ?? "to-do",
    },
    ...(options.priority ? { priority: { name: options.priority } } : {}),
    project: { id: "10000", key: "POWER", name: "Power View" },
    ...(options.parentKey ? { parentKey: options.parentKey } : {}),
    ...(options.epicKey ? { epicKey: options.epicKey } : {}),
    ...(options.startDate ? { startDate: options.startDate } : {}),
    ...(options.dueDate ? { dueDate: options.dueDate } : {}),
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.resolvedAt ? { resolvedAt: options.resolvedAt } : {}),
    ...(options.progress ? { progress: options.progress } : {}),
    labels: options.labels ?? [],
    components: [],
    fixVersions: [],
    issueLinks: options.links ?? [],
    rawFieldPresence: {
      hasStartDate: options.startDate !== undefined,
      hasDueDate: options.dueDate !== undefined,
      hasParent: options.parentKey !== undefined,
      hasEpic: options.epicKey !== undefined,
    },
  };
}

describe("issue hierarchy", () => {
  it("prefers explicit parents, then epics, and keeps orphans visible", () => {
    const roots = buildIssueHierarchy([
      issue("POWER-1", { issueType: "Epic" }),
      issue("POWER-2"),
      issue("POWER-3", { parentKey: "POWER-2", epicKey: "POWER-1" }),
      issue("POWER-4", { epicKey: "POWER-1" }),
      issue("POWER-5", { parentKey: "POWER-999" }),
    ]);

    expect(roots.map((node) => node.issue.key)).toEqual([
      "POWER-1",
      "POWER-2",
      "POWER-5",
    ]);
    expect(roots[0]?.children.map((node) => node.issue.key)).toEqual(["POWER-4"]);
    expect(roots[1]?.children.map((node) => node.issue.key)).toEqual(["POWER-3"]);
    expect(roots[2]?.warnings).toContain(
      "Referenced parent POWER-999 was not loaded; issue was kept at the root.",
    );
  });

  it("prevents cycles and caps malformed hierarchy depth", () => {
    const cycleRoots = buildIssueHierarchy([
      issue("POWER-1", { parentKey: "POWER-2" }),
      issue("POWER-2", { parentKey: "POWER-1" }),
    ]);
    expect(cycleRoots).toHaveLength(2);
    expect(cycleRoots.every((node) => node.warnings.length === 1)).toBe(true);

    const depthRoots = buildIssueHierarchy(
      [
        issue("POWER-10"),
        issue("POWER-11", { parentKey: "POWER-10" }),
        issue("POWER-12", { parentKey: "POWER-11" }),
        issue("POWER-13", { parentKey: "POWER-12" }),
      ],
      2,
    );
    expect(depthRoots.map((node) => node.issue.key)).toEqual(["POWER-10", "POWER-13"]);
    expect(depthRoots[1]?.warnings[0]).toMatch(/Maximum hierarchy depth of 2/);
  });
});

describe("schedule resolution", () => {
  it("uses explicit Jira dates without marking them synthetic", () => {
    const model = buildGanttScheduleModel(
      [issue("POWER-1", { startDate: "2026-03-01", dueDate: "2026-03-04" })],
      { today: "2026-01-01" },
    );

    expect(model.tasks[0]).toMatchObject({
      start: "2026-03-01",
      end: "2026-03-04",
      startSource: "jira",
      endSource: "jira",
      isSyntheticDate: false,
    });
  });

  it("derives parent dates from children before created and resolution dates", () => {
    const model = buildGanttScheduleModel(
      [
        issue("POWER-1", {
          issueType: "Epic",
          createdAt: "2026-01-01T10:00:00.000Z",
          resolvedAt: "2026-05-01T10:00:00.000Z",
        }),
        issue("POWER-2", {
          parentKey: "POWER-1",
          startDate: "2026-03-02",
          dueDate: "2026-03-10",
        }),
        issue("POWER-3", {
          parentKey: "POWER-1",
          startDate: "2026-02-20",
          dueDate: "2026-03-20",
        }),
      ],
      { today: "2026-01-01" },
    );

    expect(model.tasks[0]).toMatchObject({
      start: "2026-02-20",
      end: "2026-03-20",
      startSource: "children",
      endSource: "children",
      isSyntheticDate: true,
    });
  });

  it("prefers the child rollup over a parent's own explicit dates and flags the mismatch", () => {
    const model = buildGanttScheduleModel(
      [
        issue("POWER-1", {
          issueType: "Epic",
          startDate: "2026-05-01",
          dueDate: "2026-05-10",
        }),
        issue("POWER-2", {
          parentKey: "POWER-1",
          startDate: "2026-03-02",
          dueDate: "2026-03-10",
        }),
      ],
      { today: "2026-01-01" },
    );

    expect(model.tasks[0]).toMatchObject({
      start: "2026-03-02",
      end: "2026-03-10",
      startSource: "children",
      endSource: "children",
      hasDateMisalignment: true,
    });
    expect(model.warnings).toContainEqual(
      expect.objectContaining({
        issueKey: "POWER-1",
        code: "PARENT_DATE_MISMATCH",
      }),
    );
  });

  it("does not flag a mismatch when the parent's own explicit dates already match the rollup", () => {
    const model = buildGanttScheduleModel(
      [
        issue("POWER-1", {
          issueType: "Epic",
          startDate: "2026-03-02",
          dueDate: "2026-03-10",
        }),
        issue("POWER-2", {
          parentKey: "POWER-1",
          startDate: "2026-03-02",
          dueDate: "2026-03-10",
        }),
      ],
      { today: "2026-01-01" },
    );

    expect(model.tasks[0]).toMatchObject({
      start: "2026-03-02",
      end: "2026-03-10",
      hasDateMisalignment: false,
    });
    expect(
      model.warnings.some((warning) => warning.code === "PARENT_DATE_MISMATCH"),
    ).toBe(false);
  });

  it("leaves leaf issues (no children) fully unaffected by rollup priority", () => {
    const model = buildGanttScheduleModel(
      [issue("POWER-1", { startDate: "2026-03-01", dueDate: "2026-03-04" })],
      { today: "2026-01-01" },
    );

    expect(model.tasks[0]).toMatchObject({
      start: "2026-03-01",
      end: "2026-03-04",
      startSource: "jira",
      endSource: "jira",
      hasDateMisalignment: false,
    });
  });

  it("falls back through created, today, resolution, and configured duration", () => {
    const model = buildGanttScheduleModel(
      [
        issue("POWER-1", {
          createdAt: "2026-02-01T23:30:00.000Z",
          resolvedAt: "2026-02-08T11:00:00.000Z",
        }),
        issue("POWER-2", { issueType: "Story" }),
        issue("POWER-3", { issueType: "Sub-task", subtask: true }),
      ],
      {
        today: "2026-04-10",
        defaultDurations: { story: 8, subtask: 2 },
      },
    );

    expect(model.tasks[0]).toMatchObject({
      start: "2026-02-01",
      end: "2026-02-08",
      startSource: "created",
      endSource: "resolution",
    });
    expect(model.tasks[1]).toMatchObject({
      start: "2026-04-10",
      end: "2026-04-18",
      startSource: "today",
      endSource: "default-duration",
    });
    expect(model.tasks[2]).toMatchObject({
      start: "2026-04-10",
      end: "2026-04-12",
    });
  });

  it("corrects invalid and end-before-start dates with warnings", () => {
    const model = buildGanttScheduleModel(
      [
        issue("POWER-1", {
          startDate: "not-a-date",
          dueDate: "2025-12-01",
          issueType: "Bug",
        }),
      ],
      { today: "2026-01-10" },
    );

    expect(model.tasks[0]).toMatchObject({
      start: "2026-01-10",
      end: "2026-01-13",
      startSource: "today",
      endSource: "corrected",
      isSyntheticDate: true,
    });
    expect(model.warnings.map((warning) => warning.code)).toEqual([
      "INVALID_START_DATE",
      "END_BEFORE_START",
    ]);
  });

  it("normalizes invalid duration configuration", () => {
    expect(normalizeDefaultDurations({ task: 0, story: 4.9, epic: 900 })).toMatchObject({
      task: 1,
      story: 4,
      epic: 365,
    });
  });
});

describe("progress and dependencies", () => {
  it("uses Jira progress, subtask completion, weighted children, then status", () => {
    const model = buildGanttScheduleModel(
      [
        issue("POWER-1", {
          progress: {
            completed: 37,
            total: 100,
            percentage: 37,
            source: "jira-progress",
          },
          startDate: "2026-01-01",
          dueDate: "2026-01-10",
        }),
        issue("POWER-2", { startDate: "2026-01-01", dueDate: "2026-01-10" }),
        issue("POWER-3", {
          parentKey: "POWER-2",
          subtask: true,
          statusCategory: "done",
          startDate: "2026-01-01",
          dueDate: "2026-01-02",
        }),
        issue("POWER-4", {
          parentKey: "POWER-2",
          subtask: true,
          startDate: "2026-01-01",
          dueDate: "2026-01-02",
        }),
        issue("POWER-5", { issueType: "Epic" }),
        issue("POWER-6", {
          parentKey: "POWER-5",
          statusCategory: "done",
          startDate: "2026-01-01",
          dueDate: "2026-01-11",
        }),
        issue("POWER-7", {
          parentKey: "POWER-5",
          startDate: "2026-01-01",
          dueDate: "2026-01-03",
        }),
        issue("POWER-8", { statusCategory: "in-progress" }),
      ],
      { today: "2026-01-01" },
    );
    const tasks = new Map(model.tasks.map((task) => [task.issueKey, task]));

    expect(tasks.get("POWER-1")).toMatchObject({
      progress: 37,
      progressSource: "jira-progress",
    });
    expect(tasks.get("POWER-2")).toMatchObject({
      progress: 50,
      progressSource: "subtasks",
    });
    expect(tasks.get("POWER-5")).toMatchObject({
      progress: 83,
      progressSource: "children",
    });
    expect(tasks.get("POWER-8")).toMatchObject({
      progress: 50,
      progressSource: "status",
    });
  });

  it("maps blocking links without treating hierarchy as a dependency", () => {
    const model = buildGanttScheduleModel(
      [
        issue("POWER-1", {
          links: [
            {
              id: "link-100",
              typeName: "Blocks",
              direction: "outward",
              linkedIssueKey: "POWER-2",
              semanticType: "blocks",
            },
          ],
        }),
        issue("POWER-2"),
        issue("POWER-3", {
          parentKey: "POWER-2",
          links: [
            {
              typeName: "Blocks",
              direction: "inward",
              linkedIssueKey: "POWER-2",
              semanticType: "is-blocked-by",
            },
          ],
        }),
      ],
      { today: "2026-01-01" },
    );
    const tasks = new Map(model.tasks.map((task) => [task.issueKey, task]));

    expect(tasks.get("POWER-1")?.dependencies).toEqual([]);
    expect(tasks.get("POWER-2")?.dependencies).toEqual(["id-POWER-1"]);
    expect(tasks.get("POWER-2")?.dependencyLinks).toEqual([
      {
        taskId: "id-POWER-1",
        issueKey: "POWER-1",
        linkId: "link-100",
        typeName: "Blocks",
        relationshipType: "finish-to-start",
      },
    ]);
    expect(tasks.get("POWER-2")).toMatchObject({
      isBlocked: true,
      blockedByTaskIds: ["id-POWER-1"],
      isResolved: false,
    });
    expect(tasks.get("POWER-3")?.dependencies).toEqual(["id-POWER-2"]);
    expect(tasks.get("POWER-3")?.parentId).toBe("id-POWER-2");
    expect(model.dependencyCount).toBe(2);
  });

  it("maps a finish-to-finish semantic link to a finish-to-finish dependency", () => {
    const model = buildGanttScheduleModel(
      [
        issue("POWER-1", {
          issueType: "Epic",
          links: [
            {
              typeName: "Gantt: finish-finish",
              direction: "outward",
              linkedIssueKey: "POWER-2",
              semanticType: "finish-to-finish",
            },
          ],
        }),
        issue("POWER-2", { issueType: "Epic" }),
      ],
      { today: "2026-01-01" },
    );
    const tasks = new Map(model.tasks.map((task) => [task.issueKey, task]));

    expect(tasks.get("POWER-1")?.dependencyLinks).toEqual([
      expect.objectContaining({
        issueKey: "POWER-2",
        relationshipType: "finish-to-finish",
      }),
    ]);
  });

  it("marks done prerequisites as unblocked and carries filter metadata", () => {
    const model = buildGanttScheduleModel(
      [
        issue("POWER-1", {
          statusCategory: "done",
          priority: "Highest",
          labels: ["release"],
          links: [
            {
              typeName: "Blocks",
              direction: "outward",
              linkedIssueKey: "POWER-2",
              semanticType: "blocks",
            },
          ],
        }),
        issue("POWER-2"),
        issue("POWER-3", { statusName: "Blocked" }),
      ],
      { today: "2026-01-01" },
    );
    const tasks = new Map(model.tasks.map((task) => [task.issueKey, task]));

    expect(tasks.get("POWER-1")).toMatchObject({
      priorityName: "Highest",
      labels: ["release"],
      isResolved: true,
    });
    expect(tasks.get("POWER-2")).toMatchObject({
      isBlocked: false,
      blockedByTaskIds: [],
    });
    expect(tasks.get("POWER-3")?.isBlocked).toBe(true);
  });

  it("produces deterministic output for the same input and clock", () => {
    const issues = [issue("POWER-1"), issue("POWER-2", { epicKey: "POWER-1" })];
    const options = { today: "2026-07-23" };

    expect(buildGanttScheduleModel(issues, options)).toEqual(
      buildGanttScheduleModel(issues, options),
    );
  });
});
