import {
  JiraClientError,
  WorklogIdentityError,
  type TimesheetApi,
  type TimesheetIssue,
  type TimesheetWorklog,
  type TimesheetUser,
} from "@power-view/jira-client";

export type PeriodMode = "week" | "month";

export function dayInZone(value: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftDay(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function periodDays(anchor: string, mode: PeriodMode): string[] {
  const date = new Date(`${anchor}T12:00:00Z`);
  const start =
    mode === "week"
      ? shiftDay(anchor, -((date.getUTCDay() + 6) % 7))
      : `${anchor.slice(0, 7)}-01`;
  const count =
    mode === "week"
      ? 7
      : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => shiftDay(start, index));
}

export function adjacentPeriod(
  anchor: string,
  mode: PeriodMode,
  direction: number,
): string {
  if (mode === "week") return shiftDay(anchor, direction * 7);
  const date = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}

export function duration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return (
    [
      hours ? `${hours}h` : "",
      minutes ? `${minutes}m` : "",
      remainder ? `${remainder}s` : "",
    ]
      .filter(Boolean)
      .join(" ") || "0m"
  );
}

export interface TimesheetQuery {
  days: string[];
  timeZone: string;
  projectIds: string[];
  explicitJql: string;
}
export interface TimesheetData {
  issues: TimesheetIssue[];
  worklogs: TimesheetWorklog[];
  user: TimesheetUser;
  coverage: "jql-limited";
  state: "ready" | "partial";
  failedIssueIds: string[];
  reasons: string[];
  candidateIssueCount: number;
  loadedIssueCount: number;
  loadedWorklogCount: number;
  issueWorklogCounts: Record<string, number>;
  matchedWorklogCount: number;
  discoveryJql: string;
  dateDiscovery: boolean;
  loadedAt: string;
}
export function jqlFilter(jql: string): string {
  let quote = "";
  let escaped = false;
  for (let i = 0; i < jql.length; i++) {
    const char = jql[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if ((i === 0 || /\s/.test(jql[i - 1]!)) && /^order\s+by\b/i.test(jql.slice(i)))
      return jql.slice(0, i).trim();
  }
  return jql.trim();
}
export function scopeJql(query: TimesheetQuery): string {
  const filters: string[] = [];
  if (query.projectIds.length) {
    if (query.projectIds.some((value) => !/^\d+$/.test(value)))
      throw new Error("Invalid project filter.");
    filters.push(`project in (${query.projectIds.join(",")})`);
  }
  const explicit = jqlFilter(query.explicitJql);
  if (explicit) filters.push(`(${explicit})`);
  return filters.join(" AND ");
}
export function discoveryJql(
  query: TimesheetQuery,
  user: TimesheetUser,
): { jql: string; dateDiscovery: boolean } {
  const filters = ["worklogAuthor = currentUser()"];
  let dateDiscovery = false;
  // Widen the calendar-day discovery envelope; exact instants are filtered below.
  // If Jira's profile zone is unavailable, omit date clauses rather than guess.
  if (user.timeZone) {
    try {
      dayInZone(new Date(), user.timeZone);
      filters.push(
        `worklogDate >= "${shiftDay(query.days[0]!, -2)}"`,
        `worklogDate < "${shiftDay(query.days.at(-1)!, 3)}"`,
      );
      dateDiscovery = true;
    } catch {
      /* An unrecognised profile zone does not narrow discovery. */
    }
  }
  const scope = scopeJql(query);
  if (scope) filters.push(scope);
  return { jql: filters.join(" AND "), dateDiscovery };
}
export async function searchAll(
  api: TimesheetApi,
  jql: string,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<TimesheetIssue[]> {
  const issues = new Map<string, TimesheetIssue>();
  const tokens = new Set<string>();
  let token: string | undefined;
  while (true) {
    signal.throwIfAborted();
    const page = await api.search(jql, token, signal);
    page.issues.forEach((issue) => issues.set(issue.id, issue));
    progress(`Searching issues: ${issues.size}`);
    if (page.isLast) return [...issues.values()];
    if (!page.nextPageToken || tokens.has(page.nextPageToken) || !page.issues.length)
      throw new Error("Jira search pagination was incomplete. Refresh to retry.");
    tokens.add(page.nextPageToken);
    token = page.nextPageToken;
  }
}
export async function loadTimesheet(
  api: TimesheetApi,
  query: TimesheetQuery,
  expectedAccountId: string,
  knownIssues: TimesheetIssue[],
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<TimesheetData> {
  const user = await api.getUser(signal);
  signal.throwIfAborted();
  if (user.accountId !== expectedAccountId)
    throw new WorklogIdentityError("The Jira account changed. Reconnect in Settings.");
  const discovery = discoveryJql(query, user);
  const candidates = await searchAll(api, discovery.jql, signal, progress);
  const byId = new Map(candidates.map((issue) => [issue.id, issue]));
  // Known issues bypass worklog-index discovery but must still match explicit issue scope.
  const scope = scopeJql(query);
  const permittedKnown =
    scope && knownIssues.length
      ? await searchAll(
          api,
          `id in (${knownIssues.map((issue) => issue.id).join(",")}) AND ${scope}`,
          signal,
          progress,
        )
      : knownIssues;
  permittedKnown.forEach((issue) => byId.set(issue.id, issue));
  const issues = [...byId.values()];
  const worklogs = new Map<string, TimesheetWorklog>();
  const failedIssueIds: string[] = [];
  const reasons: string[] = [];
  let completed = 0;
  let loadedWorklogCount = 0;
  const issueWorklogCounts: Record<string, number> = {};
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, issues.length) }, async () => {
      while (cursor < issues.length) {
        signal.throwIfAborted();
        const issue = issues[cursor++]!;
        try {
          const records = await api.getWorklogs(issue, signal);
          loadedWorklogCount += records.length;
          issueWorklogCounts[issue.id] = records.length;
          records
            .filter((log) => log.authorId === expectedAccountId)
            .forEach((log) => worklogs.set(log.id, log));
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
        progress(`Reading worklogs: ${++completed} / ${issues.length} issues`);
      }
    }),
  );
  signal.throwIfAborted();
  if ((await api.getUser(signal)).accountId !== expectedAccountId)
    throw new WorklogIdentityError("The Jira account changed. Reconnect in Settings.");
  const days = new Set(query.days);
  const selected = [...worklogs.values()].filter((log) =>
    days.has(dayInZone(log.started, query.timeZone)),
  );
  return {
    issues,
    worklogs: selected,
    user,
    coverage: "jql-limited",
    state: failedIssueIds.length ? "partial" : "ready",
    failedIssueIds,
    reasons,
    candidateIssueCount: candidates.length,
    loadedIssueCount: issues.length - failedIssueIds.length,
    loadedWorklogCount,
    issueWorklogCounts,
    matchedWorklogCount: selected.length,
    discoveryJql: discovery.jql,
    dateDiscovery: discovery.dateDiscovery,
    loadedAt: new Date().toISOString(),
  };
}
export function timesheetRows(
  data: TimesheetData,
  days: string[],
  timeZone: string,
  includeEmpty: TimesheetIssue[] = [],
) {
  const daySet = new Set(days);
  const seen = new Set<string>();
  const emptyIds = new Set(includeEmpty.map((issue) => issue.id));
  const rows = data.issues.map((issue) => ({
    issue,
    cells: new Map<string, TimesheetWorklog[]>(),
  }));
  const byId = new Map(rows.map((row) => [row.issue.id, row]));
  for (const log of data.worklogs) {
    if (log.authorId !== data.user.accountId || seen.has(log.id)) continue;
    seen.add(log.id);
    const day = dayInZone(log.started, timeZone);
    const row = byId.get(log.issueId);
    if (!row || !daySet.has(day)) continue;
    row.cells.set(day, [...(row.cells.get(day) ?? []), log]);
  }
  return rows
    .filter((row) => row.cells.size || emptyIds.has(row.issue.id))
    .sort((a, b) => a.issue.key.localeCompare(b.issue.key, undefined, { numeric: true }));
}
export const sumWorklogs = (logs: TimesheetWorklog[]) =>
  logs.reduce((sum, log) => sum + log.timeSpentSeconds, 0);
