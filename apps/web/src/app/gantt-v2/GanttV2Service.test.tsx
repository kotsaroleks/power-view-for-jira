import { DEFAULT_GANTT_FILTERS, type GanttScheduleModel } from "@power-view/domain";
import type { SettingsStore } from "@power-view/storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceContext } from "../workspace/WorkspaceContext";
import { GanttV2Service } from "./GanttV2Service";

const model: GanttScheduleModel = {
  roots: [],
  tasks: [
    {
      id: "1",
      issueKey: "POWER-1",
      browseUrl: "https://example.atlassian.net/browse/POWER-1",
      name: "Ship release",
      start: "2026-08-17",
      end: "2026-08-21",
      progress: 0,
      progressSource: "status",
      depth: 0,
      expanded: true,
      statusName: "To Do",
      statusCategory: "to-do",
      issueTypeName: "Task",
      scheduleState: "confirmed",
      isSyntheticDate: false,
      startSource: "jira",
      endSource: "jira",
      originalEstimateDays: 5,
      nonWorkingDays: 0,
      calendarDaysEstimate: 5,
      dependencies: [],
    },
  ],
  warnings: [],
  syntheticDateCount: 0,
  dependencyCount: 0,
};

function workspace(): WorkspaceContext {
  return {
    scope: { kind: "board", boardId: "7" },
    model,
    nonWorkingDays: [0, 6],
    issues: [],
    queryKey: "POWER:7:loaded",
    jiraBaseUrl: "https://example.atlassian.net",
    projectKey: "POWER",
    projectName: "Power View",
    board: { id: "7", name: "Delivery", type: "scrum", projectKeys: ["POWER"] },
    reporting: { completedStatusIds: [], completedStatusNames: [] },
    jql: 'project = "POWER"',
    loadedAt: "2026-08-22T10:00:00.000Z",
    truncated: false,
    sprintDataAvailable: false,
    storyPointsDataAvailable: false,
    editing: {
      client: { updateIssueDates: vi.fn() } as never,
      fieldMapping: {},
      refresh: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("GanttV2Service", () => {
  it("loads and saves view state only under the active board key", async () => {
    const saveGanttFilters = vi.fn().mockResolvedValue(undefined);
    const saveGanttViewPreferences = vi.fn().mockResolvedValue(undefined);
    const settingsStore = {
      getGanttBoardState: vi.fn().mockResolvedValue(undefined),
      getGanttFilters: vi.fn().mockResolvedValue({
        ...DEFAULT_GANTT_FILTERS,
        search: "ship",
        excludeDone: true,
      }),
      getGanttViewPreferences: vi.fn().mockResolvedValue({
        zoom: "month",
        sortBy: "name",
        sortDirection: "desc",
      }),
      saveGanttBoardState: vi.fn().mockResolvedValue(undefined),
      saveGanttFilters,
      saveGanttViewPreferences,
    } as unknown as SettingsStore;

    render(<GanttV2Service workspace={workspace()} settingsStore={settingsStore} />);

    await waitFor(() =>
      expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue("ship"),
    );
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), {
      target: { value: "release" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Day" }));

    await waitFor(() =>
      expect(saveGanttFilters).toHaveBeenCalledWith(
        "https://example.atlassian.net",
        "POWER:7",
        expect.objectContaining({ search: "release", excludeDone: true }),
      ),
    );
    expect(saveGanttViewPreferences).toHaveBeenCalledWith(
      "https://example.atlassian.net",
      "POWER:7",
      { zoom: "day", sortBy: "name", sortDirection: "desc" },
    );
  });
});
