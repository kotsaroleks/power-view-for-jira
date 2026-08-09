import type {
  BoardReportConfiguration,
  ReportChangeEvent,
  ReportingIssueSnapshot,
} from "@power-view/domain";

export function isIssueFinished(
  issue: ReportingIssueSnapshot,
  statusMapping: BoardReportConfiguration,
): boolean {
  return issue.status.id
    ? statusMapping.completedStatusIds.includes(issue.status.id)
    : statusMapping.completedStatusNames.includes(issue.status.name);
}

export interface ActivityLogEntry {
  key: string;
  occurredAt: string;
  issueKey: string;
  actorName: string;
  change: string;
}

export function joinFragments(fragments: string[]): string {
  if (fragments.length === 0) return "";
  if (fragments.length === 1) return fragments[0] ?? "";
  return `${fragments.slice(0, -1).join(", ")} and ${fragments[fragments.length - 1]}`;
}

export function changeFragment(event: ReportChangeEvent): string | undefined {
  switch (event.type) {
    case "status-changed":
      return event.to ? `set status to "${event.to}"` : undefined;
    case "assignee-changed":
      return event.to ? `reassigned to ${event.to}` : "unassigned the issue";
    case "story-points-changed":
      return event.to !== undefined && event.to !== null
        ? `updated story points to ${event.to}`
        : undefined;
    case "original-estimate-changed":
      return event.to !== undefined && event.to !== null
        ? `updated original estimate to ${event.to}`
        : undefined;
    case "sprint-added":
      return "added the issue to the sprint";
    case "sprint-removed":
      return "removed the issue from the sprint";
    default:
      return undefined;
  }
}

export function buildActivityLog(events: ReportChangeEvent[]): ActivityLogEntry[] {
  const groups = new Map<string, ReportChangeEvent[]>();
  const created: ActivityLogEntry[] = [];
  for (const event of events) {
    if (event.type === "issue-completed" || event.type === "issue-reopened") continue;
    if (event.type === "issue-created") {
      created.push({
        key: event.id,
        occurredAt: event.occurredAt,
        issueKey: event.issueKey,
        actorName: "—",
        change: "Issue created",
      });
      continue;
    }
    const key = `${event.issueId}|${event.occurredAt}|${event.actor?.id ?? "unknown"}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const grouped: ActivityLogEntry[] = [...groups.values()].flatMap((groupEvents) => {
    const first = groupEvents[0];
    if (!first) return [];
    const fragments = groupEvents
      .map((event) => changeFragment(event))
      .filter((fragment): fragment is string => fragment !== undefined);
    if (fragments.length === 0) return [];
    const actorName = first.actor?.displayName ?? "Someone";
    return [
      {
        key: `${first.issueId}|${first.occurredAt}|${first.actor?.id ?? "unknown"}`,
        occurredAt: first.occurredAt,
        issueKey: first.issueKey,
        actorName,
        change: joinFragments(fragments),
      },
    ];
  });
  return [...created, ...grouped].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  );
}

export interface IssueTreeNode {
  issue: ReportingIssueSnapshot;
  children: IssueTreeNode[];
}

export function buildIssueTree(issues: ReportingIssueSnapshot[]): IssueTreeNode[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const childrenById = new Map<string, ReportingIssueSnapshot[]>();
  const roots: ReportingIssueSnapshot[] = [];
  for (const issue of issues) {
    const parentInScope = issue.parentId && byId.has(issue.parentId);
    if (parentInScope && issue.parentId) {
      childrenById.set(issue.parentId, [
        ...(childrenById.get(issue.parentId) ?? []),
        issue,
      ]);
    } else {
      roots.push(issue);
    }
  }
  const toNode = (issue: ReportingIssueSnapshot): IssueTreeNode => ({
    issue,
    children: (childrenById.get(issue.id) ?? [])
      .sort((left, right) =>
        left.key.localeCompare(right.key, undefined, { numeric: true }),
      )
      .map(toNode),
  });
  return roots
    .sort((left, right) =>
      left.key.localeCompare(right.key, undefined, { numeric: true }),
    )
    .map(toNode);
}

// Keeps a node only if it (or a descendant) actually changed during the period, while
// still surfacing untouched ancestors so the Story → Task → Subtask/Bug shape stays intact.
export function pruneToChanged(
  nodes: IssueTreeNode[],
  changedIds: Set<string>,
): IssueTreeNode[] {
  return nodes.flatMap((node) => {
    const children = pruneToChanged(node.children, changedIds);
    if (!changedIds.has(node.issue.id) && children.length === 0) return [];
    return [{ issue: node.issue, children }];
  });
}

export function issueTypeAccentClass(typeName: string): string {
  const normalized = typeName.trim().toLowerCase();
  if (normalized.includes("story")) return "report-issue-tree-type-story";
  if (normalized.includes("sub-task") || normalized.includes("subtask"))
    return "report-issue-tree-type-subtask";
  if (normalized.includes("bug")) return "report-issue-tree-type-bug";
  if (normalized.includes("task")) return "report-issue-tree-type-task";
  return "report-issue-tree-type-other";
}
