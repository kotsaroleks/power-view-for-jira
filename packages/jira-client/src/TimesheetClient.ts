import { isValidJiraTimestamp } from "@power-view/domain";
import { z } from "zod";
import type { JiraTransport } from "./JiraTransport";
import { JiraClientError } from "./errors";

export interface TimesheetIssue {
  id: string;
  key: string;
  summary: string;
  projectId: string;
  projectKey: string;
}
export interface WorklogPickerIssue extends TimesheetIssue {
  typeName: string;
  hierarchyLevel: number;
  subtask: boolean;
  assigneeId: string | null;
  parentKey: string | null;
}
export interface WorklogBoard {
  id: number;
  name: string;
}
export interface TimesheetUser {
  accountId: string;
  displayName: string;
  timeZone?: string | undefined;
}
export interface TimesheetWorklog {
  id: string;
  issueId: string;
  issueKey: string;
  authorId: string;
  started: string;
  timeSpentSeconds: number;
  updated: string;
  commentText: string;
  comment?: unknown;
}
export interface WorklogInput {
  started: string;
  timeSpentSeconds: number;
  comment?: unknown;
}
export interface TimesheetApi {
  getWorklogBoards(signal?: AbortSignal): Promise<WorklogBoard[]>;
  getBoardPickerIssues(
    boardId: number,
    signal?: AbortSignal,
  ): Promise<WorklogPickerIssue[]>;
  searchProjects(
    query: string,
    signal?: AbortSignal,
  ): Promise<Array<{ id: string; key: string; name: string }>>;
  getUser(signal?: AbortSignal): Promise<TimesheetUser>;
  search(
    jql: string,
    token?: string,
    signal?: AbortSignal,
  ): Promise<{ issues: TimesheetIssue[]; nextPageToken?: string; isLast: boolean }>;
  getIssue(key: string, signal?: AbortSignal): Promise<TimesheetIssue>;
  getWorklogs(issue: TimesheetIssue, signal?: AbortSignal): Promise<TimesheetWorklog[]>;
  getWorklog(
    issue: TimesheetIssue,
    id: string,
    signal?: AbortSignal,
  ): Promise<TimesheetWorklog>;
  saveWorklog(
    issue: TimesheetIssue,
    input: WorklogInput,
    expectedUser: string,
    original?: TimesheetWorklog,
  ): Promise<TimesheetWorklog>;
  deleteWorklog(
    issue: TimesheetIssue,
    original: TimesheetWorklog,
    expectedUser: string,
  ): Promise<void>;
}
const issueKey = z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/);
const id = z.string().regex(/^\d{1,32}$/);
const date = z.string().refine(isValidJiraTimestamp, "Invalid Jira timestamp");
// Worklog writes use Jira's documented numeric timezone format. Keep the local
// clock and offset intact so editing an existing record does not move its time.
function worklogStarted(value: string): string {
  return value
    .replace(/(T\d{2}:\d{2}:\d{2})(?=Z|[+-])/, "$1.000")
    .replace(/Z$/, "+0000")
    .replace(/([+-]\d{2}):(\d{2})$/, "$1$2");
}
const userSchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string(),
  timeZone: z.string().optional(),
});
const issueSchema = z.object({
  id,
  key: issueKey,
  fields: z.object({ summary: z.string(), project: z.object({ id, key: z.string() }) }),
});
const searchSchema = z
  .object({
    issues: z.array(issueSchema),
    isLast: z.boolean().optional(),
    nextPageToken: z.string().min(1).optional(),
  })
  .refine(
    (page) => page.isLast !== false || Boolean(page.nextPageToken),
    "Missing search continuation token",
  );
