import {
  buildWorkActivityReport,
  descriptionCandidateJql,
  type DescriptionReportPeriod,
  type NormalizedReportUser,
  type ReportChangeEvent,
  type ReportingIssueSnapshot,
  type WorkActivityReport,
} from "@power-view/domain";
import type { JiraClient } from "./JiraClient";
import type { JiraTransport } from "./JiraTransport";
import { z } from "zod";
import { MAX_CLIENT_CONCURRENCY, mapWithConcurrency } from "./concurrency";
import {
  rawJiraIssueChangelogPageSchema,
  type RawJiraChangelogEntry,
} from "./reporting-schemas";

// `toString` is also inherited from Object.prototype. Jira legitimately omits that
// property when an assignee is cleared; make omission explicit before schema parsing.
const workHistoryPageSchema = z.preprocess((value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.values)) return value;
  return {
    ...page,
    values: page.values.map((raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const entry = raw as Record<string, unknown>;
      if (!Array.isArray(entry.items)) return raw;
      return {
        ...entry,
        items: entry.items.map((rawItem: unknown) => {
          if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem))
            return rawItem;
          const item = rawItem as Record<string, unknown>;
          return {
            ...item,
            toString: Object.prototype.hasOwnProperty.call(item, "toString")
              ? Reflect.get(item, "toString")
              : undefined,
          };
        }),
      };
    }),
  };
}, rawJiraIssueChangelogPageSchema);

export type WorkActivityReportClient = Pick<
  JiraClient,
  "getBoard" | "getBoardIssues" | "getReportIssue" | "getCurrentUser" | "getSprint"
>;

export interface WorkActivitySource {
  jiraBaseUrl: string;
  boardId: string;
  boardName: string;
  period: DescriptionReportPeriod;
  generatedAt: string;
  issues: ReportingIssueSnapshot[];
  events: ReportChangeEvent[];
}

export interface CollectWorkActivityInput {
  client: WorkActivityReportClient;
  transport: JiraTransport;
  jiraBaseUrl: string;
  boardId: string;
  period: DescriptionReportPeriod;
  now?: Date;
  expectedUserId?: string;
  sprintFieldId?: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

function actor(value: unknown): NormalizedReportUser | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const user = value as Record<string, unknown>;
  const rawId = user.accountId ?? user.key ?? user.name;
  if (typeof rawId !== "string" || !rawId.trim()) return undefined;
  return {
    id: rawId,
    displayName:
      typeof user.displayName === "string" && user.displayName.trim()
        ? user.displayName
        : rawId,
  };
}

/** Sprint IDs come from Jira's raw identifier sets, never digits in display names. */
function sprintSet(raw: unknown, display: string | null | undefined): Set<string> {
  if (raw === undefined || raw === null || raw === "") {
    if (display?.trim())
      throw new Error("Jira sprint history did not include membership identifiers.");
    return new Set();
  }
  let values: unknown[];
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === "number") values = [raw];
  else if (typeof raw === "string" && /^\s*\d+(?:\s*,\s*\d+)*\s*$/.test(raw))
    values = raw.split(",");
  else throw new Error("Jira returned invalid sprint membership history.");
  return new Set(
    values.map((value) => {
      const id = typeof value === "number" ? String(value) : String(value).trim();
      if (!/^\d+$/.test(id))
        throw new Error("Jira returned invalid sprint membership history.");
      return id;
    }),
  );
}

function normalizeEntry(
  entry: RawJiraChangelogEntry,
  issue: { id: string; key: string },
  sprintFieldId?: string,
): ReportChangeEvent[] {
  const author = actor(entry.author);
  const result: ReportChangeEvent[] = [];
  for (const [index, item] of entry.items.entries()) {
    const field = item.field?.trim().toLowerCase();
    const fieldId = item.fieldId;
    const base = {
      id: `${issue.id}:${entry.id}:${index}`,
      issueId: issue.id,
      issueKey: issue.key,
      occurredAt: entry.created,
      ...(author ? { actor: author } : {}),
      ...(fieldId ? { fieldId } : {}),
    };
    if (fieldId === "description" || field === "description") {
      // Description bodies can contain confidential text; discard them at this boundary.
      result.push({ ...base, type: "description-changed" });
    } else if (fieldId === "status" || field === "status") {
      if (!item.toString?.trim())
        throw new Error("Jira returned a status change without its destination.");
      result.push({
        ...base,
        type: "status-changed",
        from: item.fromString ?? null,
        to: item.toString,
      });
    } else if (fieldId === "assignee" || field === "assignee") {
      result.push({
        ...base,
        type: "assignee-changed",
        from: item.fromString ?? null,
        to: item.toString ?? null,
      });
    } else if (field === "sprint" || (sprintFieldId && fieldId === sprintFieldId)) {
      const before = sprintSet(item.from, item.fromString);
      const after = sprintSet(item.to, item.toString);
      for (const sprintId of before)
        if (!after.has(sprintId))
          result.push({
            ...base,
            id: `${base.id}:removed:${sprintId}`,
            type: "sprint-removed",
            sprintId,
          });
      for (const sprintId of after)
        if (!before.has(sprintId))
          result.push({
            ...base,
            id: `${base.id}:added:${sprintId}`,
            type: "sprint-added",
            sprintId,
          });
    }
  }
  return result;
}

