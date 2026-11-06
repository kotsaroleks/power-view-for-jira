import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DayOffStore } from "./DayOffStore";
import { useSharedDayOff } from "./use-shared-day-off";

function calendar() {
  return {
    connect: vi.fn<DayOffStore["connect"]>().mockResolvedValue(undefined),
    set: vi.fn<DayOffStore["set"]>().mockResolvedValue(undefined),
    read: vi.fn<DayOffStore["read"]>().mockResolvedValue({
      complete: true,
      dayOffs: [{ userId: "me", date: "2026-11-02" }],
      warnings: [],
    }),
  };
}

describe("Shared Day Off freshness", () => {
  it("invalidates completeness after a rejected refresh while retaining known flags", async () => {
    const store = calendar();
    const { result } = renderHook(() =>
      useSharedDayOff(store, "https://jira.test", ["me"], ["2026-11-02"]),
    );
    await waitFor(() => expect(result.current.complete).toBe(true));
    store.read.mockRejectedValueOnce(new Error("Calendar unavailable"));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe("Calendar unavailable"));
    expect(result.current.complete).toBe(false);
    expect(result.current.dayOffs).toEqual([{ userId: "me", date: "2026-11-02" }]);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(result.current.error).toBe("");
  });

  it("does not show the old store's calendar after its configuration changes", async () => {
    const old = calendar();
    const next = calendar();
    next.read.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(
      ({ store }) => useSharedDayOff(store, "https://jira.test", ["me"], ["2026-11-02"]),
      { initialProps: { store: old } },
    );
    await waitFor(() => expect(result.current.complete).toBe(true));
    rerender({ store: next });
    expect(result.current.complete).toBe(false);
    expect(result.current.dayOffs).toEqual([]);
  });
});
