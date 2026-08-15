import type { GanttTask } from "@power-view/domain";
import { describe, expect, it } from "vitest";

import { dateAtOffset, nativeGanttRenderer } from "./GanttRenderer";

const task = {
  id: "1",
  issueKey: "POWER-1",
  browseUrl: "https://example.atlassian.net/browse/POWER-1",
  name: "Plan release",
  start: "2026-07-20",
  end: "2026-07-24",
  progress: 40,
  progressSource: "status",
  depth: 0,
  expanded: false,
  statusName: "In Progress",
  statusCategory: "in-progress",
  issueTypeName: "Task",
  isSyntheticDate: false,
  startSource: "jira",
  endSource: "jira",
  dependencies: [],
} satisfies GanttTask;

describe("nativeGanttRenderer", () => {
  it("creates deterministic day, week, and month viewports", () => {
    const day = nativeGanttRenderer.createViewport([task], "day", "2026-07-22");
    const week = nativeGanttRenderer.createViewport([task], "week", "2026-07-22");
    const month = nativeGanttRenderer.createViewport([task], "month", "2026-07-22");

    expect(day.dayWidth).toBeGreaterThan(week.dayWidth);
    expect(week.dayWidth).toBeGreaterThan(month.dayWidth);
    expect(day.ticks.length).toBeGreaterThan(week.ticks.length);
    expect(week.ticks.length).toBeGreaterThanOrEqual(month.ticks.length);
    expect(day.todayOffset).toBeTypeOf("number");
  });

  it("maps inclusive task dates to timeline geometry", () => {
    const viewport = nativeGanttRenderer.createViewport([task], "day", "2026-07-22");

    expect(nativeGanttRenderer.taskBar(task, viewport)).toEqual({
      left: 5 * viewport.dayWidth,
      width: 5 * viewport.dayWidth,
    });
  });

  it.each(["day", "week", "month"] as const)("round-trips task start offsets at %s zoom", (zoom) => {
    const viewport = nativeGanttRenderer.createViewport([task], zoom, "2026-07-22");
    expect(viewport.dayWidth).toBeGreaterThan(0);
    expect(dateAtOffset(viewport, nativeGanttRenderer.taskBar(task, viewport).left)).toBe(
      task.start,
    );
  });

  it("rounds boundary and mid-day offsets, including negative offsets", () => {
    const viewport = nativeGanttRenderer.createViewport([task], "day", "2026-07-22");
    expect(dateAtOffset(viewport, 2 * viewport.dayWidth)).toBe("2026-07-17");
    expect(dateAtOffset(viewport, 2.49 * viewport.dayWidth)).toBe("2026-07-17");
    expect(dateAtOffset(viewport, 2.5 * viewport.dayWidth)).toBe("2026-07-18");
    expect(dateAtOffset(viewport, -0.5 * viewport.dayWidth)).toBe(viewport.start);
  });

  it("omits the today marker when the current date is outside the range", () => {
    const viewport = nativeGanttRenderer.createViewport([task], "week", "2027-07-22");

    expect(viewport.todayOffset).toBeUndefined();
  });
});
