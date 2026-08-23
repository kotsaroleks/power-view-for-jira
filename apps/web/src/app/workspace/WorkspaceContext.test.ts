import type { GanttScheduleModel, NormalizedIssue } from "@power-view/domain";
import { describe, expect, it } from "vitest";

import { createWorkspaceContext } from "./WorkspaceContext";

const model: GanttScheduleModel = {
  tasks: [],
  roots: [],
  warnings: [],
  syntheticDateCount: 0,
  dependencyCount: 0,
};

describe("WorkspaceContext contract", () => {
  it("pins downstream services to the selected board instead of project-wide scope", () => {
    const workspace = createWorkspaceContext({
      jiraBaseUrl: "https://example.atlassian.net",
      projectKey: "POWER",
      projectName: "Power View",
      board: {
        id: "7",
        name: "Delivery board",
        type: "scrum",
        projectKeys: ["POWER"],
      },
      issues: [] as NormalizedIssue[],
      model,
      queryKey: "https://example.atlassian.net\nPOWER\nboard:7",
      jql: "filter = 7",
      nonWorkingDays: [0, 6],
      loadedAt: "2026-08-20T12:00:00.000Z",
      truncated: false,
      editing: {
        client: {} as never,
        fieldMapping: {},
        refresh: async () => undefined,
      },
      reporting: { completedStatusIds: [], completedStatusNames: [] },
      sprintDataAvailable: false,
      storyPointsDataAvailable: false,
    });

    expect(workspace.scope).toEqual({ kind: "board", boardId: "7" });
    expect(workspace.projectKey).toBe("POWER");
    expect(workspace).not.toHaveProperty("settingsStore");
    expect(workspace).not.toHaveProperty("setBoard");
  });

  it("keeps board-owned data immutable for Reports and Gantt consumers", () => {
    const workspace = createWorkspaceContext({
      jiraBaseUrl: "https://example.atlassian.net",
      projectKey: "POWER",
      projectName: "Power View",
      board: {
        id: "7",
        name: "Delivery board",
        type: "scrum",
        projectKeys: ["POWER"],
      },
      issues: [] as NormalizedIssue[],
      model,
      queryKey: "https://example.atlassian.net\nPOWER\nboard:7",
      jql: "filter = 7",
      nonWorkingDays: [0, 6],
      loadedAt: "2026-08-20T12:00:00.000Z",
      truncated: false,
      editing: {
        client: {} as never,
        fieldMapping: {},
        refresh: async () => undefined,
      },
      reporting: { completedStatusIds: [], completedStatusNames: [] },
      sprintDataAvailable: false,
      storyPointsDataAvailable: false,
    });

    expect(Object.isFrozen(workspace)).toBe(true);
    expect(Object.isFrozen(workspace.board)).toBe(true);
    expect(Object.isFrozen(workspace.scope)).toBe(true);
  });
});
