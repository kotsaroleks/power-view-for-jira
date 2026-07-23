import type { GanttTask } from "@power-view/domain";

export type GanttZoom = "day" | "week" | "month";

export interface GanttTick {
  date: string;
  label: string;
  left: number;
  width: number;
}

export interface GanttViewport {
  start: string;
  end: string;
  dayWidth: number;
  totalDays: number;
  width: number;
  ticks: GanttTick[];
  todayOffset?: number;
}

export interface TaskBarGeometry {
  left: number;
  width: number;
}

export interface GanttRenderer {
  createViewport(tasks: GanttTask[], zoom: GanttZoom, today: string): GanttViewport;
  taskBar(task: GanttTask, viewport: GanttViewport): TaskBarGeometry;
  scrollToToday(container: HTMLElement, viewport: GanttViewport): void;
}

const DAY_MS = 86_400_000;
const MIN_TIMELINE_WIDTH = 720;

const ZOOM_CONFIG: Record<
  GanttZoom,
  { dayWidth: number; paddingDays: number; tickDays: number }
> = {
  day: { dayWidth: 32, paddingDays: 5, tickDays: 1 },
  week: { dayWidth: 12, paddingDays: 14, tickDays: 7 },
  month: { dayWidth: 4, paddingDays: 31, tickDays: 30 },
};

function timestamp(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function daysBetween(start: string, end: string): number {
  return Math.round((timestamp(end) - timestamp(start)) / DAY_MS);
}

function addDays(date: string, days: number): string {
  const value = new Date(timestamp(date));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function tickLabel(date: string, zoom: GanttZoom): string {
  const value = new Date(timestamp(date));
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    ...(zoom === "day"
      ? { month: "short", day: "numeric" }
      : zoom === "week"
        ? { month: "short", day: "numeric" }
        : { month: "short", year: "numeric" }),
  }).format(value);
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(timestamp(value));
}

export const nativeGanttRenderer: GanttRenderer = {
  createViewport(tasks, zoom, today) {
    const config = ZOOM_CONFIG[zoom];
    const validStarts = tasks
      .map((task) => task.start)
      .filter(isValidDate)
      .sort();
    const validEnds = tasks
      .map((task) => task.end)
      .filter(isValidDate)
      .sort();
    const fallbackToday = isValidDate(today)
      ? today
      : new Date().toISOString().slice(0, 10);
    const first = validStarts[0] ?? fallbackToday;
    const last = validEnds.at(-1) ?? first;
    const start = addDays(first, -config.paddingDays);
    const end = addDays(last, config.paddingDays);
    const totalDays = Math.max(1, daysBetween(start, end) + 1);
    const dayWidth = Math.max(config.dayWidth, MIN_TIMELINE_WIDTH / totalDays);
    const width = totalDays * dayWidth;
    const ticks: GanttTick[] = [];

    for (let day = 0; day < totalDays; day += config.tickDays) {
      const tickDate = addDays(start, day);
      ticks.push({
        date: tickDate,
        label: tickLabel(tickDate, zoom),
        left: day * dayWidth,
        width: Math.min(config.tickDays, totalDays - day) * dayWidth,
      });
    }

    const todayDay = daysBetween(start, fallbackToday);
    return {
      start,
      end,
      dayWidth,
      totalDays,
      width,
      ticks,
      ...(todayDay >= 0 && todayDay < totalDays
        ? { todayOffset: (todayDay + 0.5) * dayWidth }
        : {}),
    };
  },

  taskBar(task, viewport) {
    const left = Math.max(0, daysBetween(viewport.start, task.start) * viewport.dayWidth);
    const inclusiveDays = Math.max(1, daysBetween(task.start, task.end) + 1);
    return {
      left,
      width: inclusiveDays * viewport.dayWidth,
    };
  },

  scrollToToday(container, viewport) {
    if (viewport.todayOffset === undefined) {
      return;
    }
    const tableWidth = Number.parseFloat(
      globalThis.getComputedStyle(container).getPropertyValue("--gantt-table-width"),
    );
    const timelineViewportWidth = Math.max(
      0,
      container.clientWidth - (Number.isFinite(tableWidth) ? tableWidth : 0),
    );
    const target = Math.max(0, viewport.todayOffset - timelineViewportWidth / 2);
    if (typeof container.scrollTo === "function") {
      const reducedMotion =
        globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      container.scrollTo({
        left: target,
        behavior: reducedMotion ? "auto" : "smooth",
      });
    } else {
      container.scrollLeft = target;
    }
  },
};
