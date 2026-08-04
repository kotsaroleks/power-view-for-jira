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
