import type { JiraStatusCategory } from "./jira-issue";
import type { GanttTask } from "./schedule";

export const UNASSIGNED_FILTER_VALUE = "__unassigned__";
export const NO_PRIORITY_FILTER_VALUE = "__no_priority__";
export const NO_LABEL_FILTER_VALUE = "__no_label__";

export type GanttDateFilter =
  "explicit" | "partial" | "inferred" | "corrected" | "overdue";
export type GanttRiskFilter = "blocked" | "unresolved";

export type GanttDateQuality = "explicit" | "partial" | "inferred" | "corrected";
export type GanttFilterLogic = "and" | "or";
export type GanttSortOption =
  "default" | "startDate" | "endDate" | "name" | "status" | "assignee" | "issueKey";
export type GanttSortDirection = "asc" | "desc";
const STATUS_CATEGORY_ORDER: Record<JiraStatusCategory, number> = {
  unknown: 0,
  "to-do": 1,
  "in-progress": 2,
  done: 3,
};

export function sortGanttTasks(
  tasks: GanttTask[],
  sortBy: GanttSortOption,
  direction: GanttSortDirection = "asc",
): GanttTask[] {
  if (sortBy === "default") return tasks;

  const order = new Map(tasks.map((task, index) => [task.id, index]));
  const children = new Map<string | undefined, GanttTask[]>();
  for (const task of tasks) {
    const key = task.parentId && order.has(task.parentId) ? task.parentId : undefined;
    const siblings = children.get(key);
    if (siblings) siblings.push(task);
    else children.set(key, [task]);
  }
  const value = (task: GanttTask): string => {
    switch (sortBy) {
      case "startDate":
        return task.start;
      case "endDate":
        return task.end;
      case "name":
        return task.name;
      case "status":
        return task.statusName;
      case "assignee":
        return task.assigneeName ?? "";
      case "issueKey":
        return task.issueKey;
    }
  };
  // Construct locale options once per sort, rather than for every comparison.
  const collator = new Intl.Collator(undefined, {
    sensitivity:
      sortBy === "status" || sortBy === "name" || sortBy === "assignee"
        ? "base"
        : "variant",
  });
  const multiplier = direction === "desc" ? -1 : 1;
  const compare = (left: GanttTask, right: GanttTask): number => {
    if (sortBy === "status") {
      const categoryOrder =
        STATUS_CATEGORY_ORDER[left.statusCategory] -
        STATUS_CATEGORY_ORDER[right.statusCategory];
      if (categoryOrder !== 0) return multiplier * categoryOrder;
    }

    // Status names retain their original whitespace in locale comparisons.
    const leftValue = sortBy === "status" ? left.statusName : value(left).trim();
    const rightValue = sortBy === "status" ? right.statusName : value(right).trim();
    const leftEmpty = !leftValue.trim();
    const rightEmpty = !rightValue.trim();
    if (leftEmpty !== rightEmpty) return multiplier * (leftEmpty ? 1 : -1);
    const compared = leftEmpty ? 0 : collator.compare(leftValue, rightValue);
    return (
      multiplier * (compared || (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
    );
  };
  for (const group of children.values()) group.sort(compare);

  const result: GanttTask[] = [];
  const visited = new Set<string>();
  const visit = (task: GanttTask) => {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    result.push(task);
    for (const child of children.get(task.id) ?? []) visit(child);
  };
  for (const root of children.get(undefined) ?? []) visit(root);
  for (const task of tasks) visit(task);
  return result;
}

export interface GanttFilters {
  search: string;
  statuses: string[];
  statusCategories: JiraStatusCategory[];
  assignees: string[];
  issueTypes: string[];
  priorities: string[];
  labels: string[];
  dateFilters: GanttDateFilter[];
  riskFilters: GanttRiskFilter[];
  logic: GanttFilterLogic;
  includeDescendants: boolean;
  excludeDone: boolean;
}

export const DEFAULT_GANTT_FILTERS: Readonly<GanttFilters> = {
  search: "",
  statuses: [],
  statusCategories: [],
  assignees: [],
  issueTypes: [],
  priorities: [],
  labels: [],
  dateFilters: [],
  riskFilters: [],
  logic: "and",
  includeDescendants: false,
  excludeDone: false,
};

export interface GanttFilterResult {
  tasks: GanttTask[];
  directMatchIds: Set<string>;
  contextAncestorIds: Set<string>;
  autoExpandedIds: Set<string>;
  active: boolean;
}

export function ganttDateQuality(task: GanttTask): GanttDateQuality {
  if (task.endSource === "corrected") {
    return "corrected";
  }
  const explicitCount =
    Number(task.startSource === "jira") + Number(task.endSource === "jira");
  return explicitCount === 2 ? "explicit" : explicitCount === 1 ? "partial" : "inferred";
}

export function isGanttFilterActive(filters: GanttFilters): boolean {
  return Boolean(
    filters.search.trim() ||
    filters.statuses.length ||
    filters.statusCategories.length ||
    filters.assignees.length ||
    filters.issueTypes.length ||
    filters.priorities.length ||
    filters.labels.length ||
    filters.dateFilters.length ||
    filters.riskFilters.length ||
    filters.excludeDone,
  );
}

function matchesDateFilter(
  task: GanttTask,
  dateFilter: GanttDateFilter,
  today: string,
): boolean {
  if (dateFilter === "overdue") {
    return task.end < today && task.statusCategory !== "done";
  }
  return ganttDateQuality(task) === dateFilter;
}

interface CompiledGanttFilters {
  search: string;
  statuses: Set<string>;
  statusCategories: Set<JiraStatusCategory>;
  assignees: Set<string>;
  issueTypes: Set<string>;
  priorities: Set<string>;
  labels: Set<string>;
  dateFilters: Set<GanttDateFilter>;
  riskFilters: Set<GanttRiskFilter>;
  logic: GanttFilterLogic;
  excludeDone: boolean;
}

function compileFilters(filters: GanttFilters): CompiledGanttFilters {
  return {
    search: filters.search.trim().toLocaleLowerCase(),
    statuses: new Set(filters.statuses),
    statusCategories: new Set(filters.statusCategories),
    assignees: new Set(filters.assignees),
    issueTypes: new Set(filters.issueTypes),
    priorities: new Set(filters.priorities),
    labels: new Set(filters.labels),
    dateFilters: new Set(filters.dateFilters),
    riskFilters: new Set(filters.riskFilters),
    logic: filters.logic,
    excludeDone: filters.excludeDone,
  };
}

function matchesFilters(
  task: GanttTask,
  filters: CompiledGanttFilters,
  today: string,
): boolean {
  const searchMatches =
    !filters.search ||
    task.issueKey.toLocaleLowerCase().includes(filters.search) ||
    task.name.toLocaleLowerCase().includes(filters.search);
  if (!searchMatches) {
    return false;
  }
  if (filters.excludeDone && task.statusCategory === "done") return false;

  const groupMatches: boolean[] = [];
  if (filters.statuses.size > 0) {
    groupMatches.push(filters.statuses.has(task.statusName));
  }
  if (filters.statusCategories.size > 0) {
    groupMatches.push(filters.statusCategories.has(task.statusCategory));
  }
  if (filters.assignees.size > 0) {
    groupMatches.push(
      task.assigneeName
        ? filters.assignees.has(task.assigneeName)
        : filters.assignees.has(UNASSIGNED_FILTER_VALUE),
    );
  }
  if (filters.issueTypes.size > 0) {
    groupMatches.push(filters.issueTypes.has(task.issueTypeName));
  }
  if (filters.priorities.size > 0) {
    groupMatches.push(
      task.priorityName
        ? filters.priorities.has(task.priorityName)
        : filters.priorities.has(NO_PRIORITY_FILTER_VALUE),
    );
  }
  if (filters.labels.size > 0) {
    const taskLabels = task.labels ?? [];
    groupMatches.push(
      taskLabels.length === 0
        ? filters.labels.has(NO_LABEL_FILTER_VALUE)
        : taskLabels.some((label) => filters.labels.has(label)),
    );
  }
  if (filters.dateFilters.size > 0) {
    let dateMatches = false;
    for (const dateFilter of filters.dateFilters) {
      if (matchesDateFilter(task, dateFilter, today)) {
        dateMatches = true;
        break;
      }
    }
    groupMatches.push(dateMatches);
  }
  if (filters.riskFilters.size > 0) {
    let riskMatches = false;
    for (const riskFilter of filters.riskFilters) {
      if (
        (riskFilter === "blocked" && task.isBlocked) ||
        (riskFilter === "unresolved" &&
          !(task.isResolved ?? task.statusCategory === "done"))
      ) {
        riskMatches = true;
        break;
      }
    }
    groupMatches.push(riskMatches);
  }

  return (
    groupMatches.length === 0 ||
    (filters.logic === "and" ? groupMatches.every(Boolean) : groupMatches.some(Boolean))
  );
}

export function filterGanttTasks(
  tasks: GanttTask[],
  filters: GanttFilters,
  today: string,
): GanttFilterResult {
  const active = isGanttFilterActive(filters);
  if (!active) {
    return {
      tasks,
      directMatchIds: new Set(tasks.map((task) => task.id)),
      contextAncestorIds: new Set(),
      autoExpandedIds: new Set(),
      active: false,
    };
  }

  const compiledFilters = compileFilters(filters);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const childrenByParent = new Map<string, string[]>();
  const directMatchIds = new Set<string>();
  for (const task of tasks) {
    if (filters.includeDescendants && task.parentId) {
      const children = childrenByParent.get(task.parentId);
      if (children) children.push(task.id);
      else childrenByParent.set(task.parentId, [task.id]);
    }
    if (matchesFilters(task, compiledFilters, today)) directMatchIds.add(task.id);
  }
  const includedIds = new Set(directMatchIds);
  const contextAncestorIds = new Set<string>();

  // Shared ancestors only need to be followed once, including cyclic links.
  const visited = new Set<string>();
  for (const matchId of directMatchIds) {
    let parentId = taskById.get(matchId)?.parentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      includedIds.add(parentId);
      if (!directMatchIds.has(parentId)) {
        contextAncestorIds.add(parentId);
      }
      parentId = taskById.get(parentId)?.parentId;
    }
  }

  if (filters.includeDescendants) {
    const queue = [...directMatchIds];
    const expandedMatches = new Set<string>();
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const parentId = queue[cursor];
      if (!parentId || expandedMatches.has(parentId)) {
        continue;
      }
      expandedMatches.add(parentId);
      for (const childId of childrenByParent.get(parentId) ?? []) {
        includedIds.add(childId);
        queue.push(childId);
      }
    }
  }

  const filteredTasks = tasks.filter((task) => includedIds.has(task.id));
  const autoExpandedIds = new Set<string>();
  filteredTasks.forEach((task) => {
    if (task.parentId && includedIds.has(task.parentId)) {
      autoExpandedIds.add(task.parentId);
    }
  });

  return {
    tasks: filteredTasks,
    directMatchIds,
    contextAncestorIds,
    autoExpandedIds,
    active: true,
  };
}
