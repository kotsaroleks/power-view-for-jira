import {
  JiraClientError,
  WorklogIdentityError,
  type TimesheetApi,
  type TimesheetIssue,
  type TimesheetWorklog,
} from "@power-view/jira-client";
import { dayInZone, searchAll, shiftDay } from "../timesheet/timesheet-model";

export interface TimeReportQuery {
  /** Explicit roster supplied by an approved team source; never inferred from issue assignees. */
  accountIds: string[];
  days: string[];
  timeZone: string;
  periodMode?: "week" | "month";
}

export interface TimeReportData {
  issues: TimesheetIssue[];
  worklogs: TimesheetWorklog[];
  state: "ready" | "partial";
  coverage: "jql-limited";
  coverageNotice: string;
  failedIssueIds: string[];
  reasons: string[];
  discoveryJql: string;
  loadedAt: string;
}

/**
 * Discover candidates by roster and a widened worklog-date envelope, then filter
 * individual logs by their exact author and local start day. Jira's worklog index
 * searches only the latest 1,000 worklogs per issue, so this does not claim full
 * historical coverage. Never silently fall back to scanning the whole Jira site.
 */
export async function loadTimeReport(
  api: TimesheetApi,
  query: TimeReportQuery,
  expectedViewerId: string,
  signal: AbortSignal,
  progress: (message: string) => void = () => {},
): Promise<TimeReportData> {
  signal.throwIfAborted();
  if (
    !expectedViewerId ||
    !query.accountIds.length ||
    query.accountIds.some((id) => !id || id.length > 255 || /\p{Cc}/u.test(id))
  )
    throw new Error("Select an explicit team roster before reading time.");
  const mode = query.periodMode ?? "week";
  if (mode !== "week" && mode !== "month")
    throw new Error("Time Report supports weekly or monthly periods.");
  const invalidDays =
    !query.days.length ||
    query.days.some((day, index) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
      const date = new Date(`${day}T12:00:00Z`);
      return (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== day ||
        (index > 0 && shiftDay(query.days[0]!, index) !== day)
      );
    });
  if (mode === "week") {
    if (
      invalidDays ||
      query.days.length !== 7 ||
      new Date(`${query.days[0]}T12:00:00Z`).getUTCDay() !== 1
    )
      throw new Error("Time Report requires seven consecutive days starting Monday.");
  } else {
    if (invalidDays || !query.days[0]!.endsWith("-01"))
      throw new Error("Monthly Time Report requires a complete calendar month.");
    const lastDay = new Date(`${query.days[0]}T12:00:00Z`);
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
    if (query.days.length !== lastDay.getUTCDate())
      throw new Error("Monthly Time Report requires a complete calendar month.");
  }
  // Validate before issuing any requests, including an invalid IANA zone.
  dayInZone(new Date(), query.timeZone);
  const checkIdentity = async () => {
    const user = await api.getUser(signal);
    signal.throwIfAborted();
    if (user.accountId !== expectedViewerId)
      throw new WorklogIdentityError("The Jira account changed. Reconnect in Settings.");
  };
  await checkIdentity();
  const accounts = new Set(query.accountIds);
  const roster = [...accounts];
  const discoveries: string[] = [];
  const issueMap = new Map<string, TimesheetIssue>();
  // Jira evaluates dates in its profile zone, which may differ from the report
  // zone. Two days around the period safely cover calendar offsets and DST.
  const from = shiftDay(query.days[0]!, -2);
  const until = shiftDay(query.days.at(-1)!, 3);
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchLength = 0;
  for (const id of roster) {
    const author = `"${id.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    // Leave room for date clauses under the transport's 10,000-character limit.
    if (batch.length >= 50 || batchLength + author.length + 2 > 9_000) {
      batches.push(batch);
      batch = [];
      batchLength = 0;
    }
    batch.push(author);
    batchLength += author.length + 2;
  }
  if (batch.length) batches.push(batch);
  for (const authors of batches) {
    signal.throwIfAborted();
    const jql = `worklogAuthor in (${authors.join(", ")}) AND worklogDate >= "${from}" AND worklogDate < "${until}" ORDER BY id ASC`;
    discoveries.push(jql);
    const candidates = await searchAll(api, jql, signal, progress);
    candidates.forEach((issue) => issueMap.set(issue.id, issue));
  }
  const discoveryJql = discoveries.join("\n");
  const issues = [...issueMap.values()];
  const days = new Set(query.days);
  const worklogs = new Map<string, TimesheetWorklog>();
  const failedIssueIds: string[] = [];
  const reasons: string[] = [];
  let cursor = 0;
  let completed = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, issues.length) }, async () => {
      while (cursor < issues.length) {
        signal.throwIfAborted();
        const issue = issues[cursor++]!;
        try {
          const logs = await api.getWorklogs(issue, signal);
          signal.throwIfAborted();
          const selected = new Map<string, TimesheetWorklog>();
          for (const log of logs) {
            if (log.issueId !== issue.id)
              throw new Error("Jira returned a worklog for another issue.");
            if (!accounts.has(log.authorId)) continue;
            if (!days.has(dayInZone(log.started, query.timeZone))) continue;
            const existing = selected.get(log.id) ?? worklogs.get(log.id);
            if (existing && JSON.stringify(existing) !== JSON.stringify(log))
              throw new Error(
                "Jira returned conflicting copies of a worklog; refresh to retry.",
              );
            selected.set(log.id, log);
          }
          selected.forEach((log, id) => worklogs.set(id, log));
        } catch (error) {
          signal.throwIfAborted();
          if (
            error instanceof WorklogIdentityError ||
            (error instanceof JiraClientError && error.appError.code === "AUTH_REQUIRED")
          )
            throw error;
          failedIssueIds.push(issue.id);
          reasons.push(
            `${issue.key}: ${error instanceof Error ? error.message : "Worklogs unavailable"}`,
          );
        }
        progress(`Reading matching issues: ${++completed} / ${issues.length}`);
      }
    }),
  );
  await checkIdentity();
  return {
    issues,
    worklogs: [...worklogs.values()],
    state: failedIssueIds.length ? "partial" : "ready",
    coverage: "jql-limited",
    coverageNotice:
      "Issues were found by the selected worklog authors and reporting period, without board or project filters. Jira searches only the latest 1,000 worklogs per issue, so older matching records may be omitted. Jira permissions may also hide issues or restricted worklogs. Hours include the records read; complete coverage is not guaranteed.",
    failedIssueIds,
    reasons,
    discoveryJql,
    loadedAt: new Date().toISOString(),
  };
}
