import type { DescriptionReportPeriod } from "./description-report";
import type {
  NormalizedReportUser,
  ReportChangeEvent,
  ReportingIssueSnapshot,
} from "./reporting";

export type WorkActivityChangeType =
  | "status-changed"
  | "assignee-changed"
  | "description-changed"
  | "sprint-added"
  | "sprint-removed";

/** Description bodies are deliberately absent from this normalized delivery model. */
export interface WorkActivityChange {
  id: string;
  type: WorkActivityChangeType;
  occurredAt: string;
  actor?: NormalizedReportUser;
  from?: string | number | null;
  to?: string | number | null;
  sprintId?: string;
}

export interface WorkActivityRow {
  issueId: string;
  issueKey: string;
  summary: string;
  issueType: string;
  parentId?: string;
  depth: number;
  contextOnly: boolean;
  currentStatus: { id?: string; name: string };
  currentAssignee?: NormalizedReportUser;
  changes: WorkActivityChange[];
}

export interface WorkActivityStatusGroup {
  statusId?: string;
  statusName: string;
  rows: WorkActivityRow[];
}

export interface WorkActivityReport {
  schemaVersion: 1;
  id: string;
  jiraBaseUrl: string;
  boardId: string;
  boardName: string;
  period: DescriptionReportPeriod;
  generatedAt: string;
  changedIssueCount: number;
  changeCount: number;
  statusChangedIssueCount: number;
  assigneeChangedIssueCount: number;
  descriptionChangedIssueCount: number;
  sprintChangedIssueCount: number;
  rows: WorkActivityRow[];
  statusGroups: WorkActivityStatusGroup[];
  assigneeChanges: WorkActivityRow[];
  descriptionChanges: WorkActivityRow[];
  sprintChanges: WorkActivityRow[];
}

const acceptedTypes = new Set<string>([
  "status-changed",
  "assignee-changed",
  "description-changed",
  "sprint-added",
  "sprint-removed",
]);

function person(user: NormalizedReportUser): NormalizedReportUser {
  return { id: user.id, displayName: user.displayName };
}

function sanitize(event: ReportChangeEvent): WorkActivityChange {
  return {
    id: event.id,
    type: event.type as WorkActivityChangeType,
    occurredAt: new Date(event.occurredAt).toISOString(),
    ...(event.actor ? { actor: person(event.actor) } : {}),
    ...(event.type === "description-changed"
      ? {}
      : {
          ...(event.from === undefined ? {} : { from: event.from }),
          ...(event.to === undefined ? {} : { to: event.to }),
          ...(event.sprintId === undefined ? {} : { sprintId: event.sprintId }),
        }),
  };
}

const statusOrder = [
  "To Do",
  "In Progress",
  "In Review",
  "In Testing",
  "Acceptance",
  "Done",
];

/** Each status-changing issue belongs to its CURRENT status exactly once, even when
 * today's event chain ends elsewhere because a delayed run observes a later change. */
