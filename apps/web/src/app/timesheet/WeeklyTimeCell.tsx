import { WorklogDetailsButton } from "./WorklogDetailsButton";
import { useEffect, useRef, useState } from "react";
import {
  UnknownWorklogOutcomeError,
  WorklogIdentityError,
  worklogVersion,
  type TimesheetApi,
  type TimesheetIssue,
  type TimesheetWorklog,
} from "@power-view/jira-client";
import { dayInZone, duration, localTimeChoices, parseDuration } from "./timesheet-model";
type PendingWrite = { draft: string; message: string; savedId?: string };
// Keep unresolved writes across refresh-driven cell remounts, scoped to this API session.
const pendingWrites = new WeakMap<TimesheetApi, Map<string, PendingWrite>>();
export function WeeklyTimeCell({
  api,
  issue,
  day,
  zone,
  accountId,
  logs,
  disabled,
  onSaved,
  beforeSave,
  onDetails,
  onIdentityError,
  onActivity,
  onReload,
}: {
  api: TimesheetApi;
  issue: TimesheetIssue;
  day: string;
  zone: string;
  accountId: string;
  logs: TimesheetWorklog[];
  disabled: boolean;
  beforeSave?: () => Promise<void>;
  onSaved: (issue: TimesheetIssue, log: TimesheetWorklog) => Promise<void>;
  onDetails: (trigger: HTMLButtonElement | HTMLInputElement) => void;
  onIdentityError: () => void;
  onActivity: (key: string, active: boolean) => void;
  onReload: () => void;
}) {
  const original = logs[0];
  const initial = original
    ? String(Math.round(original.timeSpentSeconds / 36) / 100)
    : "";
  const pendingKey = JSON.stringify([accountId, issue.id, day, zone]);
  let session = pendingWrites.get(api);
  if (!session) {
    session = new Map();
    pendingWrites.set(api, session);
  }
  const writes = session;
  const pending = writes.get(pendingKey);
  // A confirmed write can be reconciled by its ID. An absent first reread never
  // resolves an unknown result.
  if (pending?.savedId && logs.some((log) => log.id === pending.savedId))
    writes.delete(pendingKey);
  const unresolved = writes.get(pendingKey);
  const [text, setText] = useState(unresolved?.draft ?? initial);
  const [error, setError] = useState(unresolved?.message ?? "");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(Boolean(unresolved));
  const busyRef = useRef(false);
  const cellKey = `${issue.id}:${day}`;
  const dirty = text !== initial;
  useEffect(() => {
    onActivity(cellKey, dirty || busy || uncertain);
    return () => onActivity(cellKey, false);
  }, [cellKey, dirty, busy, uncertain, onActivity]);
  const save = async () => {
    if (busyRef.current || disabled || uncertain || writes.has(pendingKey) || !dirty)
      return;
    if (!text.trim()) {
      setText(initial);
      setError("");
      return;
    }
    const numeric = /^\d+(?:[.,]\d+)?$/.test(text.trim())
      ? Number(text.trim().replace(",", "."))
      : undefined;
    const seconds =
      numeric === undefined ? parseDuration(text) : Math.round(numeric * 3600);
    if (!seconds || seconds < 1 || seconds > 2_147_483_647) {
      setError("Enter hours, e.g. 1.5 or 1:30. Use details to delete time.");
      return;
    }
    if (original && Math.abs(seconds - original.timeSpentSeconds) < 1) {
      setText(initial);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if ((await api.getUser()).accountId !== accountId)
        throw new WorklogIdentityError(
          "The Jira account changed. Reconnect in Settings.",
        );
      const current = (await api.getWorklogs(issue)).filter(
        (log) => log.authorId === accountId && dayInZone(log.started, zone) === day,
      );
      if (
        current.length !== logs.length ||
        (original &&
          (!current[0] || worklogVersion(current[0]) !== worklogVersion(original)))
      )
        throw new Error("This cell changed in Jira. Refresh before editing it.");
      await beforeSave?.();
      const choices = localTimeChoices(day, "09:00", zone);
      if (!original && choices.length !== 1)
        throw new Error("This date needs an explicit start time. Use detailed logging.");
      const saved = await api.saveWorklog(
        issue,
        {
          started: original?.started ?? choices[0]!,
          timeSpentSeconds: seconds,
          ...(original?.comment === undefined ? {} : { comment: original.comment }),
        },
        accountId,
        original,
      );
      const message = "Saved in Jira. Refresh if the table cannot be updated.";
      writes.set(pendingKey, { draft: text, message, savedId: saved.id });
      setUncertain(true);
      setError(message);
      await onSaved(issue, saved);
    } catch (reason) {
      if (reason instanceof WorklogIdentityError) onIdentityError();
      if (reason instanceof UnknownWorklogOutcomeError) {
        writes.set(pendingKey, { draft: text, message: reason.message });
        setUncertain(true);
      }
      setError(
        reason instanceof Error ? reason.message : "Jira could not save these hours.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="weekly-time-cell">
      <input
        aria-label={`${issue.key}, ${day}, hours`}
        inputMode="decimal"
        value={text}
        placeholder="—"
        disabled={disabled || busy || uncertain}
        onChange={(event) => {
          setText(event.target.value);
          setError("");
        }}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.altKey && event.key === "ArrowDown" && original) {
            event.preventDefault();
            onDetails(event.currentTarget);
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setText(initial);
            setError("");
          }
        }}
      />
      {original ? (
        <WorklogDetailsButton
          label={`${issue.key}, ${day}, ${duration(original.timeSpentSeconds)}, 1 worklogs`}
          onOpen={onDetails}
        />
      ) : null}
      {busy ? <span role="status">Saving…</span> : null}
      {error ? (
        <span role="status" className="weekly-cell-error">
          {error}{" "}
          <button type="button" disabled={busy} onClick={onReload}>
            Refresh records
          </button>
          {uncertain && !writes.get(pendingKey)?.savedId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                writes.delete(pendingKey);
                setUncertain(false);
                setError("");
              }}
            >
              I checked Jira; allow another attempt
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
