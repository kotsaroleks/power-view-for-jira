import type { GanttTask } from "@power-view/domain";

import type { GanttRenderer, GanttViewport } from "./GanttRenderer";

const ROW_HEIGHT = 50;

export interface GanttDependencyGeometry {
  id: string;
  prerequisiteId: string;
  dependentId: string;
  prerequisiteKey: string;
  dependentKey: string;
  path: string;
  conflict: boolean;
  selected: boolean;
}

export function ganttDependencyGeometry(
  tasks: GanttTask[],
  viewport: GanttViewport,
  renderer: GanttRenderer,
  renderStart: number,
  renderEnd: number,
  selectedTaskId?: string,
): GanttDependencyGeometry[] {
  const indexById = new Map(tasks.map((task, index) => [task.id, index]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const geometries: GanttDependencyGeometry[] = [];

  tasks.forEach((dependent, dependentIndex) => {
    if (dependentIndex < renderStart || dependentIndex >= renderEnd) {
      return;
    }

    dependent.dependencies.forEach((prerequisiteId) => {
      const prerequisite = taskById.get(prerequisiteId);
      const prerequisiteIndex = indexById.get(prerequisiteId);
      if (
        !prerequisite ||
        prerequisiteIndex === undefined ||
        prerequisiteIndex < renderStart ||
        prerequisiteIndex >= renderEnd
      ) {
        return;
      }

      const prerequisiteBar = renderer.taskBar(prerequisite, viewport);
      const dependentBar = renderer.taskBar(dependent, viewport);
      const sourceX = prerequisiteBar.left + prerequisiteBar.width;
      const targetX = dependentBar.left;
      const sourceY = prerequisiteIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const targetY = dependentIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
      const routeX =
        targetX > sourceX + 24
          ? sourceX + Math.max(12, (targetX - sourceX) / 2)
          : Math.max(sourceX, targetX) + 16;

      geometries.push({
        id: `${prerequisite.id}->${dependent.id}`,
        prerequisiteId: prerequisite.id,
        dependentId: dependent.id,
        prerequisiteKey: prerequisite.issueKey,
        dependentKey: dependent.issueKey,
        path: `M ${sourceX} ${sourceY} H ${routeX} V ${targetY} H ${targetX}`,
        conflict: dependent.start <= prerequisite.end,
        selected: selectedTaskId === prerequisite.id || selectedTaskId === dependent.id,
      });
    });
  });

  return geometries;
}
