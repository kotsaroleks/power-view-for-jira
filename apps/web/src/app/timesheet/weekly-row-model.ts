import type { WorklogPickerIssue } from "@power-view/jira-client";
import type { timesheetRows } from "./timesheet-model";

type TimesheetRow = ReturnType<typeof timesheetRows>[number];
export type WeeklyGroup = 0 | 1 | 2 | 3 | 4;
export interface WeeklyRow extends TimesheetRow {
  group: WeeklyGroup;
  depth: number;
  hasChildren: boolean;
  withoutParent: boolean;
  parentHeading?: WorklogPickerIssue;
}

/** One accounting row per issue; hierarchy is only a presentation of those rows. */
export function weeklyRows({
  rows,
  boardIssues,
  accountId,
  pins,
  priorities,
  expanded,
  search,
}: {
  rows: TimesheetRow[];
  boardIssues: WorklogPickerIssue[];
  accountId: string;
  pins: string[];
  priorities: string[];
  expanded: string[];
  search: string;
}): WeeklyRow[] {
  const metadata = new Map(boardIssues.map((issue) => [issue.key, issue]));
  const pinned = new Set(pins);
  const priority = new Set(priorities);
  const open = new Set(expanded);
  const parents = new Map(boardIssues.map((issue) => [issue.key, issue.parentKey]));
  // A malformed parent cycle must not make all its tasks permanently invisible.
  for (const issue of boardIssues) {
    const path = new Set<string>();
    let key: string | null | undefined = issue.key;
    while (key && !path.has(key)) {
      path.add(key);
      key = parents.get(key);
    }
    if (key) parents.set(key, null);
  }
  const children = new Map<string, TimesheetRow[]>();
  const groups = new Map<string, WeeklyGroup>();
  for (const row of rows) {
    const key = row.issue.key;
    let current: string | null | undefined = key;
    while (current && !priority.has(current)) current = parents.get(current);
    groups.set(
      key,
      pinned.has(key)
        ? 0
        : row.cells.size
          ? 1
          : current
            ? 2
            : metadata.get(key)?.assigneeId === accountId
              ? 3
              : 4,
    );
    const parent = parents.get(key);
    if (parent) {
      const siblings = children.get(parent) ?? [];
      siblings.push(row);
      children.set(parent, siblings);
    }
  }
  const ordered: TimesheetRow[] = [];
  const visited = new Set<string>();
  const appendTree = (row: TimesheetRow, group: WeeklyGroup) => {
    if (visited.has(row.issue.key) || groups.get(row.issue.key) !== group) return;
    visited.add(row.issue.key);
    ordered.push(row);
    children.get(row.issue.key)?.forEach((child) => appendTree(child, group));
  };
  for (const group of [0, 1, 2, 3, 4] as const) {
    const selected = rows.filter((row) => groups.get(row.issue.key) === group);
    if (group === 2 || group === 4) {
      selected
        .filter((row) => metadata.get(row.issue.key)?.hierarchyLevel === 1)
        .forEach((row) => appendTree(row, group));
      selected
        .filter((row) => {
          const parent = parents.get(row.issue.key);
          return parent && metadata.has(parent) && groups.get(parent) !== group;
        })
        .forEach((row) => appendTree(row, group));
      selected
        .filter((row) => {
          const parent = parents.get(row.issue.key);
          return !parent || !metadata.has(parent);
        })
        .forEach((row) => appendTree(row, group));
    }
    selected.forEach((row) => appendTree(row, group));
  }
  const needle = search.trim().toLocaleLowerCase();
  const result: WeeklyRow[] = [];
  let previousParent: string | undefined;
  for (const row of ordered) {
    const group = groups.get(row.issue.key)!;
    let depth = 0;
    let visible = true;
    let parent = parents.get(row.issue.key);
    if (group === 2 || group === 4) {
      while (parent && groups.get(parent) === group) {
        depth++;
        if (!open.has(parent)) visible = false;
        parent = parents.get(parent);
      }
    }
    if (
      needle
        ? !`${row.issue.key} ${row.issue.summary}`.toLocaleLowerCase().includes(needle)
        : !visible
    )
      continue;
    const directParent = parents.get(row.issue.key);
    const heading =
      group === 4 && depth === 0 && directParent ? metadata.get(directParent) : undefined;
    result.push({
      ...row,
      group,
      depth,
      hasChildren: children.has(row.issue.key),
      withoutParent:
        group === 4 &&
        (!directParent || !metadata.has(directParent)) &&
        metadata.get(row.issue.key)?.hierarchyLevel !== 1,
      ...(heading && heading.key !== previousParent ? { parentHeading: heading } : {}),
    });
    previousParent = heading?.key;
  }
  return result;
}
