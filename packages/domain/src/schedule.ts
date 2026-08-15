import type {
  JiraStatusCategory,
  NormalizedIssue,
  NormalizedIssueLink,
} from "./jira-issue";
import type { JiraUser } from "./jira-user";

export interface DefaultDurationDays {
  subtask: number;
  task: number;
  bug: number;
  story: number;
  epic: number;
  unknown: number;
}

export const DEFAULT_DURATION_DAYS: DefaultDurationDays = {
  subtask: 1,
  task: 3,
  bug: 3,
  story: 5,
  epic: 10,
  unknown: 3,
};

export interface IssueTreeNode {
  issue: NormalizedIssue;
  children: IssueTreeNode[];
  depth: number;
  warnings: string[];
}

export type ScheduleWarningCode =
  | "HIERARCHY_CYCLE"
  | "MISSING_PARENT"
  | "MAXIMUM_DEPTH"
  | "INVALID_START_DATE"
  | "INVALID_END_DATE"
  | "END_BEFORE_START"
  | "PARENT_DATE_MISMATCH";

export interface ScheduleWarning {
  issueKey: string;
  code: ScheduleWarningCode;
  message: string;
}

export type StartDateSource = "jira" | "children" | "sprint" | "created" | "today";
export type EndDateSource =
  "jira" | "children" | "sprint" | "resolution" | "default-duration" | "corrected";
export type CalculatedProgressSource =
  "jira-progress" | "subtasks" | "children" | "status" | "none";

export type DependencyRelationshipType = "finish-to-start" | "finish-to-finish";

export interface GanttDependency {
  taskId: string;
  issueKey: string;
  linkId?: string;
  typeName: string;
  relationshipText?: string;
  relationshipType: DependencyRelationshipType;
}

export interface GanttTask {
  id: string;
  issueKey: string;
  browseUrl: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  progressSource: CalculatedProgressSource;
  parentId?: string;
  depth: number;
  expanded: boolean;
  statusName: string;
  statusCategory: JiraStatusCategory;
  priorityName?: string;
  labels?: string[];
  isResolved?: boolean;
  isBlocked?: boolean;
  blockedByTaskIds?: string[];
  assignee?: JiraUser;
  assigneeName?: string;
  issueTypeName: string;
  isSyntheticDate: boolean;
  startSource: StartDateSource;
  endSource: EndDateSource;
  dateWarning?: string;
  hasDateMisalignment?: boolean;
  dependencies: string[];
  dependencyLinks?: GanttDependency[];
}

export type GanttDragGesture = "move" | "resize-start" | "resize-end";

export interface GanttDragResult {
  allowed: boolean;
  startDate?: string;
  dueDate?: string;
  reason?: string;
}

export function applyGanttDrag(
  task: GanttTask,
  gesture: GanttDragGesture,
  deltaDays: number,
): GanttDragResult {
  if (deltaDays === 0) {
    return { allowed: true };
  }

  if (gesture === "move") {
    if (task.startSource !== "jira" || task.endSource !== "jira") {
      return { allowed: false, reason: "Move requires both start and end dates to be Jira fields." };
    }
    return {
      allowed: true,
      startDate: addDays(task.start, deltaDays),
      dueDate: addDays(task.end, deltaDays),
    };
  }

  if (gesture === "resize-start") {
    if (task.startSource !== "jira") {
      return { allowed: false, reason: "Resizing the start requires the start date to be a Jira field." };
    }
    const startDate = addDays(task.start, deltaDays);
    if (startDate > task.end) {
      return { allowed: false, reason: "The new start date cannot be after the end date." };
    }
    return { allowed: true, startDate };
  }

  if (task.endSource !== "jira") {
    return { allowed: false, reason: "Resizing the end requires the end date to be a Jira field." };
  }
  const dueDate = addDays(task.end, deltaDays);
  if (dueDate < task.start) {
    return { allowed: false, reason: "The new end date cannot be before the start date." };
  }
  return { allowed: true, dueDate };
}

export interface GanttScheduleModel {
  roots: IssueTreeNode[];
  tasks: GanttTask[];
  warnings: ScheduleWarning[];
  syntheticDateCount: number;
  dependencyCount: number;
}

export interface ScheduleModelOptions {
  today?: string;
  maximumDepth?: number;
  defaultDurations?: Partial<DefaultDurationDays>;
  blockedStatusNames?: string[];
}

interface HierarchyResult {
  roots: IssueTreeNode[];
  parentByKey: Map<string, string>;
  warnings: ScheduleWarning[];
}

