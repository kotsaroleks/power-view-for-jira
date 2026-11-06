import { WorklogIssuePicker } from "./WorklogIssuePicker";
import { useEffect, useRef, useState } from "react";
import {
  plainTextComment,
  UnknownWorklogOutcomeError,
  WorklogIdentityError,
  type TimesheetApi,
  type TimesheetIssue,
  type TimesheetWorklog,
} from "@power-view/jira-client";
import {
  dayInZone,
  duration,
  localClock,
  localTimeChoices,
  parseDuration,
} from "./timesheet-model";

export interface WorklogFormProps {
  api: TimesheetApi;
  baseUrl: string;
  accountId: string;
  timeZone: string;
  initialDay: string;
  issue?: TimesheetIssue;
  original?: TimesheetWorklog;
  deleting?: boolean;
  beforeSave?: (day: string) => Promise<void>;
  onClose: () => void;
  onIdentityError?: () => void;
  onSaved: (issue: TimesheetIssue, log?: TimesheetWorklog) => Promise<void>;
  onGuardChange?: (guard: (() => boolean) | undefined) => void;
}
export function WorklogForm(props: WorklogFormProps) {
  const {
    api,
    accountId,
    timeZone,
    original,
    deleting,
    onClose,
    onSaved,
    onGuardChange,
  } = props;
  const [issue, setIssue] = useState(props.issue);
  const initialDay = original ? dayInZone(original.started, timeZone) : props.initialDay;
  const initialClock = original ? localClock(original.started, timeZone) : "09:00";
  const initialDuration = original
    ? duration(original.timeSpentSeconds - (original.timeSpentSeconds % 60))
    : "";
  const [day, setDay] = useState(initialDay);
  const [clock, setClock] = useState(initialClock);
  const [amount, setAmount] = useState(initialDuration);
  const [comment, setComment] = useState(original?.commentText ?? "");
  const [offset, setOffset] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [unknown, setUnknown] = useState(false);
  const [verifiedRetry, setVerifiedRetry] = useState(false);
  const [reconciliation, setReconciliation] = useState<TimesheetWorklog[]>();
  const panel = useRef<HTMLElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const title = deleting ? "Delete worklog" : original ? "Edit worklog" : "Log time";
  const dirty = Boolean(
    original
      ? day !== initialDay ||
          clock !== initialClock ||
          amount !== initialDuration ||
          comment !== original.commentText ||
          offset
      : issue || amount || comment,
  );
  const guard = () =>
    !busyRef.current && (!dirty || window.confirm("Discard the unsaved worklog form?"));
  const close = () => {
    if (guard()) onClose();
  };
  useEffect(() => {
    priorFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current;
    const firstField =
      element?.querySelector<HTMLElement>("input, textarea") ??
      element?.querySelector<HTMLElement>("button");
    (firstField ?? element)?.focus();
    return () => {
      priorFocus.current?.focus();
    };
  }, []);
  useEffect(() => {
    onGuardChange?.(guard);
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => {
      onGuardChange?.(undefined);
      window.removeEventListener("beforeunload", preventLoss);
    };
  });
  let choices: string[] = [];
  try {
    choices = localTimeChoices(day, clock, timeZone);
  } catch {
    /* Invalid zone is shown as a form validation error. */
  }
  const originalChoice = original
    ? choices.find(
        (value) => Math.abs(Date.parse(value) - Date.parse(original.started)) < 60_000,
      )
    : undefined;
  const instant =
    choices.length === 1
      ? choices[0]
      : choices.includes(offset)
        ? offset
        : originalChoice;
  const submit = async () => {
    if (busyRef.current || (unknown && !verifiedRetry)) return;
    if (!issue) {
      setError("Choose a Jira issue.");
      return;
    }
    const seconds =
      original && amount === initialDuration
        ? original.timeSpentSeconds
        : parseDuration(amount);
    if (!deleting && (!seconds || !instant)) {
      setError(
        !seconds
          ? "Enter a positive duration such as 1h 30m, 90m, or 1:30."
          : choices.length
            ? "Choose which UTC offset to use for this repeated local time."
            : "This date and local time do not exist in the selected time zone.",
      );
      return;
    }
    if (
      comment.split("\n").length > 2000 ||
      JSON.stringify(plainTextComment(comment)).length > 32000
    ) {
      setError("The description is too large. Use fewer lines or a shorter description.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      let saved: TimesheetWorklog | undefined;
      if (!deleting) await props.beforeSave?.(day);
      if (deleting && original) await api.deleteWorklog(issue, original, accountId);
      else {
        const started =
          original &&
          day === initialDay &&
          clock === initialClock &&
          (!offset || instant === originalChoice)
            ? original.started
            : instant!;
        saved = await api.saveWorklog(
          issue,
          {
            started,
            timeSpentSeconds: seconds!,
            ...((original ? comment !== original.commentText : Boolean(comment))
              ? { comment: plainTextComment(comment) }
              : {}),
          },
          accountId,
          original,
        );
      }
      // Save is confirmed even when the subsequent table refresh fails.
      await onSaved(issue, saved);
      onClose();
    } catch (reason) {
      if (reason instanceof WorklogIdentityError) {
        props.onIdentityError?.();
        return;
      }
      setError(
        reason instanceof Error
          ? reason.message
          : "Jira could not complete the operation. Your input is retained.",
      );
      if (reason instanceof UnknownWorklogOutcomeError) {
        setUnknown(true);
        setVerifiedRetry(false);
        try {
          setReconciliation(
            (await api.getWorklogs(issue)).filter((log) => log.authorId === accountId),
          );
        } catch {
          setError(
            "The operation result is unknown and Jira could not be reread. Check the issue in Jira before another attempt.",
          );
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      ref={panel}
      role="region"
      className="worklog-inline-panel"
      aria-labelledby="worklog-form-title"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header>
          <h2 id="worklog-form-title">{title}</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={close}
            disabled={busy}
            aria-label="Close worklog form"
          >
            ×
          </button>
        </header>
        <fieldset disabled={busy}>
          {issue ? (
            <p className="worklog-selected">
              <strong>{issue.key}</strong> {issue.summary}
              {!original && !props.issue ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setIssue(undefined)}
                >
                  Change issue
                </button>
              ) : null}
            </p>
          ) : (
            <WorklogIssuePicker
              api={api}
              baseUrl={props.baseUrl}
              accountId={accountId}
              onSelect={(selected) => {
                setIssue(selected);
                setError("");
              }}
            />
          )}
          {deleting && original ? (
            <p>
              Delete this specific record:{" "}
              {new Date(original.started).toLocaleString("en-GB", { timeZone })} ·{" "}
              <strong>{duration(original.timeSpentSeconds)}</strong> · ID {original.id}?
            </p>
          ) : (
            <>
              <div className="worklog-fields">
                <label>
                  Date
                  <input
                    type="date"
                    required
                    value={day}
                    onChange={(event) => {
                      setDay(event.target.value);
                      setOffset("");
                    }}
                  />
                </label>
                <label>
                  Start time
                  <input
                    type="time"
                    required
                    value={clock}
                    onChange={(event) => {
                      setClock(event.target.value);
                      setOffset("");
                    }}
                  />
                </label>
                <label>
                  Duration
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="1h 30m"
                    required
                  />
                </label>
              </div>
              <p className="timesheet-muted">
                {timeZone} · The full duration belongs to the start day.
              </p>
              {choices.length > 1 ? (
                <label>
                  Repeated time — choose UTC instant
                  <select
                    value={instant ?? ""}
                    onChange={(event) => setOffset(event.target.value)}
                  >
                    <option value="">Choose an offset</option>
                    {choices.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {original && original.timeSpentSeconds % 60 > 0 ? (
                <p>
                  Original duration: {duration(original.timeSpentSeconds)}. Seconds are
                  preserved while Duration is unchanged.
                </p>
              ) : null}
              <label>
                Work description (optional)
                <textarea
                  value={comment}
                  maxLength={10000}
                  rows={3}
                  onChange={(event) => setComment(event.target.value)}
                />
              </label>
              {original ? (
                <p className="timesheet-muted">
                  Existing description formatting is retained unless you edit the
                  description. Edited descriptions are saved as plain text.
                </p>
              ) : null}
            </>
          )}
          <p className="timesheet-muted">
            Remaining estimate is unchanged. A record outside the current period or
            filters may be hidden; use “Show record” after saving.
          </p>
          {error ? (
            <p role="alert" className="timesheet-alert">
              {error}
            </p>
          ) : null}
          {unknown && issue ? (
            <div className="timesheet-alert">
              <a
                href={`${props.baseUrl}/browse/${issue.key}`}
                target="_blank"
                rel="noreferrer"
              >
                Check {issue.key} in Jira
              </a>
              {reconciliation ? (
                <>
                  <p>
                    Available own records after rereading (not proof that the request
                    failed):
                  </p>
                  <ul>
                    {reconciliation.map((log) => (
                      <li key={log.id}>
                        {log.id} · {log.started} · {duration(log.timeSpentSeconds)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <label>
                <input
                  type="checkbox"
                  checked={verifiedRetry}
                  onChange={(event) => setVerifiedRetry(event.target.checked)}
                />
                I checked Jira and want to allow another attempt
              </label>
            </div>
          ) : null}
        </fieldset>
        <footer>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={deleting ? "secondary-button" : "primary-button"}
            disabled={busy || (unknown && !verifiedRetry)}
          >
            {busy ? "Saving…" : deleting ? "Confirm deletion" : "Save worklog"}
          </button>
        </footer>
      </form>
    </section>
  );
}
