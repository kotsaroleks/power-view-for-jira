import { describe, expect, it, vi } from "vitest";

import { createProgressThrottle } from "./progress-throttle";
import type { ReportGenerationProgress } from "./reporting-generator";

function progress(
  loaded: number,
  stage: ReportGenerationProgress["stage"] = "changes",
): ReportGenerationProgress {
  return { stage, loaded };
}

describe("createProgressThrottle", () => {
  it("coalesces a burst within the throttle window to a bounded number of emits", () => {
    vi.useFakeTimers();
    try {
      const emit = vi.fn();
      const { onProgress } = createProgressThrottle(emit);

      for (let i = 1; i <= 5_000; i += 1) {
        onProgress(progress(i));
      }

      // The first call in a window always flushes immediately (window starts empty), so a
      // burst produces one emit plus whatever trailing timers fired during the loop — far
      // fewer than 5,000.
      expect(emit.mock.calls.length).toBeLessThan(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it("always emits the final update in a burst, not a stale intermediate one", () => {
    vi.useFakeTimers();
    try {
      const emit = vi.fn();
      const { onProgress } = createProgressThrottle(emit);

      for (let i = 1; i <= 100; i += 1) {
        onProgress(progress(i));
      }
      vi.runAllTimers();

      expect(emit).toHaveBeenLastCalledWith(progress(100));
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes a stage change immediately, un-throttled", () => {
    vi.useFakeTimers();
    try {
      const emit = vi.fn();
      const { onProgress } = createProgressThrottle(emit);

      onProgress(progress(1, "changes"));
      emit.mockClear();
      onProgress(progress(1, "worklogs"));

      expect(emit).toHaveBeenCalledWith(progress(1, "worklogs"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel drops any pending trailing emit", () => {
    vi.useFakeTimers();
    try {
      const emit = vi.fn();
      const { onProgress, cancel } = createProgressThrottle(emit);

      onProgress(progress(1));
      emit.mockClear();
      onProgress(progress(2));
      cancel();
      vi.runAllTimers();

      expect(emit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
