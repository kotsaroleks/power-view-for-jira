import { useEffect, useMemo, useState } from "react";
import type {
  TimesheetApi,
  TimesheetIssue,
  WorklogBoard,
  WorklogPickerIssue,
} from "@power-view/jira-client";
const emptyIssues: TimesheetIssue[] = [];
const emptyPins: string[] = [];
type Preferences = { boardId: number; pins: Record<string, string[]> };
function read(key: string): Preferences {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      raw &&
      typeof raw === "object" &&
      "boardId" in raw &&
      Number.isSafeInteger(raw.boardId) &&
      "pins" in raw &&
      raw.pins &&
      typeof raw.pins === "object"
    ) {
      const pins: Record<string, string[]> = {};
      for (const [board, values] of Object.entries(raw.pins))
        if (Array.isArray(values))
          pins[board] = values.filter(
            (value: unknown): value is string =>
              typeof value === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(value),
          );
      return { boardId: Number(raw.boardId), pins };
    }
  } catch {
    /* Preferences are optional. */
  }
  let boardId = 0;
  try {
    const old = JSON.parse(
      localStorage.getItem(key.replace("weekly-tasks", "worklog-picker")) ?? "null",
    ) as { boardId?: number } | null;
    if (Number.isSafeInteger(old?.boardId) && Number(old?.boardId) > 0)
      boardId = Number(old?.boardId);
  } catch {
    /* Start without a board. */
  }
  return { boardId, pins: {} };
}
export function useWeeklyTasks(api: TimesheetApi, baseUrl: string, accountId: string) {
  const key = `power-view:weekly-tasks:v1:${baseUrl.replace(/\/$/, "")}:${accountId}`;
  const [prefs, setPrefs] = useState(() => read(key));
  const [boards, setBoards] = useState<WorklogBoard[]>([]);
  const [result, setResult] = useState<{
    boardId: number;
    issues: WorklogPickerIssue[];
  }>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const { boardId } = prefs;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResult(undefined);
    void (async () => {
      const available = await api.getWorklogBoards(controller.signal);
      if (controller.signal.aborted) return;
      setBoards(available);
      if (!boardId) return;
      if (!available.some((board) => board.id === boardId))
        throw new Error("The remembered board is unavailable. Select another board.");
      const issues = await api.getBoardPickerIssues(boardId, controller.signal);
      if (!controller.signal.aborted) setResult({ boardId, issues });
    })()
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : "Board tasks could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, boardId, retry]);
  const issues = useMemo(
    () => (result?.boardId === boardId ? result.issues : []),
    [result, boardId],
  );
  const pins = useMemo(() => prefs.pins[String(boardId)] ?? emptyPins, [prefs, boardId]);
  const pinRequestKey = JSON.stringify([boardId, pins]);
  const [externalPins, setExternalPins] = useState<{
    key: string;
    issues: TimesheetIssue[];
    unavailable: string[];
  }>();
  useEffect(() => {
    // Pins are scoped to the selected board, but the pinned issue may have moved
    // outside its saved filter. Read it directly instead of declaring it missing.
    if (!boardId || result?.boardId !== boardId) return;
    const controller = new AbortController();
    const missing = pins.filter((pin) => !issues.some((issue) => issue.key === pin));
    void (async () => {
      const loaded: TimesheetIssue[] = [];
      const unavailable: string[] = [];
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, missing.length) }, async () => {
          while (cursor < missing.length && !controller.signal.aborted) {
            const pin = missing[cursor++]!;
            try {
              loaded.push(await api.getIssue(pin, controller.signal));
            } catch {
              if (!controller.signal.aborted) unavailable.push(pin);
            }
          }
        }),
      );
      if (!controller.signal.aborted)
        setExternalPins({ key: pinRequestKey, issues: loaded, unavailable });
    })();
    return () => controller.abort();
  }, [api, boardId, issues, result, pins, pinRequestKey, retry]);
  const resolvedExternalPins =
    externalPins?.key === pinRequestKey ? externalPins.issues : emptyIssues;
  const unavailablePins =
    externalPins?.key === pinRequestKey ? externalPins.unavailable : emptyPins;
  const selected = useMemo(() => {
    const pinned = prefs.pins[String(boardId)] ?? [];
    const boardSelected = issues.filter(
      (issue) =>
        issue.assigneeId === accountId ||
        pinned.includes(issue.key) ||
        added.includes(issue.key),
    );
    return [...boardSelected, ...resolvedExternalPins];
  }, [issues, prefs, boardId, accountId, added, resolvedExternalPins]);
  const persist = (next: Preferences) => {
    setPrefs(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  return {
    expanded,
    toggleExpanded: (key: string) =>
      setExpanded((current) =>
        current.includes(key)
          ? current.filter((item) => item !== key)
          : [...current, key],
      ),
    boardId,
    boards,
    issues,
    selected,
    pins,
    unavailablePins,
    loading,
    error,
    storageError,
    changeBoard: (id: number) => {
      setAdded([]);
      setExpanded([]);
      persist({ ...prefs, boardId: id });
    },
    retry: () => setRetry((value) => value + 1),
    add: (issueKey: string) =>
      setAdded((current) =>
        current.includes(issueKey) ? current : [...current, issueKey],
      ),
    togglePin: (issueKey: string) =>
      persist({
        ...prefs,
        pins: {
          ...prefs.pins,
          [String(boardId)]: pins.includes(issueKey)
            ? pins.filter((item) => item !== issueKey)
            : [...pins, issueKey],
        },
      }),
  };
}
