import type {
  NormalizedReportUser,
  ReportChangeEvent,
  ReportingIssueSnapshot,
} from "./reporting";

export const DESCRIPTION_REPORT_TIME_ZONE = "Europe/Kyiv" as const;
export interface DescriptionReportPeriod {
  date: string;
  start: string;
  end: string;
  timeZone: typeof DESCRIPTION_REPORT_TIME_ZONE;
}
export interface DescriptionReportRow {
  issueId: string;
  issueKey: string;
  summary: string;
  issueType: string;
  parentId?: string;
  depth: number;
  contextOnly: boolean;
  authors: NormalizedReportUser[];
  changeCount: number;
}
export interface DescriptionChangeReport {
  schemaVersion: 1;
  id: string;
  jiraBaseUrl: string;
  boardId: string;
  boardName: string;
  period: DescriptionReportPeriod;
  generatedAt: string;
  changedIssueCount: number;
  changeCount: number;
  rows: DescriptionReportRow[];
}

const localFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DESCRIPTION_REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function parts(instant: Date): Record<string, string> {
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid report time.");
  return Object.fromEntries(
    localFormatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
}
function localDate(instant: Date): string {
  const p = parts(instant);
  return `${p.year}-${p.month}-${p.day}`;
}
function checkedDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Use a date in YYYY-MM-DD format.");
  const result = new Date(date + "T12:00:00.000Z");
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== date)
    throw new Error("Invalid report date.");
  return result;
}
export function shiftDescriptionDate(date: string, days: number): string {
  const value = checkedDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function evening(date: string): string {
  checkedDate(date);
  const desired = Date.parse(date + "T21:00:00.000Z");
  let guess = desired;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess));
    const wall = Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`,
    );
    guess = desired - (wall - guess);
  }
  return new Date(guess).toISOString();
}
/** Civil evenings, rather than 24-hour subtraction, preserve the Kyiv DST boundary. */
export function descriptionReportPeriod(date: string): DescriptionReportPeriod {
  return {
    date,
    start: evening(shiftDescriptionDate(date, -1)),
    end: evening(date),
    timeZone: DESCRIPTION_REPORT_TIME_ZONE,
  };
}
export function latestDescriptionReportDate(now = new Date()): string {
  const date = localDate(now);
  return now.getTime() >= Date.parse(evening(date))
    ? date
    : shiftDescriptionDate(date, -1);
}
/** Jira's JQL date literals use its user's timezone. A full-day pad covers all zones;
 * exact event boundaries are applied below. No upper updated bound can hide late edits. */
export function descriptionCandidateJql(period: DescriptionReportPeriod): string {
  const padded = new Date(Date.parse(period.start) - 86_400_000).toISOString();
  return `updated >= "${padded.slice(0, 10)} ${padded.slice(11, 16)}" ORDER BY key ASC`;
}
export function buildDescriptionChangeReport(
  input: {
    jiraBaseUrl: string;
    boardId: string;
    boardName: string;
    period: DescriptionReportPeriod;
    generatedAt: string;
    issues: readonly ReportingIssueSnapshot[];
    events: readonly ReportChangeEvent[];
  },
  expectedPeriod?: DescriptionReportPeriod,
): DescriptionChangeReport {
  const period = expectedPeriod ?? descriptionReportPeriod(input.period.date);
  if (period.start !== input.period.start || period.end !== input.period.end)
    throw new Error("The report does not match its configured Kyiv period boundaries.");
  if (
    period.date !== input.period.date ||
    period.timeZone !== DESCRIPTION_REPORT_TIME_ZONE ||
    !Number.isFinite(Date.parse(period.start)) ||
    !Number.isFinite(Date.parse(period.end)) ||
    Date.parse(period.start) >= Date.parse(period.end)
  )
    throw new Error("The configured report period is invalid.");
  const origin = new URL(input.jiraBaseUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password)
    throw new Error("Use a valid HTTPS Jira URL.");
  const issues = new Map(input.issues.map((issue) => [issue.id, issue]));
  const byKey = new Map(input.issues.map((issue) => [issue.key, issue]));
  const grouped = new Map<string, ReportChangeEvent[]>();
  const seen = new Set<string>();
  for (const event of input.events) {
    if (event.type !== "description-changed") continue;
    const time = Date.parse(event.occurredAt);
    if (!Number.isFinite(time))
      throw new Error("Jira returned an invalid description-change time.");
    if (
      time < Date.parse(period.start) ||
      time >= Date.parse(period.end) ||
      seen.has(event.id)
    )
      continue;
    if (!issues.has(event.issueId))
      throw new Error("A changed issue is missing from the report.");
    seen.add(event.id);
    grouped.set(event.issueId, [...(grouped.get(event.issueId) ?? []), event]);
  }
  const included = new Set<string>();
  const parentOf = (issue: ReportingIssueSnapshot): ReportingIssueSnapshot | undefined =>
    (issue.parentId ? issues.get(issue.parentId) : undefined) ??
    (issue.parentKey ? byKey.get(issue.parentKey) : undefined);
  for (const id of grouped.keys()) {
    let current = issues.get(id);
    const path = new Set<string>();
    while (current) {
      if (path.has(current.id) || path.size > 50)
        throw new Error("Jira returned a cyclic or excessively deep issue hierarchy.");
      path.add(current.id);
      included.add(current.id);
      const parent = parentOf(current);
      if ((current.parentId || current.parentKey) && !parent)
        throw new Error(
          "An ancestor is unavailable. The hierarchy cannot be reported as complete.",
        );
      current = parent;
    }
  }
  const compare = (a: ReportingIssueSnapshot, b: ReportingIssueSnapshot) =>
    a.key.localeCompare(b.key, "en", { numeric: true });
  const children = new Map<string, ReportingIssueSnapshot[]>();
  const roots: ReportingIssueSnapshot[] = [];
  for (const id of included) {
    const issue = issues.get(id)!;
    const parent = parentOf(issue);
    if (parent && included.has(parent.id))
      children.set(parent.id, [...(children.get(parent.id) ?? []), issue]);
    else roots.push(issue);
  }
  const rows: DescriptionReportRow[] = [];
  function visit(issue: ReportingIssueSnapshot, depth: number) {
    const events = [...(grouped.get(issue.id) ?? [])].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt),
    );
    const authors = new Map<string, NormalizedReportUser>();
    for (const event of events) {
      const author = event.actor ?? {
        id: "unavailable",
        displayName: "Автор недоступний",
      };
      authors.set(author.id, { id: author.id, displayName: author.displayName });
    }
    const parent = parentOf(issue);
    rows.push({
      issueId: issue.id,
      issueKey: issue.key,
      summary: issue.summary,
      issueType: issue.issueType.name,
      ...(parent ? { parentId: parent.id } : {}),
      depth,
      contextOnly: events.length === 0,
      authors: [...authors.values()].sort(
        (a, b) =>
          a.displayName.localeCompare(b.displayName, "uk") || a.id.localeCompare(b.id),
      ),
      changeCount: events.length,
    });
    for (const child of (children.get(issue.id) ?? []).sort(compare))
      visit(child, depth + 1);
  }
  for (const root of roots.sort(compare)) visit(root, 0);
  return {
    schemaVersion: 1,
    id: `descriptions:${input.boardId}:${period.date}`,
    jiraBaseUrl: origin.origin,
    boardId: input.boardId,
    boardName: input.boardName,
    period,
    generatedAt: input.generatedAt,
    changedIssueCount: grouped.size,
    changeCount: [...grouped.values()].reduce((sum, events) => sum + events.length, 0),
    rows,
  };
}
