import type { NormalizedIssue } from "@power-view/domain";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BoardStatusReport } from "./BoardStatusReport";
import { buildStatusDistribution } from "./status-distribution";

function makeIssue(key: string, statusId: string, statusName: string): NormalizedIssue {
  return {
    id: key,
    key,
    browseUrl: `https://jira.example.test/browse/${key}`,
    summary: key,
    issueType: { id: "task", name: "Task", subtask: false },
    status: { id: statusId, name: statusName },
    project: { id: "1", key: "POWER", name: "Power View" },
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
  };
}

describe("BoardStatusReport", () => {
  const issues = [
    makeIssue("POWER-1", "1", "Backlog"),
    makeIssue("POWER-2", "1", "Backlog"),
    makeIssue("POWER-3", "3", "In Progress"),
    makeIssue("POWER-4", "5", "Done"),
  ];

  it("groups every raw Jira status and orders the largest first", () => {
    expect(buildStatusDistribution(issues)).toMatchObject([
      { key: "1", label: "Backlog", count: 2, percentage: 50 },
      { key: "5", label: "Done", count: 1, percentage: 25 },
      { key: "3", label: "In Progress", count: 1, percentage: 25 },
    ]);
  });

  it("renders an accessible pie chart and complete status legend", () => {
    render(
      <BoardStatusReport
        boardId="7"
        boardName="Power Delivery Board"
        issues={issues}
        loadedAt="2026-09-08T10:00:00.000Z"
        truncated={false}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: /Power Delivery Board: Backlog 2, 50%; Done 1, 25%; In Progress 1, 25%/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("4", { selector: ".status-chart-total strong" }),
    ).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("Backlog")).toBeInTheDocument();
    expect(within(items[0]!).getByText("2 issues")).toBeInTheDocument();
    expect(within(items[0]!).getByText("50%")).toBeInTheDocument();
  });

  it("shows an empty state when the selected board has no issues", () => {
    render(
      <BoardStatusReport
        boardId="7"
        boardName="Empty Board"
        issues={[]}
        loadedAt="2026-09-08T10:00:00.000Z"
        truncated={false}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No issues to chart" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