export function buildWorkActivityReport(input: {
  jiraBaseUrl: string;
  boardId: string;
  boardName: string;
  period: DescriptionReportPeriod;
  generatedAt: string;
  issues: readonly ReportingIssueSnapshot[];
  events: readonly ReportChangeEvent[];
}): WorkActivityReport {
  const start = Date.parse(input.period.start);
  const end = Date.parse(input.period.end);
  const generated = Date.parse(input.generatedAt);
  const date = new Date(input.period.date + "T12:00:00.000Z");
  if (
    input.period.timeZone !== "Europe/Kyiv" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.period.date) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.period.date ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    !Number.isFinite(generated) ||
    generated < end
  )
    throw new Error("The work report must use a complete, closed Kyiv period.");
  const origin = new URL(input.jiraBaseUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password)
    throw new Error("Use a valid HTTPS Jira URL.");

  const issues = new Map<string, ReportingIssueSnapshot>();
  const byKey = new Map<string, ReportingIssueSnapshot>();
  for (const issue of input.issues) {
    if (issues.has(issue.id) || byKey.has(issue.key))
      throw new Error("The work report contains duplicate Jira issues.");
    issues.set(issue.id, issue);
    byKey.set(issue.key, issue);
  }
  const grouped = new Map<string, WorkActivityChange[]>();
  const seen = new Map<string, string>();
  for (const event of input.events) {
    if (!acceptedTypes.has(event.type)) continue;
    const time = Date.parse(event.occurredAt);
    if (!Number.isFinite(time)) throw new Error("Jira returned an invalid change time.");
    if (time < start || time >= end) continue;
    if (!issues.has(event.issueId))
      throw new Error("A changed issue is missing from the work report.");
    const normalized = sanitize(event);
    const identity = JSON.stringify([event.issueId, normalized]);
    const prior = seen.get(event.id);
    if (prior !== undefined) {
      if (prior !== identity) throw new Error("Jira returned conflicting change IDs.");
      continue;
    }
    seen.set(event.id, identity);
    grouped.set(event.issueId, [...(grouped.get(event.issueId) ?? []), normalized]);
  }

  function parentOf(issue: ReportingIssueSnapshot): ReportingIssueSnapshot | undefined {
    const parent =
      (issue.parentId ? issues.get(issue.parentId) : undefined) ??
      (issue.parentKey ? byKey.get(issue.parentKey) : undefined);
    if (
      parent &&
      ((issue.parentId && issue.parentId !== parent.id) ||
        (issue.parentKey && issue.parentKey !== parent.key))
    )
      throw new Error("Jira returned an inconsistent parent reference.");
    return parent;
  }
  const included = new Set<string>();
  for (const id of grouped.keys()) {
    let current = issues.get(id);
    const path = new Set<string>();
    while (current) {
      if (path.has(current.id) || path.size > 50)
        throw new Error("Jira returned a cyclic or excessively deep issue hierarchy.");
      path.add(current.id);
      included.add(current.id);
      const parent = parentOf(current);
      if ((current.parentId || current.parentKey) && !parent)
        throw new Error("An ancestor is unavailable. Work report generation stopped.");
      current = parent;
    }
  }
  const roots: ReportingIssueSnapshot[] = [];
  const children = new Map<string, ReportingIssueSnapshot[]>();
  for (const id of included) {
    const issue = issues.get(id)!;
    const parent = parentOf(issue);
    if (parent) children.set(parent.id, [...(children.get(parent.id) ?? []), issue]);
    else roots.push(issue);
  }
  const compare = (a: ReportingIssueSnapshot, b: ReportingIssueSnapshot) =>
    a.key.localeCompare(b.key, "en", { numeric: true });
  const rows: WorkActivityRow[] = [];
  function visit(issue: ReportingIssueSnapshot, depth: number) {
    const parent = parentOf(issue);
    const changes = [...(grouped.get(issue.id) ?? [])].sort(
      (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
    );
    if (!issue.status.name.trim()) throw new Error("The current Jira status is missing.");
    rows.push({
      issueId: issue.id,
      issueKey: issue.key,
      summary: issue.summary,
      issueType: issue.issueType.name,
      ...(parent ? { parentId: parent.id } : {}),
      depth,
      contextOnly: changes.length === 0,
      currentStatus: { ...issue.status },
      ...(issue.assignee ? { currentAssignee: person(issue.assignee) } : {}),
      changes,
    });
    for (const child of (children.get(issue.id) ?? []).sort(compare))
      visit(child, depth + 1);
  }
  for (const root of roots.sort(compare)) visit(root, 0);

  const changed = rows.filter((row) => !row.contextOnly);
  const has = (row: WorkActivityRow, type: WorkActivityChangeType) =>
    row.changes.some((change) => change.type === type);
  const groups = new Map<string, WorkActivityStatusGroup>();
  for (const row of changed.filter((row) => has(row, "status-changed"))) {
    const key = row.currentStatus.id ?? row.currentStatus.name;
    const group = groups.get(key) ?? {
      ...(row.currentStatus.id ? { statusId: row.currentStatus.id } : {}),
      statusName: row.currentStatus.name,
      rows: [],
    };
    if (group.statusName !== row.currentStatus.name)
      throw new Error("Jira returned conflicting current status names.");
    group.rows.push(row);
    groups.set(key, group);
  }
  const statusGroups = [...groups.values()].sort((a, b) => {
    const ai = statusOrder.indexOf(a.statusName);
    const bi = statusOrder.indexOf(b.statusName);
    return (
      (ai < 0 ? statusOrder.length : ai) - (bi < 0 ? statusOrder.length : bi) ||
      a.statusName.localeCompare(b.statusName, "uk") ||
      (a.statusId ?? "").localeCompare(b.statusId ?? "")
    );
  });
  const assigneeChanges = changed.filter((row) => has(row, "assignee-changed"));
  const descriptionChanges = changed.filter((row) => has(row, "description-changed"));
  const sprintChanges = changed.filter(
    (row) => has(row, "sprint-added") || has(row, "sprint-removed"),
  );
  return {
    schemaVersion: 1,
    id: `work-activity:${input.boardId}:${input.period.date}`,
    jiraBaseUrl: origin.origin,
    boardId: input.boardId,
    boardName: input.boardName,
    period: { ...input.period },
    generatedAt: new Date(generated).toISOString(),
    changedIssueCount: changed.length,
    changeCount: changed.reduce((sum, row) => sum + row.changes.length, 0),
    statusChangedIssueCount: statusGroups.reduce(
      (sum, group) => sum + group.rows.length,
      0,
    ),
    assigneeChangedIssueCount: assigneeChanges.length,
    descriptionChangedIssueCount: descriptionChanges.length,
    sprintChangedIssueCount: sprintChanges.length,
    rows,
    statusGroups,
    assigneeChanges,
    descriptionChanges,
    sprintChanges,
  };
}
