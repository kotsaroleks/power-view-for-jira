import type {
  FieldMapping,
  IssueSearchResult,
  JiraDeploymentType,
  JiraField,
  JiraProject,
  JiraServerInfo,
  JiraUser,
  NormalizedIssue,
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
  UpdateIssueDatesRequest,
} from "./JiraClient";
import type { JiraTransport } from "./JiraTransport";
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
} from "./schemas";
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
] as const;

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
