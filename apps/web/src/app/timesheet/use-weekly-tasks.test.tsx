import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { TimesheetIssue } from "@power-view/jira-client";
import { testApi, testIssue } from "./test-fixtures";
import { useWeeklyTasks } from "./use-weekly-tasks";

const preferenceKey = "power-view:weekly-tasks:v1:https://jira.test:me";
const external: TimesheetIssue = {
  ...testIssue,
  id: "42",
  key: "OUT-42",
  summary: "Pinned outside the saved filter",
};
function seedPins() {
  localStorage.setItem(
    preferenceKey,
    JSON.stringify({ boardId: 1, pins: { "1": [external.key] } }),
  );
}

describe("External weekly pins", () => {
  beforeEach(() => localStorage.clear());

  it("retains an external pin when the week changes and restores it after remount", async () => {
    seedPins();
    const api = testApi();
    api.getIssue.mockResolvedValue(external);
    const view = renderHook(
      ({ week }) => {
        void week;
        return useWeeklyTasks(api, "https://jira.test", "me");
      },
      { initialProps: { week: "2026-11-02" } },
    );
    await waitFor(() => expect(view.result.current.selected).toContainEqual(external));
    expect(view.result.current.issues.map((issue) => issue.key)).not.toContain(
      external.key,
    );
    expect(view.result.current.unavailablePins).toEqual([]);
    view.rerender({ week: "2026-11-09" });
    expect(view.result.current.selected).toContainEqual(external);
    expect(api.getWorklogs).not.toHaveBeenCalled();
    view.unmount();

    const reopened = renderHook(() => useWeeklyTasks(api, "https://jira.test", "me"));
    await waitFor(() =>
      expect(reopened.result.current.selected).toContainEqual(external),
    );
    expect(reopened.result.current.pins).toContain(external.key);
    expect(api.getIssue).toHaveBeenCalledWith(external.key, expect.any(AbortSignal));
    expect(reopened.result.current.unavailablePins).toEqual([]);
  });

  it("reports an unavailable pin only after its direct issue read actually fails", async () => {
    seedPins();
    const api = testApi();
    let rejectRead!: (error: Error) => void;
    api.getIssue.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    const { result } = renderHook(() => useWeeklyTasks(api, "https://jira.test", "me"));
    await waitFor(() => expect(api.getIssue).toHaveBeenCalledOnce());
    expect(result.current.unavailablePins).toEqual([]);
    await act(async () => {
      rejectRead(new Error("Issue access denied"));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.unavailablePins).toEqual([external.key]));
    expect(result.current.pins).toContain(external.key);
    expect(result.current.selected.map((issue) => issue.key)).not.toContain(external.key);
    act(() => result.current.togglePin(external.key));
    expect(result.current.unavailablePins).toEqual([]);
    expect(result.current.pins).not.toContain(external.key);
  });

  it("does not directly reread pins that are already in the board filter", async () => {
    localStorage.setItem(
      preferenceKey,
      JSON.stringify({ boardId: 1, pins: { "1": [testIssue.key] } }),
    );
    const api = testApi();
    const { result } = renderHook(() => useWeeklyTasks(api, "https://jira.test", "me"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selected.map((issue) => issue.key)).toContain(testIssue.key);
    expect(api.getIssue).not.toHaveBeenCalled();
    expect(result.current.unavailablePins).toEqual([]);
  });
});