const logSchema = z.object({
  id,
  issueId: id.optional(),
  author: z.object({ accountId: z.string().min(1) }),
  started: date,
  timeSpentSeconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  updated: date,
  comment: z.unknown().optional(),
});
const pageSchema = z.object({
  worklogs: z.array(logSchema),
  startAt: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
function mapIssue(raw: z.infer<typeof issueSchema>): TimesheetIssue {
  return {
    id: raw.id,
    key: raw.key,
    summary: raw.fields.summary,
    projectId: raw.fields.project.id,
    projectKey: raw.fields.project.key,
  };
}
export function commentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as { type?: unknown; text?: unknown; content?: unknown };
  if (typeof node.text === "string") return node.text;
  if (node.type === "hardBreak") return "\n";
  if (!Array.isArray(node.content)) return "";
  const items: unknown[] = node.content;
  return items.map(commentText).join(node.type === "doc" ? "\n" : "");
}
export function plainTextComment(text: string): unknown {
  return {
    type: "doc",
    version: 1,
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}
function mapLog(raw: z.infer<typeof logSchema>, issue: TimesheetIssue): TimesheetWorklog {
  if (raw.issueId && raw.issueId !== issue.id)
    throw new Error("Jira returned a worklog for a different issue.");
  return {
    id: raw.id,
    issueId: issue.id,
    issueKey: issue.key,
    authorId: raw.author.accountId,
    started: raw.started,
    timeSpentSeconds: raw.timeSpentSeconds,
    updated: raw.updated,
    commentText: commentText(raw.comment),
    ...(raw.comment === undefined ? {} : { comment: raw.comment }),
  };
}
export class WorklogConflictError extends Error {}
export class WorklogIdentityError extends Error {}
export class UnknownWorklogOutcomeError extends Error {
  constructor() {
    super(
      "The operation result is unknown. Check Jira before trying again; the request was not repeated.",
    );
  }
}
export function worklogVersion(value: TimesheetWorklog): string {
  return JSON.stringify([
    value.id,
    value.issueId,
    value.authorId,
    value.updated,
    value.started,
    value.timeSpentSeconds,
    value.comment,
  ]);
}

/** Cloud-only worklog boundary. Search responses never share report snapshots or issue caches. */
export class CloudTimesheetClient implements TimesheetApi {
  constructor(
    private readonly transport: JiraTransport,
    private readonly baseUrl: string,
  ) {}
  async getWorklogBoards(signal?: AbortSignal): Promise<WorklogBoard[]> {
    const boards = new Map<number, WorklogBoard>();
    let startAt = 0;
    while (true) {
      signal?.throwIfAborted();
      const page = await this.transport.request(
        {
          baseUrl: this.baseUrl,
          method: "GET",
          path: "/rest/agile/1.0/board",
          query: { startAt, maxResults: 100 },
        },
        z.object({
          values: z.array(
            z.object({ id: z.number().int().positive(), name: z.string() }),
          ),
          isLast: z.boolean(),
          startAt: z.number().int().nonnegative(),
        }),
        signal,
      );
      if (page.startAt !== startAt) throw new Error("Unexpected board page.");
      for (const board of page.values) boards.set(board.id, board);
      if (page.isLast) return [...boards.values()];
      if (!page.values.length) throw new Error("Incomplete board list.");
      startAt += page.values.length;
    }
  }
  async getBoardPickerIssues(
    boardId: number,
    signal?: AbortSignal,
  ): Promise<WorklogPickerIssue[]> {
    z.number().int().positive().parse(boardId);
    // Board issue endpoints omit Scrum epics. The saved filter is the picker scope.
    const config = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/agile/1.0/board/${boardId}/configuration`,
      },
      z.object({ filter: z.object({ id: z.union([id, z.number().int().positive()]) }) }),
      signal,
    );
    const pickerSchema = issueSchema.extend({
      fields: issueSchema.shape.fields.extend({
        issuetype: z.object({
          name: z.string(),
          subtask: z.boolean(),
          hierarchyLevel: z.number().int().optional(),
        }),
        assignee: z.object({ accountId: z.string() }).nullable(),
        parent: z.object({ key: issueKey }).optional().nullable(),
      }),
    });
    const issues = new Map<string, WorklogPickerIssue>();
    const tokens = new Set<string>();
    let token: string | undefined;
    while (true) {
      signal?.throwIfAborted();
      const page = await this.transport.request(
        {
          baseUrl: this.baseUrl,
          method: "POST",
          path: "/rest/api/3/search/jql",
          body: {
            jql: `filter = ${config.filter.id} ORDER BY key ASC`,
            fields: ["summary", "project", "issuetype", "assignee", "parent"],
            maxResults: 100,
            ...(token ? { nextPageToken: token } : {}),
          },
        },
        z.object({
          issues: z.array(pickerSchema),
          isLast: z.boolean().optional(),
          nextPageToken: z.string().min(1).optional(),
        }),
        signal,
      );
      for (const raw of page.issues) {
        if (issues.has(raw.id))
          throw new Error("Duplicate issue in board picker. Refresh the list.");
        issues.set(raw.id, {
          ...mapIssue(raw),
          typeName: raw.fields.issuetype.name,
          hierarchyLevel:
            raw.fields.issuetype.hierarchyLevel ??
            (raw.fields.issuetype.subtask
              ? -1
              : raw.fields.issuetype.name.toLowerCase() === "epic"
                ? 1
                : 0),
          subtask: raw.fields.issuetype.subtask,
          assigneeId: raw.fields.assignee?.accountId ?? null,
          parentKey: raw.fields.parent?.key ?? null,
        });
      }
      if (page.isLast === true || (page.isLast === undefined && !page.nextPageToken))
        return [...issues.values()];
      if (!page.issues.length || !page.nextPageToken || tokens.has(page.nextPageToken))
        throw new Error("Incomplete board issue list.");
      tokens.add(page.nextPageToken);
      token = page.nextPageToken;
    }
  }
  async searchProjects(query: string, signal?: AbortSignal) {
    const page = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: "/rest/api/3/project/search",
        query: { query, maxResults: 50, startAt: 0 },
      },
      z.object({ values: z.array(z.object({ id, key: z.string(), name: z.string() })) }),
      signal,
    );
    return page.values;
  }
  getUser(signal?: AbortSignal) {
    return this.transport.request(
      { baseUrl: this.baseUrl, method: "GET", path: "/rest/api/3/myself" },
      userSchema,
      signal,
    );
  }
  async search(jql: string, token?: string, signal?: AbortSignal) {
    const result = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "POST",
        path: "/rest/api/3/search/jql",
        body: {
          jql,
          fields: ["summary", "project"],
          maxResults: 100,
          ...(token ? { nextPageToken: token } : {}),
        },
      },
      searchSchema,
      signal,
    );
    return {
      issues: result.issues.map(mapIssue),
      isLast: result.isLast ?? !result.nextPageToken,
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
    };
  }
  async getIssue(key: string, signal?: AbortSignal) {
    issueKey.parse(key);
    return mapIssue(
      await this.transport.request(
        {
          baseUrl: this.baseUrl,
          method: "GET",
          path: `/rest/api/3/issue/${key}`,
          query: { fields: "summary,project" },
        },
        issueSchema,
        signal,
      ),
    );
  }
  async getWorklogs(issue: TimesheetIssue, signal?: AbortSignal) {
    issueKey.parse(issue.key);
    const logs = new Map<string, TimesheetWorklog>();
    let startAt = 0;
    while (true) {
      signal?.throwIfAborted();
      const page = await this.transport.request(
        {
          baseUrl: this.baseUrl,
          method: "GET",
          path: `/rest/api/3/issue/${issue.key}/worklog`,
          query: { startAt, maxResults: 100 },
        },
        pageSchema,
        signal,
      );
      if (page.startAt !== startAt || (!page.worklogs.length && startAt < page.total))
        throw new Error("Jira worklog pagination was incomplete.");
      page.worklogs.forEach((raw) => {
        const log = mapLog(raw, issue);
        logs.set(log.id, log);
      });
      startAt += page.worklogs.length;
      if (startAt >= page.total) {
        if (logs.size < page.total)
          throw new Error("Jira repeated worklogs across pages; refresh to retry.");
        return [...logs.values()];
      }
    }
  }
  async getWorklog(issue: TimesheetIssue, worklogId: string, signal?: AbortSignal) {
    issueKey.parse(issue.key);
    id.parse(worklogId);
    const raw = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/api/3/issue/${issue.key}/worklog/${worklogId}`,
      },
      logSchema,
      signal,
    );
    if (raw.id !== worklogId) throw new Error("Jira returned a different worklog.");
    return mapLog(raw, issue);
  }
  private async checkIdentity(expected: string) {
    if ((await this.getUser()).accountId !== expected)
      throw new WorklogIdentityError(
        "The Jira account changed. Reconnect before writing time.",
      );
  }
  private async checkVersion(
    issue: TimesheetIssue,
    original: TimesheetWorklog,
    expected: string,
  ) {
    const current = await this.getWorklog(issue, original.id);
    if (current.authorId !== expected || original.authorId !== expected)
      throw new WorklogIdentityError("Only your own worklogs can be changed.");
    if (worklogVersion(current) !== worklogVersion(original))
      throw new WorklogConflictError(
        "This worklog changed in Jira. Close the form, refresh, and reopen the latest record.",
      );
  }
  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof JiraClientError &&
        error.appError.code === "PERMISSION_DENIED" &&
        !error.appError.httpStatus
      )
        throw error;
      if (
        error instanceof JiraClientError &&
        error.appError.httpStatus &&
        [400, 401, 403, 404, 409, 422, 429].includes(error.appError.httpStatus)
      )
        throw error;
      throw new UnknownWorklogOutcomeError();
    }
  }
  async saveWorklog(
    issue: TimesheetIssue,
    input: WorklogInput,
    expectedUser: string,
    original?: TimesheetWorklog,
  ) {
    issueKey.parse(issue.key);
    date.parse(input.started);
    z.number().int().positive().max(2_147_483_647).parse(input.timeSpentSeconds);
    await this.checkIdentity(expectedUser);
    if (original) await this.checkVersion(issue, original, expectedUser);
    return this.mutate(async () => {
      const raw = await this.transport.request(
        {
          baseUrl: this.baseUrl,
          method: original ? "PUT" : "POST",
          path: `/rest/api/3/issue/${issue.key}/worklog${original ? `/${original.id}` : ""}`,
          query: { adjustEstimate: "leave" },
          body: {
            started: worklogStarted(input.started),
            timeSpentSeconds: input.timeSpentSeconds,
            ...(input.comment === undefined ? {} : { comment: input.comment }),
          },
        },
        logSchema,
      );
      if (raw.author.accountId !== expectedUser || (original && raw.id !== original.id))
        throw new Error("Unexpected Jira write response.");
      return mapLog(raw, issue);
    });
  }
  async deleteWorklog(
    issue: TimesheetIssue,
    original: TimesheetWorklog,
    expectedUser: string,
  ) {
    await this.checkIdentity(expectedUser);
    await this.checkVersion(issue, original, expectedUser);
    await this.mutate(() =>
      this.transport.request(
        {
          baseUrl: this.baseUrl,
          method: "DELETE",
          path: `/rest/api/3/issue/${issue.key}/worklog/${original.id}`,
          query: { adjustEstimate: "leave" },
        },
        z.null(),
      ),
    );
  }
}
