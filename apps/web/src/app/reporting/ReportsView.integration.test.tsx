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
  it("explains a missing status mapping without presenting an operation as busy", async () => {
    render(
      <ReportsView
        client={{} as JiraClient}
        baseUrl="https://example.atlassian.net"
        deploymentType="cloud"
        board={board}
        issues={[]}
        jql="filter = 9001 ORDER BY Rank ASC"
        statusMapping={{
          ...statusMapping,
          completedStatusIds: [],
          completedStatusNames: [],
        }}
        historyStore={new MemoryReportHistoryStore()}
      />,
    );

    const button = await screen.findByRole("button", { name: "Generate report" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "Configure at least one completed status in Workspace Settings.",
    );
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(button).not.toHaveClass("is-loading");
  });

  it("uses workspace issues without loading Jira when Reports opens", async () => {
    const getBoards = vi.fn();
    const getBoardIssues = vi.fn().mockResolvedValue({
      values: [],
      startAt: 0,
      maxResults: 100,
      total: 0,
      isLast: true,
    });
    const getBoardSprints = vi.fn().mockResolvedValue({
      values: [],
      startAt: 0,
      maxResults: 50,
      total: 0,
      isLast: true,
    });
    const client = {
      getBoards,
      getBoardIssues,
      getBoardSprints,
    } as unknown as JiraClient;

    render(
      <ReportsView
        client={client}
        baseUrl="https://example.atlassian.net"
        deploymentType="cloud"
        board={board}
        issues={[
          {
            id: "100",
            key: "POWER-1",
            browseUrl: "https://example.atlassian.net/browse/POWER-1",
            summary: "Release task",
            issueType: { id: "1", name: "Task", subtask: false },
            status: { id: "2", name: "In Progress" },
            assignee: { accountId: "alex", displayName: "Alex Rivera" },
            project: { id: "10000", key: "POWER", name: "Power View" },
            sprints: [{ id: "101", name: "Sprint 101", state: "active" }],
            labels: [],
            components: [],
            fixVersions: [],
            issueLinks: [],
            rawFieldPresence: {
              hasStartDate: false,
              hasDueDate: false,
              hasParent: false,
              hasEpic: false,
            },
          },
        ]}
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
    expect(getBoardIssues).not.toHaveBeenCalled();
    expect(getBoardSprints).not.toHaveBeenCalled();
  });
});