async function completeHistory(
  input: CollectWorkActivityInput,
  issue: ReportingIssueSnapshot,
): Promise<ReportChangeEvent[]> {
  const events: ReportChangeEvent[] = [];
  const historyIds = new Set<string>();
  let offset = 0;
  let expectedTotal: number | undefined;
  for (let pages = 0; pages < 1000; pages++) {
    input.signal?.throwIfAborted();
    const page = await input.transport.request(
      {
        baseUrl: input.jiraBaseUrl,
        method: "GET",
        path: `/rest/api/3/issue/${encodeURIComponent(issue.key)}/changelog`,
        query: { startAt: offset, maxResults: 100 },
        headers: { Accept: "application/json" },
      },
      workHistoryPageSchema,
      input.signal,
    );
    const loaded = offset + page.values.length;
    if (
      page.startAt !== offset ||
      page.total === undefined ||
      (expectedTotal !== undefined && page.total !== expectedTotal) ||
      loaded > page.total ||
      (!page.values.length && loaded < page.total) ||
      (page.isLast === true && loaded < page.total) ||
      (page.isLast === false && loaded === page.total)
    )
      throw new Error(
        "Jira returned incomplete or changing issue history. Retry the report.",
      );
    expectedTotal = page.total;
    for (const entry of page.values) {
      const id = String(entry.id);
      const instant = Date.parse(entry.created);
      if (historyIds.has(id) || !Number.isFinite(instant))
        throw new Error("Jira returned repeated or invalid issue history.");
      historyIds.add(id);
      if (
        instant >= Date.parse(input.period.start) &&
        instant < Date.parse(input.period.end)
      )
        events.push(...normalizeEntry(entry, issue, input.sprintFieldId));
    }
    if (loaded === page.total) return events;
    offset = loaded;
  }
  throw new Error("Jira history exceeded the complete-read limit.");
}

