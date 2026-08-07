import type {
  JiraProject,
  PaginatedResult,
  ProjectSearchOptions,
  ReportChangeEvent,
} from "@power-view/domain";

import type { JiraTransport } from "./JiraTransport";
import {
  BaseJiraClient,
  type FetchIssuePageRequest,
  type RawIssuePage,
} from "./BaseJiraClient";
import { MAX_CLIENT_CONCURRENCY, mapWithConcurrency } from "./concurrency";
import { mapJiraProject } from "./mappers";
import type { GetIssueChangelogsRequest } from "./reporting-api";
import { mapChangelogEntry } from "./reporting-mappers";
import {
  rawCloudBulkChangelogSchema,
  type RawJiraChangelogEntry,
} from "./reporting-schemas";
import { rawCloudIssueSearchPageSchema, rawCloudProjectPageSchema } from "./schemas";

/** The documented cap on `issueIdsOrKeys` for POST /rest/api/3/changelog/bulkfetch. */
const BULK_CHANGELOG_BATCH_SIZE = 1_000;
/** Also the request-policy ceiling in apps/extension/src/jira-request-policy.ts. */
const BULK_CHANGELOG_PAGE_SIZE = 1_000;

export class JiraCloudClient extends BaseJiraClient {
  protected readonly apiVersion = "3" as const;
  private bulkChangelogUnavailable = false;

  constructor(transport: JiraTransport, baseUrl: string) {
    super(transport, baseUrl, "cloud");
  }

  async getProjects(
    options: ProjectSearchOptions = {},
    signal?: AbortSignal,
  ): Promise<PaginatedResult<JiraProject>> {
    const startAt = Math.max(0, options.startAt ?? 0);
    const maxResults = Math.min(50, Math.max(1, options.maxResults ?? 25));
    const rawPage = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: "/rest/api/3/project/search",
        query: {
          startAt,
          maxResults,
          orderBy: "name",
          ...(options.query?.trim() ? { query: options.query.trim() } : {}),
        },
        headers: { Accept: "application/json" },
      },
      rawCloudProjectPageSchema,
      signal,
    );

    return {
      values: rawPage.values.map(mapJiraProject),
      startAt: rawPage.startAt,
      maxResults: rawPage.maxResults,
      total: rawPage.total,
      isLast: rawPage.isLast ?? rawPage.startAt + rawPage.values.length >= rawPage.total,
    };
  }

  protected async fetchIssuePage(
    request: FetchIssuePageRequest,
    signal?: AbortSignal,
  ): Promise<RawIssuePage> {
    const rawPage = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: "/rest/api/3/search/jql",
        query: {
          jql: request.jql,
          maxResults: request.pageSize,
          fields: request.fields.join(","),
          fieldsByKeys: false,
          failFast: true,
          ...(typeof request.cursor === "string"
            ? { nextPageToken: request.cursor }
            : {}),
        },
        headers: { Accept: "application/json" },
      },
      rawCloudIssueSearchPageSchema,
      signal,
    );

    return {
      issues: rawPage.issues,
      isLast: rawPage.isLast ?? !rawPage.nextPageToken,
      ...(rawPage.nextPageToken ? { nextCursor: rawPage.nextPageToken } : {}),
    };
  }

  /**
   * Collapses thousands of per-issue changelog GETs into a handful of bulk POSTs. The
   * endpoint is unreachable in some networks (see BaseJiraClient.getIssueChangelogs), so
   * it is tried once per client instance and abandoned permanently on any failure.
   */
  override async getIssueChangelogs(
    request: GetIssueChangelogsRequest,
  ): Promise<ReportChangeEvent[]> {
    if (this.bulkChangelogUnavailable || request.issues.length === 0)
      return super.getIssueChangelogs(request);

    try {
      return await this.fetchBulkChangelogs(request);
    } catch (cause) {
      // An abort is the caller's decision, not evidence about the endpoint.
      if (request.signal?.aborted) throw cause;
      this.bulkChangelogUnavailable = true;
      return super.getIssueChangelogs(request);
    }
  }

  private async fetchBulkChangelogs(
    request: GetIssueChangelogsRequest,
  ): Promise<ReportChangeEvent[]> {
    const batches: Array<GetIssueChangelogsRequest["issues"]> = [];
    for (let start = 0; start < request.issues.length; start += BULK_CHANGELOG_BATCH_SIZE)
      batches.push(request.issues.slice(start, start + BULK_CHANGELOG_BATCH_SIZE));

    const perBatch = await mapWithConcurrency(
      batches,
      MAX_CLIENT_CONCURRENCY,
      (batch) => this.fetchBulkChangelogBatch(batch, request),
      request.signal,
    );

    // Group by issue and emit in request order, so the event sequence handed to
    // dedupeEvents matches the per-issue path exactly.
    const entriesByIssueId = new Map<string, RawJiraChangelogEntry[]>();
    for (const batch of perBatch)
      for (const [issueId, entries] of batch) entriesByIssueId.set(issueId, entries);

    const events: ReportChangeEvent[] = [];
    let completed = 0;
    for (const issue of request.issues) {
      for (const entry of entriesByIssueId.get(issue.id) ?? [])
        events.push(...mapChangelogEntry(entry, issue, request));
      completed += 1;
      request.onProgress?.(completed, request.issues.length);
    }
    return events;
  }

  private async fetchBulkChangelogBatch(
    batch: GetIssueChangelogsRequest["issues"],
    request: GetIssueChangelogsRequest,
  ): Promise<Map<string, RawJiraChangelogEntry[]>> {
    const entriesByIssueId = new Map<string, RawJiraChangelogEntry[]>();
    let nextPageToken: string | undefined;

    // One continuation token covers the whole batch, so a page can cut an issue's history
    // in half; anything short of draining the token silently truncates that issue.
    // Pagination stays serial: page N+1 needs page N's token.
    do {
      const raw = await this.transport.request(
        {
          baseUrl: this.baseUrl,
          method: "POST",
          path: "/rest/api/3/changelog/bulkfetch",
          headers: { Accept: "application/json" },
          body: {
            issueIdsOrKeys: batch.map((issue) => issue.id),
            // fieldIds is omitted, not sent empty: the Atlassian schema marks it optional
            // but never defines what [] means, and "filter to no fields" would silently
            // return zero changes. We need every field anyway, because mapChangelogEntry
            // derives event ids from an entry's item index and a server-side filter would
            // renumber them.
            maxResults: BULK_CHANGELOG_PAGE_SIZE,
            ...(nextPageToken ? { nextPageToken } : {}),
          },
        },
        rawCloudBulkChangelogSchema,
        request.signal,
      );

      for (const issueLog of raw.issueChangeLogs) {
        const issueId = String(issueLog.issueId);
        const entries = entriesByIssueId.get(issueId);
        if (entries) entries.push(...(issueLog.changeHistories ?? []));
        else entriesByIssueId.set(issueId, [...(issueLog.changeHistories ?? [])]);
      }

      const token = raw.nextPageToken ?? undefined;
      // A token that never advances would loop forever; treat it as a broken endpoint and
      // let the caller fall back rather than silently returning a partial history.
      if (token && token === nextPageToken)
        throw new Error("The Jira bulk changelog endpoint repeated its page token.");
      nextPageToken = token;
    } while (nextPageToken);

    return entriesByIssueId;
  }
}
