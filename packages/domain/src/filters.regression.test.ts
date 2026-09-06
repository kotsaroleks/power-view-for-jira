import { describe, expect, it } from "vitest";
import { DEFAULT_GANTT_FILTERS, filterGanttTasks, sortGanttTasks } from "./filters";
import type { GanttTask } from "./schedule";

function task(id: string, overrides: Partial<GanttTask> = {}): GanttTask {
  return {
    id,
    issueKey: `P-${id}`,
    browseUrl: "https://example.test",
    name: id,
    start: "2026-07-01",
    end: "2026-07-20",
    progress: 0,
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

describe("Gantt hierarchy regressions", () => {
  it("preserves shared ancestor order and terminates cyclic descendant traversal", () => {
    const tasks = [
      task("root", { parentId: "parent" }),
      task("parent", { parentId: "root" }),
      task("one", { parentId: "parent", name: "match one" }),
      task("two", { parentId: "parent", name: "match two" }),
      task("child", { parentId: "one" }),
      task("orphan", { parentId: "missing", name: "match orphan" }),
    ];
    const result = filterGanttTasks(
      tasks,
      {
        ...DEFAULT_GANTT_FILTERS,
        search: "match",
        includeDescendants: true,
      },
      "2026-07-23",
    );
    expect(result.tasks.map(({ id }) => id)).toEqual([
      "root",
      "parent",
      "one",
      "two",
      "child",
      "orphan",
    ]);
    expect([...result.contextAncestorIds]).toEqual(["parent", "root", "missing"]);
    expect([...result.autoExpandedIds]).toEqual(["parent", "root", "one", "missing"]);
    const cyclic = filterGanttTasks(
      tasks,
      {
        ...DEFAULT_GANTT_FILTERS,
        search: "root",
        includeDescendants: true,
      },
      "2026-07-23",
    );
    expect(cyclic.tasks.map(({ id }) => id)).toEqual([
      "root",
      "parent",
      "one",
      "two",
      "child",
    ]);
  });

  it("keeps descending ties and empty values without mutating inputs", () => {
    const tasks = [
      task("1", { name: "Alpha" }),
      task("2", { name: "alpha" }),
      task("3", { name: " " }),
    ];
    tasks.forEach(Object.freeze);
    Object.freeze(tasks);
    expect(sortGanttTasks(tasks, "name", "asc").map(({ id }) => id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(sortGanttTasks(tasks, "name", "desc").map(({ id }) => id)).toEqual([
      "3",
      "2",
      "1",
    ]);
    expect(sortGanttTasks(tasks, "default")).toBe(tasks);
  });

  it("retains status whitespace comparison and orphan/cycle fallback order", () => {
    const tasks = [
      task("a", { parentId: "b", statusName: "Alpha" }),
      task("b", { parentId: "a", statusName: " Alpha" }),
      task("orphan", { parentId: "missing" }),
    ];
    expect(sortGanttTasks(tasks, "status").map(({ id }) => id)).toEqual([
      "orphan",
      "a",
      "b",
    ]);
    const statuses = [
      task("1", { statusName: "Alpha" }),
      task("2", { statusName: " Alpha" }),
    ];
    const expected = [...statuses].sort((a, b) =>
      a.statusName.localeCompare(b.statusName, undefined, { sensitivity: "base" }),
    );
    expect(sortGanttTasks(statuses, "status")).toEqual(expected);
  });
});