export function parseDuration(text: string): number | undefined {
  const value = text.trim();
  let seconds: number;
  const clock = /^(\d+):([0-5]\d)$/.exec(value);
  const units = /^(?:(\d+)h(?:\s+|$))?(?:(\d+)m)?$/.exec(value);
  if (clock) seconds = Number(clock[1]) * 3600 + Number(clock[2]) * 60;
  else if (units && (units[1] || units[2]))
    seconds = Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60;
  else return undefined;
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 2_147_483_647
    ? seconds
    : undefined;
}
export function localClock(instant: string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}
/** Resolve the offsets actually used around a local date, including repeated/skipped DST times. */
export function localTimeChoices(day: string, clock: string, zone: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock))
    return [];
  const naive = Date.parse(`${day}T${clock}:00Z`);
  if (!Number.isFinite(naive)) return [];
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const date = new Date(naive + hours * 3600_000);
    const local = `${dayInZone(date, zone)}T${localClock(date.toISOString(), zone)}:00Z`;
    offsets.add(Date.parse(local) - date.getTime());
  }
  return [...offsets]
    .map((offset) => new Date(naive - offset).toISOString())
    .filter(
      (instant) =>
        dayInZone(instant, zone) === day && localClock(instant, zone) === clock,
    )
    .sort();
}