/** A single verified read supplies both the activity report and the description report. */
export async function collectWorkActivitySource(
  input: CollectWorkActivityInput,
): Promise<WorkActivitySource> {
  const { client, signal, period } = input;
  const now = input.now ?? new Date();
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    period.timeZone !== "Europe/Kyiv" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(period.date)
  )
    throw new Error("Use a valid fixed Kyiv report period.");
  if (end > now.getTime()) throw new Error("This report period has not ended yet.");
  if (!/^\d+$/.test(input.boardId)) throw new Error("Select a Jira board.");
  const origin = new URL(input.jiraBaseUrl);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    !["", "/"].includes(origin.pathname)
  )
    throw new Error("Use the selected HTTPS Jira site without credentials or paths.");
  signal?.throwIfAborted();
  const user = await client.getCurrentUser(signal);
  if (input.expectedUserId && user.accountId !== input.expectedUserId)
    throw new Error("The Jira account changed. Report generation was stopped.");
  const board = await client.getBoard(input.boardId, signal);
  if (board.id !== input.boardId) throw new Error("Jira returned an unexpected board.");
  const issues = new Map<string, ReportingIssueSnapshot>();
  const byKey = new Map<string, ReportingIssueSnapshot>();
  let expectedTotal: number | undefined;
  let cursor: string | number | undefined;
  const cursors = new Set<string>();
  for (;;) {
    signal?.throwIfAborted();
    input.onProgress?.("Reading updated issues…");
    const page = await client.getBoardIssues(
      {
        boardId: input.boardId,
        jql: descriptionCandidateJql(period),
        fieldsOverride: [
          "summary",
          "parent",
          "issuetype",
          "updated",
          "status",
          "assignee",
        ],
        pageSize: 100,
        ...(cursor === undefined ? {} : { cursor }),
      },
      signal,
    );
    if (page.truncated || page.total > 5000)
      throw new Error("The board exceeds the report's 5,000-issue read limit.");
    if (
      page.startAt !== (cursor ?? 0) ||
      (expectedTotal !== undefined && page.total !== expectedTotal)
    )
      throw new Error(
        "Jira returned a changing or unexpected issue page. Retry the report.",
      );
    expectedTotal = page.total;
    for (const issue of page.values) {
      if (issues.has(issue.id) || byKey.has(issue.key))
        throw new Error("Jira returned a repeated issue page. Retry the report.");
      if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issue.key) || !issue.status.id)
        throw new Error("Jira returned an issue without its current status.");
      issues.set(issue.id, issue);
      byKey.set(issue.key, issue);
    }
    if (issues.size > 5000 || issues.size > page.total)
      throw new Error("The report issue limit or returned total was exceeded.");
    if (page.isLast) {
      if (issues.size !== page.total)
        throw new Error("Jira returned an incomplete issue list. Retry the report.");
      break;
    }
    if (
      !page.values.length ||
      page.nextCursor === undefined ||
      cursors.has(String(page.nextCursor))
    )
      throw new Error("Jira issue pagination did not complete. Retry the report.");
    cursor = page.nextCursor;
    cursors.add(String(cursor));
  }
  const candidateIssues = [...issues.values()];
  let completed = 0;
  const events = (
    await mapWithConcurrency(
      candidateIssues,
      MAX_CLIENT_CONCURRENCY,
      async (issue) => {
        const result = await completeHistory(input, issue);
        input.onProgress?.(
          `Reading issue history: ${++completed}/${candidateIssues.length}`,
        );
        return result;
      },
      signal,
    )
  ).flat();
  const sprintIds = [...new Set(events.flatMap((event) => event.sprintId ?? []))];
  const sprintNames = new Map<string, string>();
  await mapWithConcurrency(
    sprintIds,
    MAX_CLIENT_CONCURRENCY,
    async (sprintId) => {
      const sprint = await client.getSprint(sprintId, signal);
      if (sprint.id !== sprintId || !sprint.name.trim())
        throw new Error("Jira returned an unexpected sprint.");
      sprintNames.set(sprintId, sprint.name);
    },
    signal,
  );
  for (const event of events) {
    if (event.type === "sprint-added") event.to = sprintNames.get(event.sprintId!)!;
    if (event.type === "sprint-removed") event.from = sprintNames.get(event.sprintId!)!;
  }
  const pending = [...new Set(events.map((event) => event.issueId))].map((id) => {
    const issue = issues.get(id);
    if (!issue) throw new Error("A changed issue is missing from the report.");
    return issue;
  });
  const checked = new Set<string>();
  while (pending.length) {
    signal?.throwIfAborted();
    const issue = pending.shift()!;
    if (checked.has(issue.id)) continue;
    checked.add(issue.id);
    if (checked.size > 5500) throw new Error("The report hierarchy limit was exceeded.");
    const reference = issue.parentKey ?? issue.parentId;
    if (!reference) continue;
    let parent =
      (issue.parentId ? issues.get(issue.parentId) : undefined) ??
      (issue.parentKey ? byKey.get(issue.parentKey) : undefined);
    if (!parent) {
      input.onProgress?.("Reading parent tasks…");
      parent = await client.getReportIssue(reference, signal);
      issues.set(parent.id, parent);
      byKey.set(parent.key, parent);
    }
    if (
      (issue.parentId && parent.id !== issue.parentId) ||
      (issue.parentKey && parent.key !== issue.parentKey)
    )
      throw new Error("Jira returned an unexpected parent task.");
    pending.push(parent);
  }
  for (const id of new Set(events.map((event) => event.issueId))) {
    let issue = issues.get(id);
    const path = new Set<string>();
    while (issue) {
      if (path.has(issue.id) || path.size >= 50)
        throw new Error("Jira returned cyclic or excessively deep report ancestry.");
      path.add(issue.id);
      const reference = issue.parentKey ?? issue.parentId;
      if (!reference) break;
      issue =
        (issue.parentId ? issues.get(issue.parentId) : undefined) ??
        (issue.parentKey ? byKey.get(issue.parentKey) : undefined);
      if (!issue) throw new Error("A report ancestor is missing.");
    }
  }
  signal?.throwIfAborted();
  const current = await client.getCurrentUser(signal);
  if (current.accountId !== user.accountId)
    throw new Error("The Jira account changed. Report generation was stopped.");
  signal?.throwIfAborted();
  return {
    jiraBaseUrl: input.jiraBaseUrl,
    boardId: board.id,
    boardName: board.name,
    period: { ...period },
    generatedAt: now.toISOString(),
    issues: [...issues.values()],
    events,
  };
}

export async function collectWorkActivityReport(
  input: CollectWorkActivityInput,
): Promise<WorkActivityReport> {
  return buildWorkActivityReport(await collectWorkActivitySource(input));
}