interface ResolvedDates {
  start: string;
  end: string;
  startSource: StartDateSource;
  endSource: EndDateSource;
  isSynthetic: boolean;
  hasDateMisalignment: boolean;
}

interface CalculatedProgress {
  percentage: number;
  source: CalculatedProgressSource;
}

interface ResolvedNode {
  dates: ResolvedDates;
  progress: CalculatedProgress;
}

const SYNTHETIC_DATE_WARNING =
  "One or more dates were inferred because Jira did not provide complete schedule data.";

function addWarning(
  warningsByKey: Map<string, ScheduleWarning[]>,
  issueKey: string,
  code: ScheduleWarningCode,
  message: string,
): void {
  const warning = { issueKey, code, message };
  warningsByKey.set(issueKey, [...(warningsByKey.get(issueKey) ?? []), warning]);
}

function resolveHierarchy(
  issues: NormalizedIssue[],
  maximumDepth: number,
): HierarchyResult {
  const issueByKey = new Map<string, NormalizedIssue>();
  const orderedKeys: string[] = [];
  for (const issue of issues) {
    if (!issueByKey.has(issue.key)) {
      issueByKey.set(issue.key, issue);
      orderedKeys.push(issue.key);
    }
  }

  const candidateParent = new Map<string, string>();
  for (const issue of issueByKey.values()) {
    const parentKey = issue.parentKey ?? issue.epicKey;
    if (parentKey) {
      candidateParent.set(issue.key, parentKey);
    }
  }

  const cycleKeys = new Set<string>();
  const visitState = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (key: string): void => {
    const state = visitState.get(key) ?? 0;
    if (state === 2) {
      return;
    }
    if (state === 1) {
      const cycleStart = stack.indexOf(key);
      stack.slice(Math.max(0, cycleStart)).forEach((cycleKey) => cycleKeys.add(cycleKey));
      return;
    }

    visitState.set(key, 1);
    stack.push(key);
    const parentKey = candidateParent.get(key);
    if (parentKey && issueByKey.has(parentKey)) {
      visit(parentKey);
    }
    stack.pop();
    visitState.set(key, 2);
  };
  orderedKeys.forEach(visit);

  const warningsByKey = new Map<string, ScheduleWarning[]>();
  const parentByKey = new Map<string, string>();
  for (const key of orderedKeys) {
    const parentKey = candidateParent.get(key);
    if (!parentKey) {
      continue;
    }
    if (cycleKeys.has(key)) {
      addWarning(
        warningsByKey,
        key,
        "HIERARCHY_CYCLE",
        "Hierarchy cycle detected; issue was kept at the root.",
      );
    } else if (!issueByKey.has(parentKey)) {
      addWarning(
        warningsByKey,
        key,
        "MISSING_PARENT",
        `Referenced parent ${parentKey} was not loaded; issue was kept at the root.`,
      );
    } else {
      parentByKey.set(key, parentKey);
    }
  }

  const depthByKey = new Map<string, number>();
  const resolveDepth = (key: string): number => {
    const cached = depthByKey.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const parentKey = parentByKey.get(key);
    if (!parentKey) {
      depthByKey.set(key, 0);
      return 0;
    }
    const depth = resolveDepth(parentKey) + 1;
    if (depth > maximumDepth) {
      parentByKey.delete(key);
      depthByKey.set(key, 0);
      addWarning(
        warningsByKey,
        key,
        "MAXIMUM_DEPTH",
        `Maximum hierarchy depth of ${maximumDepth} exceeded; issue was kept at the root.`,
      );
      return 0;
    }
    depthByKey.set(key, depth);
    return depth;
  };
  orderedKeys.forEach(resolveDepth);

  const nodesByKey = new Map<string, IssueTreeNode>();
  for (const key of orderedKeys) {
    const issue = issueByKey.get(key);
    if (!issue) {
      continue;
    }
    nodesByKey.set(key, {
      issue,
      children: [],
      depth: depthByKey.get(key) ?? 0,
      warnings: (warningsByKey.get(key) ?? []).map((warning) => warning.message),
    });
  }

  const roots: IssueTreeNode[] = [];
  for (const key of orderedKeys) {
    const node = nodesByKey.get(key);
    if (!node) {
      continue;
    }
    const parent = nodesByKey.get(parentByKey.get(key) ?? "");
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return {
    roots,
    parentByKey,
    warnings: [...warningsByKey.values()].flat(),
  };
}

export function buildIssueHierarchy(
  issues: NormalizedIssue[],
  maximumDepth = 10,
): IssueTreeNode[] {
  const safeMaximumDepth = normalizedMaximumDepth(maximumDepth);
  return resolveHierarchy(issues, safeMaximumDepth).roots;
}

function normalizedMaximumDepth(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 10;
}

function dateOnly(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
      ? trimmed
      : undefined;
  }
  const timestamp = new Date(trimmed);
  return Number.isNaN(timestamp.getTime())
    ? undefined
    : timestamp.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const timestamp = new Date(`${date}T00:00:00.000Z`);
  timestamp.setUTCDate(timestamp.getUTCDate() + days);
  return timestamp.toISOString().slice(0, 10);
}

