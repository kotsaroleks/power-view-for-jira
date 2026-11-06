import { useEffect, useMemo, useState } from "react";
import type { TimesheetApi, TimesheetIssue } from "@power-view/jira-client";

const emptyIssues: TimesheetIssue[] = [];

// Personal presentation preferences only; Jira issue priority is never changed.
export function usePriorityIssues(
  api: TimesheetApi,
  baseUrl: string,
  accountId: string,
  boardIssues: TimesheetIssue[],
) {
  const storageKey = `power-view:weekly-priority:v1:${baseUrl.replace(/\/$/, "")}:${accountId}`;
  const keys = useMemo(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (Array.isArray(stored))
        return [
          ...new Set(
            stored.filter(
              (key): key is string =>
                typeof key === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(key),
            ),
          ),
        ];
    } catch {
      /* Use the requested initial preference if storage is unavailable. */
    }
    return new URL(baseUrl).hostname === "stryker-emergencycare.atlassian.net"
      ? ["LBR-68393"]
      : [];
  }, [storageKey, baseUrl]);
  const [result, setResult] = useState<{
    key: string;
    issues: TimesheetIssue[];
    error: string;
  }>();
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(keys));
    } catch {
      /* Optional preference storage. */
    }
    const controller = new AbortController();
    void (async () => {
      const issues: TimesheetIssue[] = [];
      const failures: string[] = [];
      for (const key of keys) {
        const existing = boardIssues.find((issue) => issue.key === key);
        if (existing) {
          issues.push(existing);
          continue;
        }
        try {
          const issue = await api.getIssue(key, controller.signal);
          if (issue.key !== key) throw new Error("Unexpected priority issue");
          issues.push(issue);
        } catch {
          if (!controller.signal.aborted) failures.push(key);
        }
      }
      if (!controller.signal.aborted)
        setResult({
          key: storageKey,
          issues,
          error: failures.length
            ? `Priority issues could not be loaded: ${failures.join(", ")}.`
            : "",
        });
    })();
    return () => controller.abort();
  }, [api, storageKey, keys, boardIssues]);
  return {
    keys,
    issues: result?.key === storageKey ? result.issues : emptyIssues,
    error: result?.key === storageKey ? result.error : "",
  };
}
