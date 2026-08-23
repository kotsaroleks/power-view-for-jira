import type { GanttTask } from "@power-view/domain";
import type { GanttBoardState, ReconciledIssueDates } from "@power-view/storage";

import { planCascadeSchedule, type CascadeScheduleUpdate } from "./cascade-schedule";

export interface ExternalScheduleConflict {
  issueKey: string;
  expectedDates: ReconciledIssueDates;
  jiraDates: { startDate: string; dueDate: string };
  repairUpdates: CascadeScheduleUpdate[];
}

export interface ExternalScheduleConflictRequest {
  tasks: readonly GanttTask[];
  boardState: GanttBoardState;
  nonWorkingDays: readonly number[];
}

export function findExternalScheduleConflicts({
  tasks,
  boardState,
  nonWorkingDays,
}: ExternalScheduleConflictRequest): ExternalScheduleConflict[] {
  const tasksByKey = new Map(tasks.map((task) => [task.issueKey, task]));
  const predecessorKeys = new Set(
    boardState.dependencies.map((dependency) => dependency.predecessorIssueKey),
  );
  const conflicts: ExternalScheduleConflict[] = [];

  for (const [issueKey, expectedDates] of Object.entries(boardState.reconciledDates)) {
    if (!predecessorKeys.has(issueKey)) continue;
    const task = tasksByKey.get(issueKey);
    if (!task || task.scheduleState === "unscheduled") continue;
    if (expectedDates.startDate === task.start && expectedDates.dueDate === task.end) {
      continue;
    }
    const plan = planCascadeSchedule({
      tasks,
      dependencies: boardState.dependencies,
      changedIssueKey: issueKey,
      changedDates: { startDate: task.start, dueDate: task.end },
      nonWorkingDays,
    });
    const repairUpdates = plan.updates.filter((update) => update.source === "cascade");
    if (repairUpdates.length === 0) continue;
    conflicts.push({
      issueKey,
      expectedDates,
      jiraDates: { startDate: task.start, dueDate: task.end },
      repairUpdates,
    });
  }

  return conflicts;
}
