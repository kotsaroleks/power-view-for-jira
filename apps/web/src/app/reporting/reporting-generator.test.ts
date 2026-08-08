import type {
  BoardReportConfiguration,
  ReportingIssueSnapshot,
} from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import { describe, expect, it, vi } from "vitest";

import { generateReport } from "./reporting-generator";

const jql = "filter = 9001 ORDER BY Rank ASC";
const statusMapping: BoardReportConfiguration = {
  schemaVersion: 1,
  jiraBaseUrl: "https://example.atlassian.net",
  boardId: "7",
  completedStatusIds: ["3"],
  completedStatusNames: ["Done"],
  updatedAt: "2026-08-04T12:00:00.000Z",
};

function issue(id: string): ReportingIssueSnapshot {
  return {
    id,
    key: `POWER-${id}`,
    browseUrl: `https://example.atlassian.net/browse/POWER-${id}`,
    summary: `Issue ${id}`,
    issueType: { id: "1", name: "Task" },
    status: { id: "3", name: "Done" },
    sprintIds: ["101"],
  };
}

function clientFixture() {
  return {
    getBoard: vi.fn().mockResolvedValue({
      id: "7",
      name: "Power Delivery Board",
      type: "scrum",
      projectKeys: ["POWER"],
    }),
    getBoardConfiguration: vi.fn().mockResolvedValue({
      id: "7",
      name: "Power Delivery Board",
      statusIds: ["3"],
    }),
    getBoardIssues: vi.fn().mockResolvedValue({
      values: [issue("1")],
      startAt: 0,
      maxResults: 100,
      total: 1,
      isLast: true,
    }),
    getSprint: vi.fn().mockResolvedValue({
      id: "101",
      name: "Sprint 101",
      state: "active",
      originBoardId: "7",
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-08-14T00:00:00.000Z",
    }),
    getSprintIssues: vi.fn().mockResolvedValue({
      values: [issue("1")],
      startAt: 0,
      maxResults: 100,
      total: 1,
      isLast: true,
    }),
    getIssueChangelogs: vi.fn().mockResolvedValue([]),
    getIssueWorklogs: vi.fn().mockResolvedValue([]),
  };
}

describe("generateReport workspace scope", () => {
  it("passes the saved board JQL to Daily and Weekly issue pagination", async () => {
    const client = clientFixture();

    const snapshot = await generateReport({
      client: client as unknown as JiraClient,
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
      request: {
        type: "daily",
        boardId: "7",
        jql,
        localDate: "2026-08-04",
        scope: { kind: "team" },
        language: "uk",
        statusMapping,
      },
    });

    expect(client.getBoardIssues).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: "7", jql }),
      undefined,
    );
    expect(snapshot.request).toMatchObject({ boardId: "7", jql, type: "daily" });
    expect(snapshot.issues.map((item) => item.key)).toEqual(["POWER-1"]);
  });

  it("keeps Sprint membership and board history inside the same saved JQL", async () => {
    const client = clientFixture();

    await generateReport({
      client: client as unknown as JiraClient,
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
      request: {
        type: "sprint",
        boardId: "7",
        sprintId: "101",
        jql,
        localDate: "2026-08-04",
        scope: { kind: "team" },
        language: "uk",
        progressMode: "issue-count",
        statusMapping,
      },
    });

    expect(client.getSprintIssues).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: "7", sprintId: "101", jql }),
      undefined,
    );
    expect(client.getBoardIssues).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: "7", jql }),
      undefined,
    );
  });
});

describe("generateReport history fetch narrowing", () => {
  const sprintRequest = {
    type: "sprint",
    boardId: "7",
    sprintId: "101",
    jql,
    localDate: "2026-08-04",
    scope: { kind: "team" },
    language: "uk",
    progressMode: "issue-count",
    statusMapping,
  } as const;

  function boardIssue(id: string, updatedAt?: string): ReportingIssueSnapshot {
    const base = { ...issue(id), sprintIds: [] };
    return updatedAt ? { ...base, updatedAt } : base;
  }

  function sprintScopeClient() {
    const client = clientFixture();
    client.getSprintIssues.mockResolvedValue({
      values: [issue("1")],
      startAt: 0,
      maxResults: 100,
      total: 1,
      isLast: true,
    });
    client.getBoardIssues.mockResolvedValue({
      values: [
        issue("1"),
        boardIssue("2", "2026-07-01T09:00:00.000Z"),
        boardIssue("3", "2026-08-05T09:00:00.000Z"),
        boardIssue("4"),
      ],
      startAt: 0,
      maxResults: 100,
      total: 4,
      isLast: true,
    });
    return client;
  }

  it("skips changelogs for issues last updated before the period started", async () => {
    const client = sprintScopeClient();

    await generateReport({
      client: client as unknown as JiraClient,
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
      request: sprintRequest,
    });

    const [changelogRequest] = client.getIssueChangelogs.mock.calls[0] as [
      { issues: Array<{ id: string }> },
    ];
    expect(changelogRequest.issues.map((item) => item.id)).toEqual(["1", "3", "4"]);
  });

  it("requests worklogs for every candidate issue, including board-only ones", async () => {
    const client = sprintScopeClient();

    await generateReport({
      client: client as unknown as JiraClient,
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
      request: sprintRequest,
    });

    const [worklogRequest] = client.getIssueWorklogs.mock.calls[0] as [
      { issues: Array<{ id: string }> },
    ];
    expect(worklogRequest.issues.map((item) => item.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps board-only issues in the sprint scope-change blocks", async () => {
    const client = sprintScopeClient();
    client.getIssueChangelogs.mockResolvedValue([
      {
        id: "sprint-removed:3",
        issueId: "3",
        issueKey: "POWER-3",
        type: "sprint-removed",
        occurredAt: "2026-08-05T09:00:00.000Z",
      },
    ]);

    const snapshot = await generateReport({
      client: client as unknown as JiraClient,
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
      request: sprintRequest,
    });

    expect(
      snapshot.result.sprint?.removedAfterStart.map((entry) => entry.issue.key),
    ).toEqual(["POWER-3"]);
  });
});
