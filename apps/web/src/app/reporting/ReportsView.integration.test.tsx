import type { BoardReportConfiguration, JiraBoard } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import { MemoryReportHistoryStore } from "@power-view/storage";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReportsView } from "./ReportsView";

const board: JiraBoard = {
  id: "7",
  name: "Power Delivery Board",
  type: "scrum",
  projectKeys: ["POWER"],
};

const statusMapping: BoardReportConfiguration = {
  schemaVersion: 1,
  jiraBaseUrl: "https://example.atlassian.net",
  boardId: "7",
  completedStatusIds: ["3"],
  completedStatusNames: ["Done"],
  updatedAt: "2026-08-04T12:00:00.000Z",
};

describe("ReportsView workspace inheritance", () => {
  it("uses the configured board and status mapping without local selectors", async () => {
    const getBoards = vi.fn();
    const client = {
      getBoards,
      getBoardIssues: vi.fn().mockResolvedValue({
        values: [
          {
            id: "100",
            key: "POWER-1",
            browseUrl: "https://example.atlassian.net/browse/POWER-1",
            summary: "Release task",
            issueType: { id: "1", name: "Task" },
            status: { id: "2", name: "In Progress" },
            assignee: { id: "alex", displayName: "Alex Rivera" },
            sprintIds: ["101"],
          },
        ],
        startAt: 0,
        maxResults: 100,
        total: 1,
        isLast: true,
      }),
      getBoardSprints: vi.fn().mockResolvedValue({
        values: [{ id: "101", name: "Sprint 101", state: "active" }],
        startAt: 0,
        maxResults: 50,
        total: 1,
        isLast: true,
      }),
    } as unknown as JiraClient;

    render(
      <ReportsView
        client={client}
        baseUrl="https://example.atlassian.net"
        deploymentType="cloud"
        board={board}
        jql="filter = 9001 ORDER BY Rank ASC"
        statusMapping={statusMapping}
        historyStore={new MemoryReportHistoryStore()}
      />,
    );

    expect(await screen.findByText("Power Delivery Board")).toBeInTheDocument();
    expect(
      screen.getByText(/Board and completed statuses are inherited.*Done/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Board" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save mapping" }),
    ).not.toBeInTheDocument();
    expect(getBoards).not.toHaveBeenCalled();
  });
});