function durationDays(start: string, end: string): number {
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const endTime = Date.parse(`${end}T00:00:00.000Z`);
  return Math.max(1, Math.round((endTime - startTime) / 86_400_000));
}

export function normalizeDefaultDurations(
  durations: Partial<DefaultDurationDays> = {},
): DefaultDurationDays {
  const value = (key: keyof DefaultDurationDays): number => {
    const configured = durations[key];
    return typeof configured === "number" && Number.isFinite(configured)
      ? Math.min(365, Math.max(1, Math.trunc(configured)))
      : DEFAULT_DURATION_DAYS[key];
  };
  return {
    subtask: value("subtask"),
    task: value("task"),
    bug: value("bug"),
    story: value("story"),
    epic: value("epic"),
    unknown: value("unknown"),
  };
}

function defaultDurationFor(
  issue: NormalizedIssue,
  durations: DefaultDurationDays,
): number {
  if (issue.issueType.subtask) {
    return durations.subtask;
  }
  const type = issue.issueType.name.trim().toLowerCase();
  if (type.includes("epic")) {
    return durations.epic;
  }
  if (type.includes("story")) {
    return durations.story;
  }
  if (type.includes("bug")) {
    return durations.bug;
  }
  if (type === "task" || type.endsWith(" task")) {
    return durations.task;
  }
  return durations.unknown;
}

function statusProgress(category: JiraStatusCategory): number {
  return category === "done" ? 100 : category === "in-progress" ? 50 : 0;
}

function validPercentage(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 100;
}

function calculateProgress(
  node: IssueTreeNode,
  resolvedChildren: ResolvedNode[],
): CalculatedProgress {
  const issueProgress = node.issue.progress;
  if (
    issueProgress?.source === "jira-progress" &&
    validPercentage(issueProgress.percentage)
  ) {
    return { percentage: Math.round(issueProgress.percentage), source: "jira-progress" };
  }

  const subtasks = node.children
    .map((child, index) => ({ child, resolved: resolvedChildren[index] }))
    .filter(
      (entry): entry is { child: IssueTreeNode; resolved: ResolvedNode } =>
        entry.child.issue.issueType.subtask && entry.resolved !== undefined,
    );
  if (subtasks.length > 0) {
    const completed = subtasks.filter(
      ({ child, resolved }) =>
        child.issue.status.category === "done" || resolved.progress.percentage === 100,
    ).length;
    return {
      percentage: Math.round((completed / subtasks.length) * 100),
      source: "subtasks",
    };
  }

  if (issueProgress?.source === "subtasks" && validPercentage(issueProgress.percentage)) {
    return { percentage: Math.round(issueProgress.percentage), source: "subtasks" };
  }

  if (resolvedChildren.length > 0) {
    const weighted = resolvedChildren.map((child) => ({
      weight: durationDays(child.dates.start, child.dates.end),
      percentage: child.progress.percentage,
    }));
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    return {
      percentage: Math.round(
        weighted.reduce((sum, item) => sum + item.percentage * item.weight, 0) /
          totalWeight,
      ),
      source: "children",
    };
  }

  if (issueProgress && validPercentage(issueProgress.percentage)) {
    return {
      percentage: Math.round(issueProgress.percentage),
      source: issueProgress.source,
    };
  }

  const category = node.issue.status.category ?? "unknown";
  return {
    percentage: statusProgress(category),
    source: category === "unknown" ? "none" : "status",
  };
}

function dependencyMap(
  issues: NormalizedIssue[],
): Map<string, Map<string, GanttDependency>> {
  const issueByKey = new Map(issues.map((issue) => [issue.key, issue]));
  const dependencies = new Map<string, Map<string, GanttDependency>>(
    issues.map((issue) => [issue.key, new Map<string, GanttDependency>()]),
  );
  const add = (
    dependentKey: string,
    prerequisiteKey: string,
    link: NormalizedIssueLink,
  ): void => {
    const dependent = dependencies.get(dependentKey);
    const prerequisite = issueByKey.get(prerequisiteKey);
    if (dependent && prerequisite && dependentKey !== prerequisiteKey) {
      const existing = dependent.get(prerequisite.id);
      if (!existing || (!existing.linkId && link.id)) {
        dependent.set(prerequisite.id, {
          taskId: prerequisite.id,
          issueKey: prerequisite.key,
          ...(link.id ? { linkId: link.id } : {}),
          typeName: link.typeName,
          ...(link.relationshipText ? { relationshipText: link.relationshipText } : {}),
          relationshipType:
            link.semanticType === "finish-to-finish"
              ? "finish-to-finish"
              : "finish-to-start",
        });
      }
    }
  };

  for (const issue of issues) {
    for (const link of issue.issueLinks) {
      applyDependencyLink(issue.key, link, add);
    }
  }
  return dependencies;
}

