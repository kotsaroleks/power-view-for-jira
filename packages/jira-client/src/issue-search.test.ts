import type { PageProgress } from "@power-view/domain";
import type { JiraTransportRequest } from "@power-view/extension-messaging";
import { makeJiraIssueFixtures } from "@power-view/test-fixtures";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { createJiraClient } from "./JiraClient";
import type { JiraTransport } from "./JiraTransport";

function cloudFixtureTransport(issueCount: number): {
  transport: JiraTransport;
  requestMock: ReturnType<typeof vi.fn>;
} {
  const fixtures = makeJiraIssueFixtures(issueCount);
  const requestMock = vi.fn(
    <TResponse>(
      request: JiraTransportRequest,
      schema: z.ZodType<TResponse>,
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("cancelled", "AbortError"));
      }
      const token = request.query?.nextPageToken;
      const startAt = typeof token === "string" ? Number(token) : 0;
      const maxResults = Number(request.query?.maxResults ?? 100);
      const pageIssues = fixtures.slice(startAt, startAt + maxResults);
      const duplicate = startAt > 0 ? fixtures[startAt - 1] : undefined;
      if (duplicate) {
        pageIssues.unshift(duplicate);
      }
      const nextAt = startAt + maxResults;
      return Promise.resolve(
        schema.parse({
          issues: pageIssues,
          isLast: nextAt >= fixtures.length,
          ...(nextAt < fixtures.length ? { nextPageToken: String(nextAt) } : {}),
        }),
      );
    },
  );

  return {
    transport: { request: requestMock as unknown as JiraTransport["request"] },
    requestMock,
  };
}

describe("paginated issue search", () => {
  it("loads a Gantt workspace through its board endpoint, never a project-wide search", async () => {
    const fixtures = makeJiraIssueFixtures(20);
    const requestMock = vi.fn(
      <TResponse>(request: JiraTransportRequest, schema: z.ZodType<TResponse>) => {
        const startAt = Number(request.query?.startAt ?? 0);
        const maxResults = Number(request.query?.maxResults ?? 100);
        return Promise.resolve(
          schema.parse({
            issues: fixtures.slice(startAt, startAt + maxResults),
            startAt,
            maxResults,
            total: fixtures.length,
          }),
        );
      },
    );
    const client = createJiraClient(
      { request: requestMock as unknown as JiraTransport["request"] },
      { baseUrl: "https://fixture.atlassian.net", deploymentType: "cloud" },
    );

    const result = await client.searchBoardIssues({
      boardId: "2487",
      fieldMapping: { startDateFieldId: "customfield_10010" },
    });

    expect(result.values).toHaveLength(20);
    expect(requestMock).toHaveBeenCalledOnce();
    expect(requestMock.mock.calls[0]?.[0]).toMatchObject({
      path: "/rest/agile/1.0/board/2487/issue",
      query: { startAt: 0, maxResults: 100 },
    });
    expect(
      requestMock.mock.calls.some(([request]) =>
        (request as JiraTransportRequest).path.includes("/search"),
      ),
    ).toBe(false);
  });

  it("loads 1,000 fixtures without duplicates and reports progress", async () => {
    const { transport, requestMock } = cloudFixtureTransport(1_000);
    const client = createJiraClient(transport, {
      baseUrl: "https://fixture.atlassian.net",
      deploymentType: "cloud",
    });
    const progress: PageProgress[] = [];

    const result = await client.searchIssues({
      jql: 'project = "POWER" ORDER BY Rank ASC',
      fieldMapping: { startDateFieldId: "customfield_10010" },
      onProgress: (value) => progress.push(value),
    });

    expect(result.values).toHaveLength(1_000);
    expect(new Set(result.values.map((issue) => issue.id)).size).toBe(1_000);
    expect(result).toMatchObject({
      total: 1_000,
      isLast: true,
      truncated: false,
      fromCache: false,
    });
    expect(progress.at(-1)).toEqual({ loaded: 1_000, page: 10 });
    expect(requestMock).toHaveBeenCalledTimes(10);

    const cached = await client.searchIssues({
      jql: 'project = "POWER" ORDER BY Rank ASC',
      fieldMapping: { startDateFieldId: "customfield_10010" },
    });
    expect(cached.fromCache).toBe(true);
    expect(requestMock).toHaveBeenCalledTimes(10);

    client.clearIssueCache();
    const refreshed = await client.searchIssues({
      jql: 'project = "POWER" ORDER BY Rank ASC',
      fieldMapping: { startDateFieldId: "customfield_10010" },
    });
    expect(refreshed.fromCache).toBe(false);
    expect(requestMock).toHaveBeenCalledTimes(20);
  });

  it("enforces the configured maximum", async () => {
    const { transport, requestMock } = cloudFixtureTransport(1_200);
    const client = createJiraClient(transport, {
      baseUrl: "https://fixture.atlassian.net",
      deploymentType: "cloud",
    });

    const result = await client.searchIssues({
      jql: "project = POWER",
      maxIssues: 1_000,
    });

    expect(result.values).toHaveLength(1_000);
    expect(result.truncated).toBe(true);
    expect(result.isLast).toBe(false);
    expect(requestMock).toHaveBeenCalledTimes(10);
  });

  it("stops before the next page when search is cancelled", async () => {
    const { transport, requestMock } = cloudFixtureTransport(300);
    const client = createJiraClient(transport, {
      baseUrl: "https://fixture.atlassian.net",
      deploymentType: "cloud",
    });
    const controller = new AbortController();

    await expect(
      client.searchIssues(
        {
          jql: "project = POWER",
          onProgress: () => controller.abort(),
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("uses startAt pagination for Data Center", async () => {
    const fixtures = makeJiraIssueFixtures(150);
    const requestMock = vi.fn(
      <TResponse>(request: JiraTransportRequest, schema: z.ZodType<TResponse>) => {
        const startAt = Number(request.query?.startAt ?? 0);
        const maxResults = Number(request.query?.maxResults ?? 100);
        return Promise.resolve(
          schema.parse({
            issues: fixtures.slice(startAt, startAt + maxResults),
            startAt,
            maxResults,
            total: fixtures.length,
          }),
        );
      },
    );
    const client = createJiraClient(
      { request: requestMock as unknown as JiraTransport["request"] },
      {
        baseUrl: "https://jira.fixture.test",
        deploymentType: "data-center",
      },
    );

    const result = await client.searchIssues({
      jql: "project = POWER",
      pageSize: 100,
    });

    expect(result.values).toHaveLength(150);
    expect(result.total).toBe(150);
    expect(requestMock).toHaveBeenCalledTimes(2);
    const secondRequest: unknown = requestMock.mock.calls[1]?.[0];
    expect(secondRequest).toMatchObject({
      path: "/rest/api/2/search",
      query: { startAt: 100, maxResults: 100, validateQuery: true },
    });
  });
});
