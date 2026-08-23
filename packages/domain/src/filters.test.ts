import { describe, expect, it } from "vitest";

import type { GanttTask } from "./schedule";
import {
  DEFAULT_GANTT_FILTERS,
  filterGanttTasks,
  ganttDateQuality,
  NO_LABEL_FILTER_VALUE,
  NO_PRIORITY_FILTER_VALUE,
  sortGanttTasks,
  isGanttFilterActive,
  type GanttFilters,
  UNASSIGNED_FILTER_VALUE,
} from "./filters";

function task(overrides: Partial<GanttTask> = {}): GanttTask {
  const id = overrides.id ?? "1";
  const issueKey = overrides.issueKey ?? `POWER-${id}`;
  return {
    id,
    issueKey,
    browseUrl: `https://example.atlassian.net/browse/${issueKey}`,
    name: `Planning task ${id}`,
    start: "2026-07-20",
    end: "2026-07-28",
    progress: 50,
    progressSource: "status",
    depth: 0,
    expanded: false,
    statusName: "To Do",
    statusCategory: "to-do",
    issueTypeName: "Task",
    isSyntheticDate: false,
    startSource: "jira",
    endSource: "jira",
    dependencies: [],
    ...overrides,
  };
}

describe("Gantt filters", () => {
  it("sorts each sibling group while preserving pre-order nesting", () => {
    const tasks = [
      task({ id: "a", name: "Zulu", depth: 0 }),
      task({ id: "a1", parentId: "a", name: "Beta", depth: 1 }),
      task({ id: "a2", parentId: "a", name: "Alpha", depth: 1 }),
      task({ id: "b", name: "Alpha", depth: 0 }),
      task({ id: "b1", parentId: "b", name: "Child", depth: 1 }),
    ];
    expect(sortGanttTasks(tasks, "name").map((item) => item.id)).toEqual([
      "b", "b1", "a", "a2", "a1",
    ]);
  });

  it("supports all sort keys, missing values, and stable ties", () => {
    const tasks = [
      task({
        id: "1",
        name: "same",
        start: "2026-02-01",
        end: "2026-03-01",
        statusName: "Beta",
        assigneeName: "Bea",
      }),
      task({
        id: "2",
        name: "Same",
        start: "2026-01-01",
        end: "2026-02-01",
        statusName: "alpha",
        assigneeName: "alan",
      }),
      task({ id: "3", name: "", start: "", end: "", statusName: "", assigneeName: "" }),
    ];
    expect(sortGanttTasks(tasks, "startDate").map((item) => item.id)).toEqual(["2", "1", "3"]);
    expect(sortGanttTasks(tasks, "endDate").map((item) => item.id)).toEqual(["2", "1", "3"]);
    expect(sortGanttTasks(tasks, "name").map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(sortGanttTasks(tasks, "status").map((item) => item.id)).toEqual(["2", "1", "3"]);
    expect(sortGanttTasks(tasks, "assignee").map((item) => item.id)).toEqual(["2", "1", "3"]);
    expect(sortGanttTasks(tasks, "default")).toBe(tasks);
  });
  it("searches issue key and summary case-insensitively", () => {
    const tasks = [
      task({ id: "1", name: "Publish Roadmap" }),
      task({ id: "2", issueKey: "OTHER-44" }),
    ];

    expect(
      filterGanttTasks(
        tasks,
        { ...DEFAULT_GANTT_FILTERS, search: "roadMAP" },
        "2026-07-23",
      ).tasks.map((item) => item.id),
    ).toEqual(["1"]);
    expect(
      filterGanttTasks(
        tasks,
        { ...DEFAULT_GANTT_FILTERS, search: "other-44" },
        "2026-07-23",
      ).tasks.map((item) => item.id),
    ).toEqual(["2"]);
  });

  it("supports multiple values and AND/OR logic across filter groups", () => {
    const tasks = [
      task({
        id: "1",
        statusName: "In Review",
        statusCategory: "in-progress",
        assigneeName: "Maya Chen",
        issueTypeName: "Story",
      }),
      task({ id: "2", statusName: "Done", statusCategory: "done" }),
      task({ id: "3" }),
    ];

    expect(
      filterGanttTasks(
        tasks,
        {
          ...DEFAULT_GANTT_FILTERS,
          statuses: ["In Review", "Done"],
        },
        "2026-07-23",
      ).tasks.map((item) => item.id),
    ).toEqual(["1", "2"]);
    expect(
      filterGanttTasks(
        tasks,
        {
          ...DEFAULT_GANTT_FILTERS,
          statuses: ["In Review"],
          statusCategories: ["in-progress"],
          assignees: ["Maya Chen"],
          issueTypes: ["Story"],
        },
        "2026-07-23",
      ).tasks.map((item) => item.id),
    ).toEqual(["1"]);
    expect(
      filterGanttTasks(
        tasks,
        {
          ...DEFAULT_GANTT_FILTERS,
          assignees: [UNASSIGNED_FILTER_VALUE],
        },
        "2026-07-23",
      ).tasks.map((item) => item.id),
    ).toEqual(["2", "3"]);
    expect(
      filterGanttTasks(
        tasks,
        {
          ...DEFAULT_GANTT_FILTERS,
          statuses: ["Done"],
          assignees: ["Maya Chen"],
          logic: "or",
        },
        "2026-07-23",
      ).tasks.map((item) => item.id),
    ).toEqual(["1", "2"]);
  });

  it("classifies explicit, partial, inferred, corrected, and overdue dates", () => {
    const explicit = task({ id: "1" });
    const partial = task({ id: "2", endSource: "default-duration" });
    const inferred = task({
      id: "3",
      startSource: "created",
      endSource: "default-duration",
    });
    const corrected = task({ id: "4", endSource: "corrected" });
    const overdue = task({ id: "5", end: "2026-07-01" });
    const completedOverdue = task({
      id: "6",
      end: "2026-07-01",
      statusName: "Done",
      statusCategory: "done",
    });
    const tasks = [explicit, partial, inferred, corrected, overdue, completedOverdue];

    expect(tasks.slice(0, 4).map(ganttDateQuality)).toEqual([
      "explicit",
      "partial",
      "inferred",
      "corrected",
    ]);
    expect(
      filterGanttTasks(
        tasks,
        { ...DEFAULT_GANTT_FILTERS, dateFilters: ["overdue"] },
        "2026-07-23",
      ).tasks.map((item) => item.id),
    ).toEqual(["5"]);
  });

  it("filters priorities, labels, and blocked or unresolved risks", () => {
    const tasks = [
      task({
        id: "1",
        priorityName: "Highest",
        labels: ["release", "platform"],
        isBlocked: true,
        isResolved: false,
      }),
      task({
        id: "2",
        labels: [],
        isBlocked: false,
        isResolved: true,
      }),
      task({
        id: "3",
        priorityName: "Low",
        labels: ["maintenance"],
        isBlocked: false,
        isResolved: false,
      }),
      task({
        id: "4",
        statusName: "Done",
        statusCategory: "done",
        priorityName: "Medium",
        labels: ["completed"],
      }),
    ];

    expect(
      filterGanttTasks(
        tasks,
        {
          ...DEFAULT_GANTT_FILTERS,
          priorities: ["Highest", NO_PRIORITY_FILTER_VALUE],
          labels: ["release", NO_LABEL_FILTER_VALUE],
        },
        "2026-07-23",
      ).tasks.map((item) => item.id),
    ).toEqual(["1", "2"]);
    expect(
      filterGanttTasks(
        tasks,
        { ...DEFAULT_GANTT_FILTERS, riskFilters: ["blocked"] },
        "2026-07-23",
      ).tasks.map((item) => item.id),
    ).toEqual(["1"]);
    expect(
      filterGanttTasks(
        tasks,
        { ...DEFAULT_GANTT_FILTERS, riskFilters: ["unresolved"] },
        "2026-07-23",
      ).tasks.map((item) => item.id),
    ).toEqual(["1", "3"]);
  });

  it("preserves and expands ancestors, with optional descendants", () => {
    const tasks = [
      task({ id: "root", issueKey: "POWER-1", name: "Program" }),
      task({
        id: "parent",
        issueKey: "POWER-2",
        name: "Delivery",
        parentId: "root",
        depth: 1,
      }),
      task({
        id: "match",
        issueKey: "POWER-3",
        name: "Needle task",
        parentId: "parent",
        depth: 2,
      }),
      task({
        id: "child",
        issueKey: "POWER-4",
        name: "Nested detail",
        parentId: "match",
        depth: 3,
      }),
    ];

    const ancestorsOnly = filterGanttTasks(
      tasks,
      { ...DEFAULT_GANTT_FILTERS, search: "Needle" },
      "2026-07-23",
    );
    expect(ancestorsOnly.tasks.map((item) => item.id)).toEqual([
      "root",
      "parent",
      "match",
    ]);
    expect([...ancestorsOnly.contextAncestorIds]).toEqual(["parent", "root"]);
    expect([...ancestorsOnly.autoExpandedIds]).toEqual(["root", "parent"]);

    const withDescendants = filterGanttTasks(
      tasks,
      {
        ...DEFAULT_GANTT_FILTERS,
        search: "Needle",
        includeDescendants: true,
      },
      "2026-07-23",
    );
    expect(withDescendants.tasks.map((item) => item.id)).toEqual([
      "root",
      "parent",
      "match",
      "child",
    ]);
    expect([...withDescendants.autoExpandedIds]).toEqual(["root", "parent", "match"]);
  });

  it("benchmarks 1,000 tasks without changing result correctness", () => {
    const tasks = Array.from({ length: 1_000 }, (_, index) =>
      task({
        id: String(index + 1),
        issueKey: `POWER-${index + 1}`,
        name: `Sanitized planning task ${index + 1}`,
        statusName: index % 3 === 0 ? "Done" : "To Do",
        statusCategory: index % 3 === 0 ? "done" : "to-do",
        issueTypeName: index % 5 === 0 ? "Story" : "Task",
        assigneeName: `Fixture User ${index % 7}`,
      }),
    );
    const filters = {
      ...DEFAULT_GANTT_FILTERS,
      statusCategories: ["to-do"],
      issueTypes: ["Task"],
    } satisfies GanttFilters;
    const startedAt = performance.now();
    let result = filterGanttTasks(tasks, filters, "2026-07-23");
    for (let iteration = 1; iteration < 25; iteration += 1) {
      result = filterGanttTasks(tasks, filters, "2026-07-23");
    }
    const durationMs = performance.now() - startedAt;

    expect(result.tasks).toHaveLength(533);
    expect(durationMs).toBeLessThan(1_000);
    console.info(`[performance] 25 filters × 1,000 tasks: ${durationMs.toFixed(2)} ms`);
  });

  it("excludes tasks with statusCategory 'done' when excludeDone is enabled", () => {
    const tasks = [
      task({ id: "1", name: "In Progress", statusCategory: "in-progress" }),
      task({ id: "2", name: "Completed", statusCategory: "done" }),
      task({ id: "3", name: "To Do", statusCategory: "to-do" }),
    ];

    expect(
      filterGanttTasks(
        tasks,
        { ...DEFAULT_GANTT_FILTERS, excludeDone: false },
        "2026-07-23",
      ).tasks.map((t) => t.id),
    ).toEqual(["1", "2", "3"]);

    expect(
      filterGanttTasks(
        tasks,
        { ...DEFAULT_GANTT_FILTERS, excludeDone: true },
        "2026-07-23",
      ).tasks.map((t) => t.id),
    ).toEqual(["1", "3"]);

    expect(
      isGanttFilterActive({ ...DEFAULT_GANTT_FILTERS, excludeDone: true }),
    ).toBe(true);
    expect(
      isGanttFilterActive({ ...DEFAULT_GANTT_FILTERS, excludeDone: false }),
    ).toBe(false);
  });

  it("supports issueKey sort and desc direction cycling", () => {
    const tasks = [
      task({ id: "1", issueKey: "POWER-3", name: "C" }),
      task({ id: "2", issueKey: "POWER-1", name: "A" }),
      task({ id: "3", issueKey: "POWER-2", name: "B" }),
    ];

    expect(sortGanttTasks(tasks, "issueKey", "asc").map((t) => t.id)).toEqual(
      ["2", "3", "1"],
    );
    expect(sortGanttTasks(tasks, "issueKey", "desc").map((t) => t.id)).toEqual(
      ["1", "3", "2"],
    );
    expect(sortGanttTasks(tasks, "name", "asc").map((t) => t.id)).toEqual(
      ["2", "3", "1"],
    );
    expect(sortGanttTasks(tasks, "name", "desc").map((t) => t.id)).toEqual(
      ["1", "3", "2"],
    );
  });

  it("sorts status by category order (unknown < to-do < in-progress < done), not alphabetically", () => {
    const tasks = [
      task({ id: "1", statusName: "Zebra", statusCategory: "done" }),
      task({ id: "2", statusName: "Alpha", statusCategory: "to-do" }),
      task({ id: "3", statusName: "Backlog", statusCategory: "unknown" }),
      task({ id: "4", statusName: "In Dev", statusCategory: "in-progress" }),
    ];

    expect(sortGanttTasks(tasks, "status", "asc").map((t) => t.id)).toEqual(
      ["3", "2", "4", "1"],
    );
    expect(sortGanttTasks(tasks, "status", "desc").map((t) => t.id)).toEqual(
      ["1", "4", "2", "3"],
    );
  });
});
