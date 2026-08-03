import type {
  JiraBoard,
  JiraSprint,
  NormalizedReportUser,
  ReportChangeEvent,
  ReportingIssueSnapshot,
  ReportWorklog,
} from "@power-view/domain";

import type { RawJiraBoard, RawJiraBoardConfiguration, RawJiraChangelogEntry, RawJiraSprint, RawJiraWorklog } from "./reporting-schemas";

function id(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function user(value: unknown): NormalizedReportUser | undefined {
  const object = record(value);
  if (!object) return undefined;
  const userId = id(object.accountId) ?? id(object.key) ?? id(object.name) ?? id(object.displayName);
  const displayName = typeof object.displayName === "string" ? object.displayName : userId;
  if (!userId || !displayName) return undefined;
  return {
    id: userId,
    displayName,
    ...(typeof object.avatarUrl === "string" ? { avatarUrl: object.avatarUrl } : {}),
  };
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const object = record(item);
    return object && id(object.id) ? [id(object.id)!] : id(item) ? [id(item)!] : [];
  });
}

export function mapJiraBoard(raw: RawJiraBoard): JiraBoard {
  const projectKey = raw.location && typeof raw.location.projectKey === "string" ? raw.location.projectKey : undefined;
  return {
    id: id(raw.id)!,
    name: raw.name,
    type: raw.type === "scrum" || raw.type === "kanban" || raw.type === "simple" ? raw.type : "unknown",
    projectKeys: projectKey ? [projectKey] : [],
  };
}

export function mapBoardConfiguration(raw: RawJiraBoardConfiguration): {
  id: string;
  name: string;
  filterId?: string;
  statusIds: string[];
  storyPointsFieldId?: string;
} {
  const columns = raw.columnConfig?.columns ?? [];
  const statusIds = columns.flatMap((column) => column.statuses?.flatMap((status) => (id(status.id) ? [id(status.id)!] : [])) ?? []);
  const filterId = raw.filter?.id === undefined ? undefined : id(raw.filter.id);
  const storyPointsFieldId = raw.estimation?.field?.fieldId;
  return {
    id: id(raw.id) ?? "unknown",
    name: raw.name ?? "Jira Board",
    ...(filterId ? { filterId } : {}),
    statusIds,
    ...(storyPointsFieldId ? { storyPointsFieldId } : {}),
  };
}

export function mapJiraSprint(raw: RawJiraSprint): JiraSprint {
  const state = raw.state === "future" || raw.state === "active" || raw.state === "closed" ? raw.state : "unknown";
  const originBoardId = raw.originBoardId === undefined ? undefined : id(raw.originBoardId);
  return {
    id: id(raw.id)!,
    name: raw.name,
    state,
    ...(originBoardId ? { originBoardId } : {}),
    ...(raw.goal ? { goal: raw.goal } : {}),
    ...(raw.startDate ? { startDate: raw.startDate } : {}),
    ...(raw.endDate ? { endDate: raw.endDate } : {}),
    ...(raw.completeDate ? { completeDate: raw.completeDate } : {}),
  };
}

export function mapReportingIssue(raw: Record<string, unknown>, baseUrl: string, storyPointsFieldId?: string): ReportingIssueSnapshot {
  const fields = record(raw.fields) ?? {};
  const status = record(fields.status) ?? {};
  const issueType = record(fields.issuetype) ?? {};
  const assignee = user(fields.assignee);
  const project = record(fields.project);
  const timetracking = record(fields.timetracking);
  const statusIdValue = id(status.id);
  const originalEstimateSeconds = numeric(timetracking?.originalEstimateSeconds);
  const timeSpentSeconds = numeric(timetracking?.timeSpentSeconds);
  const storyPoints = storyPointsFieldId ? numeric(fields[storyPointsFieldId]) : undefined;
  const sprintIds = stringArray(fields.sprint);
  const key = typeof raw.key === "string" ? raw.key : String(raw.id);
  return {
    id: id(raw.id)!,
    key,
    browseUrl: `${baseUrl.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`,
    summary: typeof fields.summary === "string" ? fields.summary : key,
    issueType: {
      id: id(issueType.id) ?? "unknown",
      name: typeof issueType.name === "string" ? issueType.name : "Unknown",
    },
    status: {
      ...(statusIdValue ? { id: statusIdValue } : {}),
      name: typeof status.name === "string" ? status.name : "Unknown",
    },
    ...(assignee ? { assignee } : {}),
    ...(typeof fields.created === "string" ? { createdAt: fields.created } : {}),
    ...(typeof fields.resolutiondate === "string" ? { resolvedAt: fields.resolutiondate } : {}),
    ...(typeof fields.updated === "string" ? { updatedAt: fields.updated } : {}),
    ...(storyPoints === undefined ? {} : { storyPoints }),
    ...(originalEstimateSeconds === undefined ? {} : { originalEstimateSeconds }),
    ...(timeSpentSeconds === undefined ? {} : { timeSpentSeconds }),
    sprintIds,
    ...(project ? {} : {}),
  };
}

