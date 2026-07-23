import type { GanttTask } from "@power-view/domain";

export function visibleGanttTasks(
  tasks: GanttTask[],
  expandedIds: ReadonlySet<string>,
): GanttTask[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return tasks.filter((task) => {
    const visited = new Set<string>();
    let parentId = task.parentId;
    while (parentId) {
      if (visited.has(parentId) || !expandedIds.has(parentId)) {
        return false;
      }
      visited.add(parentId);
      parentId = taskById.get(parentId)?.parentId;
    }
    return true;
  });
}
