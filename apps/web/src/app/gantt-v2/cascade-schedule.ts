import {
  addWorkingDays,
  isWorkingDay,
  nextWorkingDay,
  type GanttTask,
} from "@power-view/domain";
import type { StoredGanttDependency } from "@power-view/storage";

export interface CascadeScheduleUpdate {
  issueKey: string;
  startDate: string;
  dueDate: string;
  source: "direct" | "cascade";
}

export interface CascadeScheduleRequest {
  tasks: readonly GanttTask[];
  dependencies: readonly StoredGanttDependency[];
  changedIssueKey: string;
  changedDates: { startDate: string; dueDate: string };
  nonWorkingDays: readonly number[];
}

export interface CascadeSchedulePlan {
  updates: CascadeScheduleUpdate[];
}

interface PlannedDates {
  startDate: string;
  dueDate: string;
}

function addCalendarDay(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function workingDuration(
  startDate: string,
  dueDate: string,
  nonWorkingDays: readonly number[],
): number {
  let count = 0;
  for (let current = startDate; current <= dueDate; current = addCalendarDay(current)) {
    if (isWorkingDay(current, [...nonWorkingDays])) count += 1;
  }
  return Math.max(1, count);
}

function latest(left: string | undefined, right: string): string {
  return !left || right > left ? right : left;
}

function constraintBoundary(
  dependency: StoredGanttDependency,
  predecessor: PlannedDates,
  nonWorkingDays: readonly number[],
): { startDate?: string; dueDate?: string } {
  const calendar = [...nonWorkingDays];
  if (dependency.type === "FS") {
    return {
      startDate: nextWorkingDay(
        addWorkingDays(predecessor.dueDate, 1 + dependency.lagWorkingDays, calendar),
        calendar,
      ),
    };
  }
  const anchor = dependency.type === "FF" ? predecessor.dueDate : predecessor.startDate;
  const boundary = nextWorkingDay(
    addWorkingDays(anchor, dependency.lagWorkingDays, calendar),
    calendar,
  );
  if (dependency.type === "SS") return { startDate: boundary };
  return { dueDate: boundary };
}

function topologicalTaskOrder(
  taskKeys: ReadonlySet<string>,
  dependencies: readonly StoredGanttDependency[],
): string[] {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map([...taskKeys].map((key) => [key, 0]));
  for (const dependency of dependencies) {
    if (
      !taskKeys.has(dependency.predecessorIssueKey) ||
      !taskKeys.has(dependency.successorIssueKey)
    ) {
      continue;
    }
    outgoing.set(dependency.predecessorIssueKey, [
      ...(outgoing.get(dependency.predecessorIssueKey) ?? []),
      dependency.successorIssueKey,
    ]);
    indegree.set(
      dependency.successorIssueKey,
      (indegree.get(dependency.successorIssueKey) ?? 0) + 1,
    );
  }
  const queue = [...indegree.entries()]
    .filter(([, value]) => value === 0)
    .map(([key]) => key);
  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    result.push(current);
    for (const successor of outgoing.get(current) ?? []) {
      const next = (indegree.get(successor) ?? 0) - 1;
      indegree.set(successor, next);
      if (next === 0) queue.push(successor);
    }
  }
  if (result.length !== taskKeys.size) {
    throw new Error("The dependency graph contains a cycle.");
  }
  return result;
}

function downstreamKeys(
  root: string,
  dependencies: readonly StoredGanttDependency[],
): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const dependency of dependencies) {
    outgoing.set(dependency.predecessorIssueKey, [
      ...(outgoing.get(dependency.predecessorIssueKey) ?? []),
      dependency.successorIssueKey,
    ]);
  }
  const result = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const successor of outgoing.get(current) ?? []) {
      if (result.has(successor)) continue;
      result.add(successor);
      queue.push(successor);
    }
  }
  return result;
}

export function planCascadeSchedule({
  tasks,
  dependencies,
  changedIssueKey,
  changedDates,
  nonWorkingDays,
}: CascadeScheduleRequest): CascadeSchedulePlan {
  const tasksByKey = new Map(tasks.map((task) => [task.issueKey, task]));
  if (!tasksByKey.has(changedIssueKey)) {
    throw new Error(`Task ${changedIssueKey} is not available in this board.`);
  }
  const planned = new Map<string, PlannedDates>(
    tasks.map((task) => [task.issueKey, { startDate: task.start, dueDate: task.end }]),
  );
  planned.set(changedIssueKey, changedDates);
  const updates = new Map<string, CascadeScheduleUpdate>();
  updates.set(changedIssueKey, {
    issueKey: changedIssueKey,
    ...changedDates,
    source: "direct",
  });

  const incoming = new Map<string, StoredGanttDependency[]>();
  for (const dependency of dependencies) {
    incoming.set(dependency.successorIssueKey, [
      ...(incoming.get(dependency.successorIssueKey) ?? []),
      dependency,
    ]);
  }
  const reachable = downstreamKeys(changedIssueKey, dependencies);
  const order = topologicalTaskOrder(new Set(tasksByKey.keys()), dependencies);
  for (const issueKey of order) {
    if (!reachable.has(issueKey)) continue;
    const task = tasksByKey.get(issueKey);
    const current = planned.get(issueKey);
    if (!task || !current) continue;

    let requiredStart: string | undefined;
    let requiredEnd: string | undefined;
    for (const dependency of incoming.get(issueKey) ?? []) {
      const predecessor = planned.get(dependency.predecessorIssueKey);
      if (!predecessor) continue;
      const boundary = constraintBoundary(dependency, predecessor, nonWorkingDays);
      if (boundary.startDate) requiredStart = latest(requiredStart, boundary.startDate);
      if (boundary.dueDate) requiredEnd = latest(requiredEnd, boundary.dueDate);
    }

    const duration = workingDuration(task.start, task.end, nonWorkingDays);
    let startDate = current.startDate;
    let dueDate = current.dueDate;
    if (requiredStart && startDate < requiredStart) {
      startDate = requiredStart;
      dueDate = addWorkingDays(startDate, duration - 1, [...nonWorkingDays]);
    }
    if (requiredEnd && dueDate < requiredEnd) {
      dueDate = requiredEnd;
      startDate = addWorkingDays(dueDate, -(duration - 1), [...nonWorkingDays]);
    }
    if (startDate === current.startDate && dueDate === current.dueDate) continue;
    planned.set(issueKey, { startDate, dueDate });
    updates.set(issueKey, {
      issueKey,
      startDate,
      dueDate,
      source: "cascade",
    });
  }

  return { updates: [...updates.values()] };
}

export function wouldCreateDependencyCycle(
  dependencies: readonly StoredGanttDependency[],
  predecessorIssueKey: string,
  successorIssueKey: string,
): boolean {
  if (predecessorIssueKey === successorIssueKey) return true;
  const outgoing = new Map<string, string[]>();
  for (const dependency of dependencies) {
    outgoing.set(dependency.predecessorIssueKey, [
      ...(outgoing.get(dependency.predecessorIssueKey) ?? []),
      dependency.successorIssueKey,
    ]);
  }
  const visited = new Set<string>();
  const queue = [successorIssueKey];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    if (current === predecessorIssueKey) return true;
    visited.add(current);
    queue.push(...(outgoing.get(current) ?? []));
  }
  return false;
}
