import type { JiraTransportRequest } from "@power-view/extension-messaging";
import { makeJiraIssueFixtures } from "@power-view/test-fixtures";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { createJiraClient } from "./JiraClient";
import type { JiraTransport } from "./JiraTransport";

function transportWith(data: unknown): {
  transport: JiraTransport;
  requestMock: ReturnType<typeof vi.fn>;
} {
  const requestMock = vi.fn(
    <TResponse>(_request: JiraTransportRequest, schema: z.ZodType<TResponse>) =>
      Promise.resolve(schema.parse(data)),
  );
  const request = requestMock as unknown as JiraTransport["request"];

  return {
    transport: { request },
    requestMock,
  };
}

describe("createJiraClient", () => {
  it("loads the global status catalog for board statuses outside the selected project", async () => {
    const { transport, requestMock } = transportWith([
      { id: "10013", name: "In Review" },
      { id: "3", name: "In Progress" },
    ]);
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    await expect(client.getStatuses()).resolves.toEqual([
      { id: "3", name: "In Progress" },
      { id: "10013", name: "In Review" },
    ]);
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/rest/api/3/status", method: "GET" }),
      expect.anything(),
      undefined,
    );
  });

  it("loads and deduplicates every workflow status for a Cloud project", async () => {
    const { transport, requestMock } = transportWith([
      {
        id: "10000",
        statuses: [
          { id: "1", name: "To Do" },
          { id: "4", name: "In Review" },
        ],
      },
      {
        id: "10001",
        statuses: [
          { id: "4", name: "In Review" },
          { id: "3", name: "Done" },
        ],
      },
    ]);
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    await expect(client.getProjectStatuses("POWER")).resolves.toEqual([
      { id: "3", name: "Done" },
      { id: "4", name: "In Review" },
      { id: "1", name: "To Do" },
    ]);
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/rest/api/3/project/POWER/statuses",
      }),
      expect.anything(),
      undefined,
    );
  });

  it("uses public Agile REST for Cloud board and sprint issue scopes", async () => {
    const { transport, requestMock } = transportWith({
      issues: makeJiraIssueFixtures(1),
      startAt: 0,
      maxResults: 100,
      total: 1,
    });
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    await client.getBoardIssues({ boardId: "7", jql: "filter = 9001" });
    await client.getSprintIssues({
      boardId: "7",
      sprintId: "101",
      jql: "filter = 9001",
    });

    expect(requestMock.mock.calls[0]?.[0]).toMatchObject({
      path: "/rest/agile/1.0/board/7/issue",
      query: { jql: "filter = 9001", validateQuery: true },
    });
    expect(requestMock.mock.calls[1]?.[0]).toMatchObject({
      path: "/rest/agile/1.0/board/7/sprint/101/issue",
      query: { jql: "filter = 9001", validateQuery: true },
    });
  });

  it("uses REST v3 for Jira Cloud", async () => {
    const { transport, requestMock } = transportWith({
      accountId: "a1",
      displayName: "Cloud User",
    });
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    await client.getCurrentUser();

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/rest/api/3/myself", method: "GET" }),
      expect.anything(),
      undefined,
    );
  });

  it("uses REST v2 for Data Center", async () => {
    const { transport, requestMock } = transportWith({
      displayName: "Server User",
      name: "server-user",
    });
    const client = createJiraClient(transport, {
      baseUrl: "https://jira.example.com",
      deploymentType: "data-center",
    });

    await client.getCurrentUser();

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/rest/api/2/myself", method: "GET" }),
      expect.anything(),
      undefined,
    );
  });

  it("maps a paginated Jira Cloud project search", async () => {
    const { transport, requestMock } = transportWith({
      values: [
        {
          id: "10000",
          key: "POWER",
          name: "Power View",
          avatarUrls: { "48x48": "https://example.atlassian.net/avatar.png" },
        },
      ],
      startAt: 0,
      maxResults: 25,
      total: 1,
      isLast: true,
    });
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    await expect(client.getProjects({ query: "power" })).resolves.toEqual({
      values: [
        {
          id: "10000",
          key: "POWER",
          name: "Power View",
          avatarUrl: "https://example.atlassian.net/avatar.png",
        },
      ],
      startAt: 0,
      maxResults: 25,
      total: 1,
      isLast: true,
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/rest/api/3/project/search",
      }),
      expect.anything(),
      undefined,
    );
    const projectRequest: unknown = requestMock.mock.calls[0]?.[0];
    expect(projectRequest).toMatchObject({
      query: { query: "power", orderBy: "name", startAt: 0, maxResults: 25 },
    });
  });

  it("searches and paginates Data Center projects locally", async () => {
    const { transport } = transportWith([
      { id: "2", key: "OPS", name: "Operations" },
      { id: "1", key: "POWER", name: "Power View" },
      { id: "3", key: "WEB", name: "Website" },
    ]);
    const client = createJiraClient(transport, {
      baseUrl: "https://jira.example.com",
      deploymentType: "data-center",
    });

    await expect(
      client.getProjects({ query: "p", startAt: 1, maxResults: 1 }),
    ).resolves.toEqual({
      values: [{ id: "1", key: "POWER", name: "Power View" }],
      startAt: 1,
      maxResults: 1,
      total: 2,
      isLast: true,
    });
  });

  it("loads and caches normalized field metadata", async () => {
    const { transport, requestMock } = transportWith([
      {
        id: "customfield_10010",
        name: "Planned Start",
        schema: { type: "date" },
        clauseNames: ["Planned Start"],
      },
    ]);
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    const first = await client.getFields();
    const second = await client.getFields();

    expect(first).toEqual([
      {
        id: "customfield_10010",
        name: "Planned Start",
        custom: true,
        schema: { type: "date" },
        clauseNames: ["Planned Start"],
      },
    ]);
    expect(second).toBe(first);
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("maps issue edit metadata and assignable Cloud users", async () => {
    const metadataFixture = transportWith({
      fields: {
        assignee: {
          key: "assignee",
          name: "Assignee",
          required: false,
          operations: ["set"],
          schema: { type: "user" },
        },
      },
    });
    const client = createJiraClient(metadataFixture.transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    await expect(client.getIssueEditMetadata("POWER-42")).resolves.toEqual({
      fields: {
        assignee: {
          id: "assignee",
          name: "Assignee",
          required: false,
          operations: ["set"],
          schema: { type: "user" },
        },
      },
    });

    const usersFixture = transportWith([
      { accountId: "account-1", displayName: "Alex Rivera" },
    ]);
    const usersClient = createJiraClient(usersFixture.transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });
    await expect(usersClient.findAssignableUsers("POWER-42", "Alex")).resolves.toEqual([
      { accountId: "account-1", displayName: "Alex Rivera" },
    ]);
    expect(usersFixture.requestMock.mock.calls[0]?.[0]).toMatchObject({
      path: "/rest/api/3/user/assignable/search",
      query: { issueKey: "POWER-42", query: "Alex", startAt: 0, maxResults: 50 },
    });
  });

  it("builds strict Cloud mutation requests for assignee, dates, and links", async () => {
    const { transport, requestMock } = transportWith(null);
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    await client.assignIssue("POWER-42", {
      accountId: "account-1",
      displayName: "Alex Rivera",
    });
    await client.updateIssueDates("POWER-42", {
      fieldMapping: {
        startDateFieldId: "customfield_10010",
        endDateFieldId: "duedate",
      },
      startDate: "2026-08-01",
      dueDate: "2026-08-10",
    });
    await client.createIssueLink({
      typeName: "Blocks",
      inwardIssueKey: "POWER-42",
      outwardIssueKey: "POWER-1",
    });
    await client.deleteIssueLink("10001");

    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "PUT",
        path: "/rest/api/3/issue/POWER-42/assignee",
        body: { accountId: "account-1" },
      }),
      expect.anything(),
      undefined,
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "PUT",
        path: "/rest/api/3/issue/POWER-42",
        body: {
          fields: {
            customfield_10010: "2026-08-01",
            duedate: "2026-08-10",
          },
        },
      }),
      expect.anything(),
      undefined,
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: "POST",
        path: "/rest/api/3/issueLink",
        body: {
          type: { name: "Blocks" },
          inwardIssue: { key: "POWER-42" },
          outwardIssue: { key: "POWER-1" },
        },
      }),
      expect.anything(),
      undefined,
    );
    expect(requestMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        method: "DELETE",
        path: "/rest/api/3/issueLink/10001",
      }),
      expect.anything(),
      undefined,
    );
  });

  it("loads Jira issue link types", async () => {
    const { transport } = transportWith({
      issueLinkTypes: [
        {
          id: "10000",
          name: "Blocks",
          inward: "is blocked by",
          outward: "blocks",
        },
      ],
    });
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    await expect(client.getIssueLinkTypes()).resolves.toEqual([
      {
        id: "10000",
        name: "Blocks",
        inward: "is blocked by",
        outward: "blocks",
      },
    ]);
  });

  it("requests the configured Sprint field id in the changelog bulkfetch, never the literal name", async () => {
    const { transport, requestMock } = transportWith({ issueChangeLogs: [] });
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    await client.getIssueChangelogs({
      issues: [{ id: "10001", key: "POWER-1" }],
      sprintFieldId: "customfield_10020",
    });

    const request = requestMock.mock.calls[0]?.[0] as JiraTransportRequest;
    const body = request.body as { fieldIds: string[] };
    expect(body.fieldIds).toContain("customfield_10020");
    expect(body.fieldIds).not.toContain("Sprint");
  });

  it("omits the Sprint field entirely from the changelog bulkfetch when no field id is configured", async () => {
    const { transport, requestMock } = transportWith({ issueChangeLogs: [] });
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });

    await client.getIssueChangelogs({ issues: [{ id: "10001", key: "POWER-1" }] });

    const request = requestMock.mock.calls[0]?.[0] as JiraTransportRequest;
    const body = request.body as { fieldIds: string[] };
    expect(body.fieldIds).not.toContain("Sprint");
    expect(body.fieldIds.some((id) => id.startsWith("customfield_"))).toBe(false);
  });

  it("batches the changelog bulkfetch instead of sending hundreds of issues in one request", async () => {
    const { transport, requestMock } = transportWith({ issueChangeLogs: [] });
    const client = createJiraClient(transport, {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });
    const issues = Array.from({ length: 120 }, (_, index) => ({
      id: String(10_000 + index),
      key: `POWER-${index}`,
    }));

    await client.getIssueChangelogs({ issues });

    expect(requestMock).toHaveBeenCalledTimes(3);
    for (const call of requestMock.mock.calls) {
      const body = (call[0] as JiraTransportRequest).body as {
        issueIdsOrKeys: string[];
      };
      expect(body.issueIdsOrKeys.length).toBeLessThanOrEqual(50);
    }
  });
});