function statusId(value: unknown): string | undefined {
  return id(value);
}

function sprintIds(value: unknown): string[] {
  const raw = typeof value === "string" ? value : "";
  const matches = raw.match(/(?:^|[^\d])(\d+)(?:$|[^\d])/g) ?? [];
  return matches.map((match) => match.replace(/\D/g, "")).filter(Boolean);
}

function classifyChange(field: string | undefined, fieldId: string | undefined, storyPointsFieldId?: string): ReportChangeEvent["type"] | undefined {
  const normalized = (field ?? "").trim().toLowerCase();
  if (normalized === "status") return "status-changed";
  if (normalized === "assignee") return "assignee-changed";
  if (fieldId === storyPointsFieldId || normalized.includes("story point")) return "story-points-changed";
  if (normalized === "original estimate" || normalized === "timeoriginalestimate") return "original-estimate-changed";
  if (normalized === "sprint") return "sprint-added";
  return undefined;
}

export function mapChangelogEntry(
  entry: RawJiraChangelogEntry,
  issue: { id: string; key: string },
  options: { storyPointsFieldId?: string; sprintId?: string; completedStatusIds?: string[]; completedStatusNames?: string[] },
): ReportChangeEvent[] {
  const actor = user(entry.author);
  const result: ReportChangeEvent[] = [];
  for (const [index, item] of entry.items.entries()) {
    const fieldId = item.fieldId;
    const field = item.field;
    const type = classifyChange(field, fieldId, options.storyPointsFieldId);
    if (!type) continue;
    const base = {
      id: `${issue.id}:${entry.id}:${index}`,
      issueId: issue.id,
      issueKey: issue.key,
      occurredAt: entry.created,
      ...(actor ? { actor } : {}),
      ...(fieldId ? { fieldId } : {}),
      ...(item.fromString !== undefined ? { from: item.fromString } : {}),
      ...(item.toString !== undefined ? { to: item.toString } : {}),
    } satisfies Omit<ReportChangeEvent, "type">;
    if (type !== "sprint-added") {
      result.push({ ...base, type });
      if (type === "status-changed") {
        const fromId = statusId(item.from);
        const toId = statusId(item.to);
        const fromName = item.fromString ?? "";
        const toName = item.toString ?? "";
        const isCompleted = (candidateId: string | undefined, candidateName: string) =>
          (candidateId && options.completedStatusIds?.includes(candidateId)) || options.completedStatusNames?.includes(candidateName);
        if (!isCompleted(fromId, fromName) && isCompleted(toId, toName)) result.push({ ...base, id: `${base.id}:completed`, type: "issue-completed" });
        if (isCompleted(fromId, fromName) && !isCompleted(toId, toName)) result.push({ ...base, id: `${base.id}:reopened`, type: "issue-reopened" });
      }
      continue;
    }
    const before = sprintIds(item.fromString);
    const after = sprintIds(item.toString);
    const target = options.sprintId;
    if (!target) continue;
    if (!before.includes(target) && after.includes(target)) result.push({ ...base, type: "sprint-added", sprintId: target });
    if (before.includes(target) && !after.includes(target)) result.push({ ...base, id: `${base.id}:removed`, type: "sprint-removed", sprintId: target });
  }
  return result;
}

export function mapWorklog(raw: RawJiraWorklog, issueKey: string): ReportWorklog | undefined {
  const author = user(raw.author);
  const worklogId = id(raw.id);
  const issueId = id(raw.issueId);
  if (!author || !worklogId || !issueId) return undefined;
  return {
    id: worklogId,
    issueId,
    issueKey,
    author,
    startedAt: raw.started,
    timeSpentSeconds: raw.timeSpentSeconds,
    ...(raw.created ? { createdAt: raw.created } : {}),
    ...(raw.updated ? { updatedAt: raw.updated } : {}),
  };
}