function applyDependencyLink(
  issueKey: string,
  link: NormalizedIssueLink,
  add: (dependentKey: string, prerequisiteKey: string, link: NormalizedIssueLink) => void,
): void {
  if (link.semanticType === "is-blocked-by") {
    add(issueKey, link.linkedIssueKey, link);
  } else if (link.semanticType === "blocks") {
    add(link.linkedIssueKey, issueKey, link);
  } else if (
    link.semanticType === "depends-on" ||
    link.semanticType === "finish-to-finish"
  ) {
    if (link.direction === "outward") {
      add(issueKey, link.linkedIssueKey, link);
    } else {
      add(link.linkedIssueKey, issueKey, link);
    }
  }
}

export function buildGanttScheduleModel(
  issues: NormalizedIssue[],
  options: ScheduleModelOptions = {},
): GanttScheduleModel {
  const maximumDepth = normalizedMaximumDepth(options.maximumDepth ?? 10);
  const hierarchy = resolveHierarchy(issues, maximumDepth);
  const durations = normalizeDefaultDurations(options.defaultDurations);
  const today = dateOnly(options.today ?? new Date().toISOString().slice(0, 10));
  if (!today) {
    throw new Error("Schedule today must be a valid date.");
  }

  const scheduleWarnings = [...hierarchy.warnings];
  const resolvedByKey = new Map<string, ResolvedNode>();
  const selectSprint = (issue: NormalizedIssue) => {
    const active = issue.sprints?.find((sprint) => sprint.state === "active");
    if (active) return active;
    const future = issue.sprints
      ?.filter((sprint) => sprint.state === "future")
      .sort((left, right) => (left.startDate ?? "9999-99-99").localeCompare(right.startDate ?? "9999-99-99"))[0];
    if (future) return future;
    return issue.sprints
      ?.filter((sprint) => sprint.state === "closed")
      .sort((left, right) => (right.endDate ?? "").localeCompare(left.endDate ?? ""))[0];
  };
  const resolveNode = (node: IssueTreeNode): ResolvedNode => {
    const resolvedChildren = node.children.map(resolveNode);
    const rawStart = node.issue.startDate;
    const explicitStart = dateOnly(rawStart);
    if (rawStart && !explicitStart) {
      scheduleWarnings.push({
        issueKey: node.issue.key,
        code: "INVALID_START_DATE",
        message: `Invalid start date “${rawStart}” was ignored.`,
      });
    }
    const hasChildren = resolvedChildren.length > 0;
    const childStarts = resolvedChildren.map((child) => child.dates.start).sort();
    const rollupStart = hasChildren ? childStarts[0] : undefined;
    const created = dateOnly(node.issue.createdAt);
    const sprint = selectSprint(node.issue);
    const sprintStart = sprint ? dateOnly(sprint.startDate) : undefined;
    const start = rollupStart ?? explicitStart ?? sprintStart ?? created ?? today;
    const startSource: StartDateSource = rollupStart
      ? "children"
      : explicitStart
        ? "jira"
        : sprintStart
          ? "sprint"
        : created
          ? "created"
          : "today";

    const rawEnd = node.issue.dueDate;
    const explicitEnd = dateOnly(rawEnd);
    if (rawEnd && !explicitEnd) {
      scheduleWarnings.push({
        issueKey: node.issue.key,
        code: "INVALID_END_DATE",
        message: `Invalid end date “${rawEnd}” was ignored.`,
      });
    }
    const childEnds = resolvedChildren.map((child) => child.dates.end).sort();
    const rollupEnd = hasChildren ? childEnds.at(-1) : undefined;
    const resolution = dateOnly(node.issue.resolvedAt);
    const sprintEnd = sprint ? dateOnly(sprint.endDate) : undefined;
    const fallbackEnd = addDays(start, defaultDurationFor(node.issue, durations));
    let end = rollupEnd ?? explicitEnd ?? sprintEnd ?? resolution ?? fallbackEnd;
    let endSource: EndDateSource = rollupEnd
      ? "children"
      : explicitEnd
        ? "jira"
        : sprintEnd
          ? "sprint"
        : resolution
          ? "resolution"
          : "default-duration";

    let hasDateMisalignment = false;
    if (hasChildren) {
      if (explicitStart !== undefined && explicitStart !== rollupStart) {
        hasDateMisalignment = true;
      }
      if (explicitEnd !== undefined && explicitEnd !== rollupEnd) {
        hasDateMisalignment = true;
      }
      if (hasDateMisalignment) {
        scheduleWarnings.push({
          issueKey: node.issue.key,
          code: "PARENT_DATE_MISMATCH",
          message: `Rollup dates (${rollupStart}–${rollupEnd}) differ from this issue’s own Start/Due date (${explicitStart ?? "—"}–${explicitEnd ?? "—"}); the rollup is used for the bar.`,
        });
      }
    }

    if (end < start) {
      end = fallbackEnd;
      endSource = "corrected";
      scheduleWarnings.push({
        issueKey: node.issue.key,
        code: "END_BEFORE_START",
        message: "End date preceded start date and was corrected using default duration.",
      });
    }

    const resolved = {
      dates: {
        start,
        end,
        startSource,
        endSource,
        isSynthetic: startSource !== "jira" || endSource !== "jira",
        hasDateMisalignment,
      },
      progress: calculateProgress(node, resolvedChildren),
    } satisfies ResolvedNode;
    resolvedByKey.set(node.issue.key, resolved);
    return resolved;
  };
  hierarchy.roots.forEach(resolveNode);

  const dependencies = dependencyMap(issues);
  const issueByKey = new Map(issues.map((issue) => [issue.key, issue]));
  const blockedStatusNames = new Set(
    (options.blockedStatusNames ?? ["blocked", "impeded", "on hold"]).map((status) =>
      status.trim().toLocaleLowerCase(),
    ),
  );
  const tasks: GanttTask[] = [];
  const appendTask = (node: IssueTreeNode): void => {
    const resolved = resolvedByKey.get(node.issue.key);
    if (!resolved) {
      return;
    }
    const parentKey = hierarchy.parentByKey.get(node.issue.key);
    const parentIssue = parentKey ? issueByKey.get(parentKey) : undefined;
    tasks.push({
      id: node.issue.id,
      issueKey: node.issue.key,
      browseUrl: node.issue.browseUrl,
      name: node.issue.summary,
      start: resolved.dates.start,
      end: resolved.dates.end,
      progress: resolved.progress.percentage,
      progressSource: resolved.progress.source,
      ...(parentIssue ? { parentId: parentIssue.id } : {}),
      depth: node.depth,
      expanded: false,
      statusName: node.issue.status.name,
      statusCategory: node.issue.status.category ?? "unknown",
      ...(node.issue.priority?.name ? { priorityName: node.issue.priority.name } : {}),
      labels: [...node.issue.labels],
      isResolved: Boolean(node.issue.resolvedAt) || node.issue.status.category === "done",
      ...(node.issue.assignee ? { assignee: node.issue.assignee } : {}),
      ...(node.issue.assignee?.displayName
        ? { assigneeName: node.issue.assignee.displayName }
        : {}),
      issueTypeName: node.issue.issueType.name,
      isSyntheticDate: resolved.dates.isSynthetic,
      startSource: resolved.dates.startSource,
      endSource: resolved.dates.endSource,
      ...(resolved.dates.isSynthetic ? { dateWarning: SYNTHETIC_DATE_WARNING } : {}),
      hasDateMisalignment: resolved.dates.hasDateMisalignment,
      dependencies: [...(dependencies.get(node.issue.key)?.keys() ?? [])],
      dependencyLinks: [...(dependencies.get(node.issue.key)?.values() ?? [])],
    });
    node.children.forEach(appendTask);
  };
  hierarchy.roots.forEach(appendTask);

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    const blockedByTaskIds = task.dependencies.filter(
      (dependencyId) => taskById.get(dependencyId)?.statusCategory !== "done",
    );
    task.blockedByTaskIds = blockedByTaskIds;
    task.isBlocked =
      blockedByTaskIds.length > 0 ||
      blockedStatusNames.has(task.statusName.trim().toLocaleLowerCase());
  }

  return {
    roots: hierarchy.roots,
    tasks,
    warnings: scheduleWarnings,
    syntheticDateCount: tasks.filter((task) => task.isSyntheticDate).length,
    dependencyCount: tasks.reduce((count, task) => count + task.dependencies.length, 0),
  };
}
