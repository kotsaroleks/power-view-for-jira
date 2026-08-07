import type {
  FieldMapping,
  IssueSearchResult,
  JiraDeploymentType,
  JiraField,
  JiraProject,
  JiraServerInfo,
  JiraUser,
  NormalizedIssue,
  ReportWorklog,
  PageProgress,
  PaginatedResult,
  ProjectSearchOptions,
  SearchIssuesRequest,
} from "@power-view/domain";
import {
  DEFAULT_MAX_ISSUES,
  MAX_CONFIGURABLE_ISSUES,
  validateJqlInput,
} from "@power-view/domain";

import type {
  CreateIssueLinkRequest,
  JiraClient,
  JiraIssueEditMetadata,
  JiraIssueLinkType,
  JiraStatus,
  UpdateIssueDatesRequest,
} from "./JiraClient";
import type { JiraTransport } from "./JiraTransport";
import type {
  GetBoardIssuesRequest,
  GetBoardsRequest,
  GetBoardSprintsRequest,
  GetIssueChangelogsRequest,
  GetIssueWorklogsRequest,
  GetSprintIssuesRequest,
  JiraBoardConfiguration,
  JiraBoardPage,
  JiraSprintPage,
  ReportingIssuePage,
} from "./reporting-api";
import { MAX_CLIENT_CONCURRENCY, mapWithConcurrency } from "./concurrency";
import { JiraClientError } from "./errors";
import { mapJiraField, mapJiraIssue, mapJiraServerInfo, mapJiraUser } from "./mappers";
import {
  type RawJiraIssue,
  rawJiraFieldsSchema,
  rawJiraIssueEditMetadataSchema,
  rawJiraIssueLinkTypesSchema,
  rawJiraServerInfoSchema,
  rawJiraUserSchema,
  rawJiraUsersSchema,
  rawJiraIssueSchema,
  rawPartialJiraIssueSchema,
  rawJiraProjectStatusesSchema,
  rawJiraStatusesSchema,
} from "./schemas";
import {
  rawJiraBoardPageSchema as reportingBoardPageSchema,
  rawJiraBoardSchema as reportingBoardSchema,
  rawJiraBoardConfigurationSchema as reportingBoardConfigurationSchema,
  rawJiraSprintPageSchema as reportingSprintPageSchema,
  rawJiraSprintSchema as reportingSprintSchema,
  rawDataCenterReportingIssuePageSchema as reportingDataCenterIssuePageSchema,
  rawJiraIssueChangelogPageSchema as reportingIssueChangelogPageSchema,
  rawJiraWorklogPageSchema as reportingWorklogPageSchema,
} from "./reporting-schemas";
import {
  mapBoardConfiguration,
  mapChangelogEntry,
  mapJiraBoard,
  mapJiraSprint,
  mapReportingIssue,
  mapWorklog,
} from "./reporting-mappers";
import { z } from "zod";

const ISSUE_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_PAGE_SIZE = 100;
const STANDARD_ISSUE_FIELDS = [
  "summary",
  "issuetype",
  "status",
  "priority",
  "assignee",
  "reporter",
  "project",
  "parent",
  "created",
  "updated",
  "startdate",
  "duedate",
  "resolutiondate",
  "labels",
  "components",
  "fixVersions",
  "progress",
  "issuelinks",
  "subtasks",
  "sprint",
  "timetracking",
  "timeoriginalestimate",
  "timespent",
] as const;

function issueRequestFields(request: GetBoardIssuesRequest): string[] {
  return request.fieldsOverride
    ? [...request.fieldsOverride]
    : [
        ...STANDARD_ISSUE_FIELDS,
        ...(request.fields ?? []),
        ...(request.storyPointsFieldId ? [request.storyPointsFieldId] : []),
      ];
}

export type IssuePageCursor = string | number | undefined;

export interface RawIssuePage {
  issues: RawJiraIssue[];
  isLast: boolean;
  nextCursor?: Exclude<IssuePageCursor, undefined>;
  total?: number;
}

export interface FetchIssuePageRequest {
  jql: string;
  fields: string[];
  pageSize: number;
  cursor: IssuePageCursor;
}

