import type { GanttScheduleModel, NormalizedIssue } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BoardHealthReportView } from "./BoardHealthReport";

const sprint = { id: "101", name: "Sprint 8.1", state: "active" as const };

function makeIssue(
  key: string,
  category: "done" | "in-progress" | "to-do",
  options: Partial<NormalizedIssue> = {},
): NormalizedIssue {
  return {
    id: key,
    key,
    browseUrl: `https://jira.example.test/browse/${key}`,
    summary: key,
    issueType: { id: "task", name: "Task", subtask: false },
    status: { name: category, category },
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
    ...options,
  };
}

const emptyModel: GanttScheduleModel = {
  roots: [],
  tasks: [],
  warnings: [],
  syntheticDateCount: 0,
  dependencyCount: 0,
};

describe("BoardHealthReportView", () => {
  it("renders board health and current-sprint sections from the same issue scope", () => {
    render(
      <BoardHealthReportView
        issues={[
          makeIssue("POWER-1", "done", {
            assignee: { accountId: "alex", displayName: "Alex" },
            sprints: [sprint],
          }),
          makeIssue("POWER-2", "in-progress", { sprints: [sprint] }),
          makeIssue("POWER-3", "to-do", {
            sprints: [{ id: "102", name: "Future", state: "future" }],
          }),
        ]}
        model={emptyModel}
        projectKey="POWER"
        projectName="Power View"
        jql={'project = "POWER"'}
        loadedAt="2026-08-03T10:00:00.000Z"
        truncated={false}
        sprintDataAvailable
        storyPointsDataAvailable={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Power View" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sprint 8.1" })).toBeInTheDocument();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Planning coverage")).toBeInTheDocument();
    expect(screen.getByText("Current sprint")).toBeInTheDocument();
  });

  it("explains unavailable sprint data instead of showing zeroes", () => {
    render(
      <BoardHealthReportView
        issues={[makeIssue("POWER-1", "to-do")]}
        model={emptyModel}
        projectKey="POWER"
        projectName="Power View"
        jql={'project = "POWER"'}
        loadedAt="2026-08-03T10:00:00.000Z"
        truncated={false}
        sprintDataAvailable={false}
        storyPointsDataAvailable={false}
      />,
    );

    expect(screen.getAllByText(/Sprint data unavailable/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Current-sprint data is unavailable/)).toBeInTheDocument();
  });

  it("expands a person row to show that person's sprint issues", () => {
    render(
      <BoardHealthReportView
        issues={[
          makeIssue("POWER-1", "done", {
            summary: "Ship the report",
            assignee: { accountId: "alex", displayName: "Alex" },
            sprints: [sprint],
          }),
        ]}
        model={emptyModel}
        projectKey="POWER"
        projectName="Power View"
        jql={'project = "POWER"'}
        loadedAt="2026-08-03T10:00:00.000Z"
        truncated={false}
        sprintDataAvailable
        storyPointsDataAvailable={false}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Alex" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Ship the report")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /POWER-1 Ship the report/ })).toHaveAttribute(
      "href",
      "https://jira.example.test/browse/POWER-1",
    );

    const doneStatus = screen.getByRole("button", { name: /Done/ });
    expect(doneStatus).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(doneStatus);
    expect(doneStatus).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("link", { name: /POWER-1 Ship the report/ })).toHaveLength(
      2,
    );
  });

  it("uses the sprint-scoped Jira issue response for the team breakdown", async () => {
    const client = {
      getSprintIssues: vi.fn().mockResolvedValue({
        values: [{ id: "POWER-1" }],
        isLast: true,
      }),
    } as unknown as JiraClient;

    render(
      <BoardHealthReportView
        client={client}
        boardId="7"
        issues={[
          makeIssue("POWER-1", "done", {
            assignee: { accountId: "alex", displayName: "Alex" },
            sprints: [sprint],
          }),
          makeIssue("POWER-2", "done", {
            assignee: { accountId: "eboni", displayName: "Eboni Obanero" },
            sprints: [sprint],
          }),
        ]}
        model={emptyModel}
        projectKey="POWER"
        projectName="Power View"
        jql={'project = "POWER"'}
        loadedAt="2026-08-03T10:00:00.000Z"
        truncated={false}
        sprintDataAvailable
        storyPointsDataAvailable={false}
        preferredSprintId={sprint.id}
      />,
    );

    await waitFor(() =>
      expect(client.getSprintIssues).toHaveBeenCalledWith(
        expect.objectContaining({ boardId: "7", sprintId: "101" }),
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() => {
      expect(screen.getByText("Alex")).toBeInTheDocument();
      expect(screen.queryByText("Eboni Obanero")).not.toBeInTheDocument();
    });
  });
});
