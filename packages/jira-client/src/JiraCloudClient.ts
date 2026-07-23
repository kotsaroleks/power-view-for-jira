import type {
  JiraProject,
  PaginatedResult,
  ProjectSearchOptions,
} from "@power-view/domain";

import type { JiraTransport } from "./JiraTransport";
import {
  BaseJiraClient,
  type FetchIssuePageRequest,
  type RawIssuePage,
} from "./BaseJiraClient";
import { mapJiraProject } from "./mappers";
import { rawCloudIssueSearchPageSchema, rawCloudProjectPageSchema } from "./schemas";

export class JiraCloudClient extends BaseJiraClient {
  protected readonly apiVersion = "3" as const;

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
}
