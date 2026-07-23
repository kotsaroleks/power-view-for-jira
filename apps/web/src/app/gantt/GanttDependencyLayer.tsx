import type { GanttTask } from "@power-view/domain";
import { useId, useMemo } from "react";

import type { GanttRenderer, GanttViewport } from "./GanttRenderer";
import { ganttDependencyGeometry } from "./ganttDependencyGeometry";

const ROW_HEIGHT = 50;

export interface GanttDependencyLayerProps {
  tasks: GanttTask[];
  viewport: GanttViewport;
  renderer: GanttRenderer;
  renderStart: number;
  renderEnd: number;
  selectedTaskId?: string;
}

export function GanttDependencyLayer({
  tasks,
  viewport,
  renderer,
  renderStart,
  renderEnd,
  selectedTaskId,
}: GanttDependencyLayerProps) {
  const markerId = useId().replaceAll(":", "");
  const geometries = useMemo(
    () =>
      ganttDependencyGeometry(
        tasks,
        viewport,
        renderer,
        renderStart,
        renderEnd,
        selectedTaskId,
      ),
    [renderEnd, renderStart, renderer, selectedTaskId, tasks, viewport],
  );

  if (geometries.length === 0) {
    return null;
  }

  return (
    <svg
      className="gantt-dependency-layer"
      width={viewport.width}
      height={tasks.length * ROW_HEIGHT}
      viewBox={`0 0 ${viewport.width} ${tasks.length * ROW_HEIGHT}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {geometries.map((geometry) => (
        <path
          key={geometry.id}
          className={`gantt-dependency-path${geometry.conflict ? " has-conflict" : ""}${geometry.selected ? " is-selected" : ""}`}
          d={geometry.path}
          markerEnd={`url(#${markerId})`}
        />
      ))}
    </svg>
  );
}
