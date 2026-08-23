import type { StoredGanttDependencyType } from "@power-view/storage";

export type TaskEdge = "start" | "end";

export function dependencyTypeFromEdges(
  source: TaskEdge,
  target: TaskEdge,
): StoredGanttDependencyType {
  if (source === "end" && target === "start") return "FS";
  if (source === "end" && target === "end") return "FF";
  if (source === "start" && target === "start") return "SS";
  return "SF";
}
