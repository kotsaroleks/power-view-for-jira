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
  function storage() {
    return {
      getGanttBoardState: vi.fn().mockResolvedValue(undefined),
      getGanttFilters: vi.fn().mockResolvedValue(undefined),
      getGanttViewPreferences: vi.fn().mockResolvedValue(undefined),
      saveGanttBoardState: vi.fn().mockResolvedValue(undefined),
      saveGanttFilters: vi.fn().mockResolvedValue(undefined),
      saveGanttViewPreferences: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("waits for saved dependencies before allowing edits", async () => {
    const store = storage();
    let finish!: (value: unknown) => void;
    store.getGanttBoardState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <GanttV2Service
        workspace={workspace()}
        settingsStore={store as unknown as SettingsStore}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading saved Gantt settings");
    expect(screen.queryByRole("searchbox")).toBeNull();
    finish(undefined);
    await screen.findByRole("searchbox", { name: "Search tasks" });
    expect(store.saveGanttBoardState).not.toHaveBeenCalled();
  });

  it("explains a settings read failure and retries without overwriting saved state", async () => {
    const store = storage();
    store.getGanttFilters.mockRejectedValueOnce(new Error("Storage unavailable"));
    render(
      <GanttV2Service
        workspace={workspace()}
        settingsStore={store as unknown as SettingsStore}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "preserve existing dependencies",
    );
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry settings" }));
    await screen.findByRole("searchbox", { name: "Search tasks" });
    expect(store.saveGanttFilters).not.toHaveBeenCalled();
  });

  it("retains a failed local change and retries storage without repeating Jira writes", async () => {
    const store = storage();
    store.saveGanttFilters.mockRejectedValueOnce(new Error("Storage full"));
    const current = workspace();
    const updateIssueDates = vi.spyOn(current.editing.client, "updateIssueDates");
    render(
      <GanttV2Service
        workspace={current}
        settingsStore={store as unknown as SettingsStore}
      />,
    );
    const search = await screen.findByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(search, { target: { value: "release" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(search).toHaveValue("release");
    fireEvent.click(screen.getByRole("button", { name: "Retry saving settings" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(store.saveGanttFilters).toHaveBeenLastCalledWith(
      current.jiraBaseUrl,
      "POWER:7",
      expect.objectContaining({ search: "release" }),
    );
    expect(updateIssueDates).not.toHaveBeenCalled();
  });

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
