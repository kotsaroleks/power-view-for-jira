import type { ReportGenerationProgress } from "./reporting-generator";

const PROGRESS_THROTTLE_MS = 100;

export interface ProgressThrottleHandle {
  onProgress: (progress: ReportGenerationProgress) => void;
  /** Drops any pending trailing emit — call on completion or unmount. */
  cancel: () => void;
}

/**
 * Coalesces onProgress bursts (up to one per issue on a 5,000-issue board) to at most one
 * emit per PROGRESS_THROTTLE_MS. A stage change always emits immediately and un-throttled,
 * so the label never lags a phase transition. A trailing timer guarantees the last update
 * inside a throttle window is still emitted, so the final count is never dropped.
 */
export function createProgressThrottle(
  emit: (progress: ReportGenerationProgress) => void,
): ProgressThrottleHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;
  let lastStage: ReportGenerationProgress["stage"] | undefined;
  let pending: ReportGenerationProgress | undefined;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = (progress: ReportGenerationProgress) => {
    clearTimer();
    pending = undefined;
    lastFlushAt = Date.now();
    emit(progress);
  };

  const onProgress = (progress: ReportGenerationProgress) => {
    const stageChanged = lastStage !== undefined && lastStage !== progress.stage;
    lastStage = progress.stage;
    if (stageChanged) {
      flush(progress);
      return;
    }
    pending = progress;
    const elapsed = Date.now() - lastFlushAt;
    if (elapsed >= PROGRESS_THROTTLE_MS) {
      flush(progress);
      return;
    }
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (pending) flush(pending);
      }, PROGRESS_THROTTLE_MS - elapsed);
    }
  };

  const cancel = () => {
    clearTimer();
    pending = undefined;
  };

  return { onProgress, cancel };
}
