import type {
  JiraDeploymentType,
  JiraProject,
  PaginatedResult,
  ProjectSearchOptions,
} from "@power-view/domain";

import {
  BaseJiraClient,
  type FetchIssuePageRequest,
  type RawIssuePage,
} from "./BaseJiraClient";
import type { JiraTransport } from "./JiraTransport";
import { mapJiraProject } from "./mappers";
import {
  rawDataCenterIssueSearchPageSchema,
  rawDataCenterProjectsSchema,
} from "./schemas";

export class JiraDataCenterClient extends BaseJiraClient {
  protected readonly apiVersion = "2" as const;

  constructor(
    transport: JiraTransport,
    baseUrl: string,
    deploymentType: JiraDeploymentType = "unknown",
  ) {
    super(transport, baseUrl, deploymentType);
  }

  async getProjects(
    options: ProjectSearchOptions = {},
    signal?: AbortSignal,
  ): Promise<PaginatedResult<JiraProject>> {
    const rawProjects = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: "/rest/api/2/project",
        headers: { Accept: "application/json" },
      },
      rawDataCenterProjectsSchema,
      signal,
    );
    const query = options.query?.trim().toLocaleLowerCase() ?? "";
    const projects = rawProjects
      .map(mapJiraProject)
      .filter(
        (project) =>
          !query ||
          project.key.toLocaleLowerCase().includes(query) ||
          project.name.toLocaleLowerCase().includes(query),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    const startAt = Math.max(0, options.startAt ?? 0);
    const maxResults = Math.min(50, Math.max(1, options.maxResults ?? 25));
    const values = projects.slice(startAt, startAt + maxResults);

    return {
      values,
      startAt,
      maxResults,
      total: projects.length,
      isLast: startAt + values.length >= projects.length,
    };
  }

  protected async fetchIssuePage(
    request: FetchIssuePageRequest,
    signal?: AbortSignal,
  ): Promise<RawIssuePage> {
    const startAt = typeof request.cursor === "number" ? request.cursor : 0;
    const rawPage = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "GET",
        path: "/rest/api/2/search",
        query: {
          jql: request.jql,
          startAt,
          maxResults: request.pageSize,
          fields: request.fields.join(","),
          validateQuery: true,
        },
        headers: { Accept: "application/json" },
      },
      rawDataCenterIssueSearchPageSchema,
      signal,
    );
    const nextStart = rawPage.startAt + rawPage.issues.length;

    return {
      issues: rawPage.issues,
      total: rawPage.total,
      isLast: rawPage.issues.length === 0 || nextStart >= rawPage.total,
      ...(nextStart < rawPage.total ? { nextCursor: nextStart } : {}),
    };
  }
}
