import type { GanttTask } from "@power-view/domain";
import { describe, expect, it } from "vitest";

import { nativeGanttRenderer } from "./GanttRenderer";
import { ganttDependencyGeometry } from "./ganttDependencyGeometry";

function task(overrides: Partial<GanttTask>): GanttTask {
  const id = overrides.id ?? "1";
  return {
    id,
    issueKey: overrides.issueKey ?? `POWER-${id}`,
    browseUrl: `https://example.atlassian.net/browse/POWER-${id}`,
    name: `Task ${id}`,
    start: "2026-07-20",
    end: "2026-07-22",
    progress: 0,
    progressSource: "none",
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

describe("Gantt dependency geometry", () => {
  it("draws visible finish-to-start connectors and flags schedule conflicts", () => {
    const prerequisite = task({ id: "1", end: "2026-07-23" });
    const conflict = task({
      id: "2",
      start: "2026-07-22",
      end: "2026-07-26",
      dependencies: ["1"],
    });
    const safe = task({
      id: "3",
      start: "2026-07-24",
      end: "2026-07-28",
      dependencies: ["1"],
    });
    const tasks = [prerequisite, conflict, safe];
    const viewport = nativeGanttRenderer.createViewport(tasks, "week", "2026-07-23");

    const result = ganttDependencyGeometry(
      tasks,
      viewport,
      nativeGanttRenderer,
      0,
      3,
      "2",
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      prerequisiteKey: "POWER-1",
      dependentKey: "POWER-2",
      conflict: true,
      selected: true,
    });
    expect(result[1]).toMatchObject({
      dependentKey: "POWER-3",
      conflict: false,
      selected: false,
    });
    expect(result[0]?.path).toMatch(/^M \d/);
  });

  it("does not draw connectors whose endpoint is outside the virtual window", () => {
    const tasks = [
      task({ id: "1" }),
      task({ id: "2", dependencies: ["1"] }),
      task({ id: "3" }),
    ];
    const viewport = nativeGanttRenderer.createViewport(tasks, "week", "2026-07-23");

    expect(ganttDependencyGeometry(tasks, viewport, nativeGanttRenderer, 1, 3)).toEqual(
      [],
    );
  });
});
