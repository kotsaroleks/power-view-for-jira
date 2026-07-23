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
    filters.riskFilters.length,
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
  tasks.forEach((task) => {
    if (task.parentId) {
      childrenByParent.set(task.parentId, [
        ...(childrenByParent.get(task.parentId) ?? []),
        task.id,
      ]);
    }
  });

  const directMatchIds = new Set(
    tasks
      .filter((task) => matchesFilters(task, compiledFilters, today))
      .map((task) => task.id),
  );
  const includedIds = new Set(directMatchIds);
  const contextAncestorIds = new Set<string>();

  for (const matchId of directMatchIds) {
    const visited = new Set<string>();
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
    while (queue.length > 0) {
      const parentId = queue.shift();
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