interface IssueCacheEntry {
  expiresAt: number;
  result: IssueSearchResult;
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(1, Math.trunc(value)));
}

function issueFields(mapping?: FieldMapping): string[] {
  return [
    ...new Set([
      ...STANDARD_ISSUE_FIELDS,
      mapping?.startDateFieldId,
      mapping?.endDateFieldId,
      mapping?.hierarchyFieldId,
      mapping?.storyPointsFieldId,
      mapping?.sprintFieldId,
    ]),
  ].filter((field): field is string => typeof field === "string");
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The Jira issue search was cancelled.", "AbortError");
  }
}

function reportProgress(
  callback: SearchIssuesRequest["onProgress"],
  loaded: number,
  page: number,
  total?: number,
): void {
  const progress: PageProgress = {
    loaded,
    page,
    ...(total === undefined ? {} : { total }),
  };
  callback?.(progress);
}

export abstract class BaseJiraClient implements JiraClient {
  protected abstract readonly apiVersion: "2" | "3";
  private fieldsCache?: JiraField[];
  private readonly issueCache = new Map<string, IssueCacheEntry>();

  constructor(
    protected readonly transport: JiraTransport,
    protected readonly baseUrl: string,
    protected readonly deploymentType: JiraDeploymentType,
  ) {}

  async getCurrentUser(signal?: AbortSignal): Promise<JiraUser> {
    const rawUser = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/api/${this.apiVersion}/myself`,
        headers: { Accept: "application/json" },
      },
      rawJiraUserSchema,
      signal,
    );
    return mapJiraUser(rawUser);
  }

  async getServerInfo(signal?: AbortSignal): Promise<JiraServerInfo> {
    const rawServerInfo = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/api/${this.apiVersion}/serverInfo`,
        headers: { Accept: "application/json" },
      },
      rawJiraServerInfoSchema,
      signal,
    );
    return mapJiraServerInfo(rawServerInfo, this.baseUrl, this.deploymentType);
  }

  abstract getProjects(
    options?: ProjectSearchOptions,
    signal?: AbortSignal,
  ): Promise<PaginatedResult<JiraProject>>;

  protected abstract fetchIssuePage(
    request: FetchIssuePageRequest,
    signal?: AbortSignal,
  ): Promise<RawIssuePage>;

  async getFields(signal?: AbortSignal): Promise<JiraField[]> {
    if (this.fieldsCache) {
      return this.fieldsCache;
    }

    const rawFields = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/api/${this.apiVersion}/field`,
        headers: { Accept: "application/json" },
      },
      rawJiraFieldsSchema,
      signal,
    );
    const fields = rawFields.map(mapJiraField);
    this.fieldsCache = fields;
    return fields;
  }

  async searchIssues(
    request: SearchIssuesRequest,
    signal?: AbortSignal,
  ): Promise<IssueSearchResult> {
    const jqlErrors = validateJqlInput(request.jql);
    if (jqlErrors.length > 0) {
      throw new JiraClientError({
        code: "INVALID_JQL",
        message: "The JQL query is not valid.",
        details: jqlErrors.join(" "),
        retryable: false,
      });
    }

    const jql = request.jql.trim();
    const maxIssues = boundedInteger(
      request.maxIssues,
      DEFAULT_MAX_ISSUES,
      MAX_CONFIGURABLE_ISSUES,
    );
    const pageSize = boundedInteger(request.pageSize, MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    const fields = issueFields(request.fieldMapping);
    const cacheKey = JSON.stringify({
      jql,
      maxIssues,
      pageSize,
      fieldMapping: request.fieldMapping ?? {},
    });
    const cached = this.issueCache.get(cacheKey);
    if (!request.forceRefresh && cached && cached.expiresAt > Date.now()) {
      const result = { ...cached.result, fromCache: true };
      reportProgress(request.onProgress, result.values.length, 0, result.total);
      return result;
    }
    this.issueCache.delete(cacheKey);

    const issuesById = new Map<string, NormalizedIssue>();
    let cursor: IssuePageCursor;
    let pageNumber = 0;
    let knownTotal: number | undefined;
    let isLast = false;
    let truncated = false;
    const seenCursors = new Set<string>();

    while (!isLast && issuesById.size < maxIssues) {
      abortIfRequested(signal);
      const page = await this.fetchIssuePage({ jql, fields, pageSize, cursor }, signal);
      pageNumber += 1;
      knownTotal = page.total ?? knownTotal;

      for (const rawIssue of page.issues) {
        if (issuesById.size >= maxIssues) {
          truncated = true;
          break;
        }
        const id = String(rawIssue.id);
        if (!issuesById.has(id)) {
          issuesById.set(
            id,
            mapJiraIssue(rawIssue, {
              baseUrl: this.baseUrl,
              ...(request.fieldMapping ? { fieldMapping: request.fieldMapping } : {}),
            }),
          );
        }
      }

      reportProgress(request.onProgress, issuesById.size, pageNumber, knownTotal);

      if (page.issues.length === 0 || page.isLast || page.nextCursor === undefined) {
        isLast = true;
        break;
      }

      const cursorKey = String(page.nextCursor);
      if (seenCursors.has(cursorKey)) {
        throw new JiraClientError({
          code: "INVALID_RESPONSE",
          message: "Jira returned a repeated issue-search cursor.",
          details: "Pagination stopped to prevent an infinite request loop.",
          retryable: true,
        });
      }
      seenCursors.add(cursorKey);
      cursor = page.nextCursor;
    }

    if (!isLast || (knownTotal !== undefined && knownTotal > issuesById.size)) {
      truncated = issuesById.size >= maxIssues;
    }

    const values = [...issuesById.values()];
    const result: IssueSearchResult = {
      values,
      startAt: 0,
      maxResults: maxIssues,
      total: knownTotal ?? values.length,
      isLast: !truncated,
      truncated,
      fromCache: false,
    };
    this.issueCache.set(cacheKey, {
      expiresAt: Date.now() + ISSUE_CACHE_TTL_MS,
      result,
    });
    return result;
  }

  async getBoards(
    request: GetBoardsRequest = {},
    signal?: AbortSignal,
  ): Promise<JiraBoardPage> {
    const startAt = Math.max(0, request.startAt ?? 0);
    const maxResults = Math.min(50, Math.max(1, request.maxResults ?? 25));
    const raw = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: "/rest/agile/1.0/board",
        query: {
          startAt,
          maxResults,
          ...(request.projectKeyOrId ? { projectKeyOrId: request.projectKeyOrId } : {}),
        },
        headers: { Accept: "application/json" },
      },
      reportingBoardPageSchema,
      signal,
    );
    return {
      values: raw.values.map(mapJiraBoard),
      startAt: raw.startAt,
      maxResults: raw.maxResults,
      total: raw.total,
      isLast: raw.startAt + raw.values.length >= raw.total,
    };
  }

  async getBoard(boardId: string, signal?: AbortSignal) {
    const raw = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/agile/1.0/board/${boardId}`,
        headers: { Accept: "application/json" },
      },
      reportingBoardSchema,
      signal,
    );
    return mapJiraBoard(raw);
  }

  async getBoardConfiguration(
    boardId: string,
    signal?: AbortSignal,
  ): Promise<JiraBoardConfiguration> {
    const raw = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/agile/1.0/board/${boardId}/configuration`,
        headers: { Accept: "application/json" },
      },
      reportingBoardConfigurationSchema,
      signal,
    );
    return mapBoardConfiguration(raw);
  }

  async getProjectStatuses(
    projectKeyOrId: string,
    signal?: AbortSignal,
  ): Promise<JiraStatus[]> {
    const issueTypes = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/api/${this.apiVersion}/project/${encodeURIComponent(projectKeyOrId)}/statuses`,
        headers: { Accept: "application/json" },
      },
      rawJiraProjectStatusesSchema,
      signal,
    );
    const statuses = new Map<string, JiraStatus>();
    issueTypes.forEach((issueType) =>
      issueType.statuses?.forEach((status) => {
        const statusId = String(status.id);
        statuses.set(statusId, { id: statusId, name: status.name });
      }),
    );
    return [...statuses.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  async getStatuses(signal?: AbortSignal): Promise<JiraStatus[]> {
    const rawStatuses = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/api/${this.apiVersion}/status`,
        headers: { Accept: "application/json" },
      },
      rawJiraStatusesSchema,
      signal,
    );
    return rawStatuses
      .map((status) => ({ id: String(status.id), name: status.name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async getBoardIssues(
    request: GetBoardIssuesRequest,
    signal?: AbortSignal,
  ): Promise<ReportingIssuePage> {
    const fields = issueRequestFields(request);
    const path = `/rest/agile/1.0/board/${request.boardId}/issue`;
    // The Agile REST API (board/sprint issue listing) has always used offset
    // pagination on both Cloud and Data Center — unlike the newer
    // /rest/api/3/search/jql endpoint, it never returns nextPageToken, so
    // there is no deploymentType branch here.
    const raw = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path,
        query: {
          maxResults: Math.min(100, Math.max(1, request.pageSize ?? 100)),
          fields: [...new Set(fields)].join(","),
          ...(request.jql ? { jql: request.jql, validateQuery: true } : {}),
          ...(typeof request.cursor === "number" ? { startAt: request.cursor } : {}),
        },
        headers: { Accept: "application/json" },
      },
      reportingDataCenterIssuePageSchema,
      signal,
    );
    const rawIssues = raw.issues.map((issue) =>
      (request.fieldsOverride ? rawPartialJiraIssueSchema : rawJiraIssueSchema).parse(
        issue,
      ),
    );
    const values = rawIssues.map((issue) =>
      mapReportingIssue(issue, this.baseUrl, request.storyPointsFieldId),
    );
    const nextStart = raw.startAt + values.length;
    return {
      values,
      startAt: raw.startAt,
      maxResults: raw.maxResults,
      total: raw.total,
      isLast: nextStart >= raw.total || values.length === 0,
      ...(nextStart < raw.total ? { nextCursor: nextStart } : {}),
    };
  }

  async getBoardSprints(
    request: GetBoardSprintsRequest,
    signal?: AbortSignal,
  ): Promise<JiraSprintPage> {
    const raw = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/agile/1.0/board/${request.boardId}/sprint`,
        query: {
          startAt: Math.max(0, request.startAt ?? 0),
          maxResults: Math.min(50, Math.max(1, request.maxResults ?? 25)),
          ...(request.state?.length ? { state: request.state.join(",") } : {}),
        },
        headers: { Accept: "application/json" },
      },
      reportingSprintPageSchema,
      signal,
    );
    return {
      values: raw.values.map(mapJiraSprint),
      startAt: raw.startAt,
      maxResults: raw.maxResults,
      total: raw.total,
      isLast: raw.isLast ?? raw.startAt + raw.values.length >= raw.total,
    };
  }

  async getSprint(sprintId: string, signal?: AbortSignal) {
    const raw = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/agile/1.0/sprint/${sprintId}`,
        headers: { Accept: "application/json" },
      },
      reportingSprintSchema,
      signal,
    );
    return mapJiraSprint(raw);
  }

  async getSprintIssues(
    request: GetSprintIssuesRequest,
    signal?: AbortSignal,
  ): Promise<ReportingIssuePage> {
    const fields = issueRequestFields(request);
    const path = `/rest/agile/1.0/board/${request.boardId}/sprint/${request.sprintId}/issue`;
    // See getBoardIssues: this Agile REST family always uses offset
    // pagination on both Cloud and Data Center.
    const raw = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path,
        query: {
          maxResults: Math.min(100, Math.max(1, request.pageSize ?? 100)),
          fields: [...new Set(fields)].join(","),
          ...(request.jql ? { jql: request.jql, validateQuery: true } : {}),
          ...(typeof request.cursor === "number" ? { startAt: request.cursor } : {}),
        },
        headers: { Accept: "application/json" },
      },
      reportingDataCenterIssuePageSchema,
      signal,
    );
    const rawIssues = raw.issues.map((issue) =>
      (request.fieldsOverride ? rawPartialJiraIssueSchema : rawJiraIssueSchema).parse(
        issue,
      ),
    );
    const values = rawIssues.map((issue) =>
      mapReportingIssue(issue, this.baseUrl, request.storyPointsFieldId),
    );
    const nextStart = raw.startAt + values.length;
    return {
      values,
      startAt: raw.startAt,
      maxResults: raw.maxResults,
      total: raw.total,
      isLast: nextStart >= raw.total || values.length === 0,
      ...(nextStart < raw.total ? { nextCursor: nextStart } : {}),
    };
  }

  async getIssueChangelogs(request: GetIssueChangelogsRequest) {
    // The per-issue GET changelog endpoint is the only one that exists on Data Center and
    // the only one that works everywhere: the Cloud bulk endpoint
    // (POST /rest/api/3/changelog/bulkfetch) has been observed to fail as a generic
    // network error behind some corporate proxies/WAFs that trip on that one route,
    // regardless of batch size or retries. JiraCloudClient therefore tries bulk exactly
    // once per client instance and, on any failure, delegates back here permanently — so
    // this implementation stays the contract every caller ultimately relies on.
    let completed = 0;
    const perIssue = await mapWithConcurrency(
      request.issues,
      MAX_CLIENT_CONCURRENCY,
      async (issue) => {
        const events = [] as ReturnType<typeof mapChangelogEntry>;
        let startAt = 0;
        let isLast = false;
        // Pagination stays serial: page N+1 needs page N's startAt.
        while (!isLast) {
          const raw = await this.transport.request(
            {
              baseUrl: this.baseUrl,
              method: "GET",
              path: `/rest/api/${this.apiVersion}/issue/${issue.key}/changelog`,
              query: { startAt, maxResults: 100 },
              headers: { Accept: "application/json" },
            },
            reportingIssueChangelogPageSchema,
            request.signal,
          );
          for (const entry of raw.values)
            events.push(...mapChangelogEntry(entry, issue, request));
          const loaded = startAt + raw.values.length;
          isLast =
            raw.isLast ?? (raw.values.length === 0 || loaded >= (raw.total ?? loaded));
          startAt = loaded;
        }
        completed += 1;
        request.onProgress?.(completed, request.issues.length);
        return events;
      },
      request.signal,
    );
    return perIssue.flat();
  }

  async getIssueWorklogs(request: GetIssueWorklogsRequest) {
    let completed = 0;
    const perIssue = await mapWithConcurrency(
      request.issues,
      MAX_CLIENT_CONCURRENCY,
      async (issue) => {
        const worklogs: ReportWorklog[] = [];
        let startAt = 0;
        let isLast = false;
        // Pagination stays serial: page N+1 needs page N's startAt.
        while (!isLast) {
          const raw = await this.transport.request(
            {
              baseUrl: this.baseUrl,
              method: "GET",
              path: `/rest/api/${this.apiVersion}/issue/${issue.key}/worklog`,
              query: {
                startAt,
                maxResults: 100,
                ...(this.deploymentType === "cloud" && request.periodStart
                  ? { startedAfter: new Date(request.periodStart).getTime() }
                  : {}),
                ...(this.deploymentType === "cloud" && request.periodEnd
                  ? { startedBefore: new Date(request.periodEnd).getTime() }
                  : {}),
              },
              headers: { Accept: "application/json" },
            },
            reportingWorklogPageSchema,
            request.signal,
          );
          for (const rawWorklog of raw.worklogs) {
            const normalized = mapWorklog(
              { ...rawWorklog, issueId: rawWorklog.issueId ?? issue.id },
              issue.key,
            );
            if (normalized) worklogs.push(normalized);
          }
          const loaded = startAt + raw.worklogs.length;
          isLast = raw.worklogs.length === 0 || loaded >= raw.total;
          startAt = loaded;
        }
        completed += 1;
        request.onProgress?.(completed, request.issues.length);
        return worklogs;
      },
      request.signal,
    );
    return perIssue.flat();
  }

  async getIssueEditMetadata(
    issueKey: string,
    signal?: AbortSignal,
  ): Promise<JiraIssueEditMetadata> {
    const metadata = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/api/${this.apiVersion}/issue/${issueKey}/editmeta`,
        headers: { Accept: "application/json" },
      },
      rawJiraIssueEditMetadataSchema,
      signal,
    );

    return {
      fields: Object.fromEntries(
        Object.entries(metadata.fields).map(([fieldId, field]) => [
          fieldId,
          {
            id: field.key ?? fieldId,
            name: field.name,
            required: field.required ?? false,
            operations: field.operations ?? [],
            ...(field.schema
              ? {
                  schema: {
                    ...(field.schema.type ? { type: field.schema.type } : {}),
                    ...(field.schema.custom ? { custom: field.schema.custom } : {}),
                    ...(field.schema.system ? { system: field.schema.system } : {}),
                  },
                }
              : {}),
          },
        ]),
      ),
    };
  }

  async findAssignableUsers(
    issueKey: string,
    query = "",
    signal?: AbortSignal,
  ): Promise<JiraUser[]> {
    const rawUsers = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/api/${this.apiVersion}/user/assignable/search`,
        query: {
          issueKey,
          ...(this.deploymentType === "cloud" ? { query } : { username: query }),
          startAt: 0,
          maxResults: 50,
        },
        headers: { Accept: "application/json" },
      },
      rawJiraUsersSchema,
      signal,
    );
    return rawUsers.map(mapJiraUser);
  }

  async assignIssue(
    issueKey: string,
    assignee: JiraUser | null,
    signal?: AbortSignal,
  ): Promise<void> {
    const isCloud = this.deploymentType === "cloud";
    const identifier = isCloud ? assignee?.accountId : assignee?.username;
    if (assignee && !identifier) {
      throw new JiraClientError({
        code: "INVALID_RESPONSE",
        message: "The selected Jira user has no assignable account identifier.",
        retryable: false,
      });
    }

    await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "PUT",
        path: `/rest/api/${this.apiVersion}/issue/${issueKey}/assignee`,
        headers: { Accept: "application/json" },
        body: isCloud ? { accountId: identifier ?? null } : { name: identifier ?? null },
      },
      z.unknown(),
      signal,
    );
    this.clearIssueCache();
  }

  async updateIssueDates(
    issueKey: string,
    request: UpdateIssueDatesRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    const fields: Record<string, string | null> = {};
    if (request.startDate !== undefined) {
      fields[request.fieldMapping?.startDateFieldId ?? "startdate"] = request.startDate;
    }
    if (request.dueDate !== undefined) {
      fields[request.fieldMapping?.endDateFieldId ?? "duedate"] = request.dueDate;
    }
    if (Object.keys(fields).length === 0) {
      return;
    }

    await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "PUT",
        path: `/rest/api/${this.apiVersion}/issue/${issueKey}`,
        headers: { Accept: "application/json" },
        body: { fields },
      },
      z.unknown(),
      signal,
    );
    this.clearIssueCache();
  }

  async getIssueLinkTypes(signal?: AbortSignal): Promise<JiraIssueLinkType[]> {
    const response = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: `/rest/api/${this.apiVersion}/issueLinkType`,
        headers: { Accept: "application/json" },
      },
      rawJiraIssueLinkTypesSchema,
      signal,
    );
    return response.issueLinkTypes.map((type) => ({
      id: String(type.id),
      name: type.name,
      inward: type.inward,
      outward: type.outward,
    }));
  }

  async createIssueLink(
    request: CreateIssueLinkRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "POST",
        path: `/rest/api/${this.apiVersion}/issueLink`,
        headers: { Accept: "application/json" },
        body: {
          type: { name: request.typeName },
          inwardIssue: { key: request.inwardIssueKey },
          outwardIssue: { key: request.outwardIssueKey },
        },
      },
      z.unknown(),
      signal,
    );
    this.clearIssueCache();
  }

  async deleteIssueLink(linkId: string, signal?: AbortSignal): Promise<void> {
    await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "DELETE",
        path: `/rest/api/${this.apiVersion}/issueLink/${linkId}`,
        headers: { Accept: "application/json" },
      },
      z.unknown(),
      signal,
    );
    this.clearIssueCache();
  }

  clearIssueCache(): void {
    this.issueCache.clear();
  }
}
