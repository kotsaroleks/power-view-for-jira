/** Calendar days are resolved in the reporting time zone by the data boundary. */
export interface TimeReportUser {
  userId: string;
  displayName: string;
}
export interface TimeReportWorklog {
  id: string;
  userId: string;
  issueKey: string;
  day: string;
  timeSpentSeconds: number;
}
export interface TimeReportDayOff {
  userId: string;
  date: string;
}
export interface TimeReportMetrics {
  loggedSeconds: number;
  expectedSeconds: number | null;
  utilizationPercent: number | null;
  overtimeSeconds: number | null;
  missingSeconds: number | null;
}
export interface TimeReportDay {
  date: string;
  loggedSeconds: number;
  worklogCount: number;
  dayOff: boolean;
  conflict: boolean;
}
export interface TimeReportIssue {
  issueKey: string;
  days: TimeReportDay[];
  loggedSeconds: number;
}
export interface TimeReportEmployee extends TimeReportMetrics {
  user: TimeReportUser;
  days: TimeReportDay[];
  issues: TimeReportIssue[];
}
export interface TimeReportInput {
  /** Monday for weeks; first calendar day for months. */
  weekStart: string;
  periodMode?: "week" | "month";
  users: readonly TimeReportUser[];
  worklogs: readonly TimeReportWorklog[];
  dayOffs: readonly TimeReportDayOff[];
}
export interface TimeReport {
  days: string[];
  employees: TimeReportEmployee[];
  team: TimeReportMetrics & {
    days: Array<{ date: string; loggedSeconds: number; conflictCount: number }>;
  };
}
const DAY_SECONDS = 8 * 3600;
function calendarDate(value: string): Date {
  const date = new Date(`${value}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new Error(`Invalid calendar date: ${value}`);
  return date;
}
function metrics(
  loggedSeconds: number,
  expectedSeconds: number | null,
): TimeReportMetrics {
  return {
    loggedSeconds,
    expectedSeconds,
    utilizationPercent:
      expectedSeconds === null || expectedSeconds === 0
        ? null
        : (loggedSeconds / expectedSeconds) * 100,
    overtimeSeconds:
      expectedSeconds === null ? null : Math.max(0, loggedSeconds - expectedSeconds),
    missingSeconds:
      expectedSeconds === null ? null : Math.max(0, expectedSeconds - loggedSeconds),
  };
}
/** Capacity is eight hours per Monday–Friday, excluding each unique weekday off. */
export function buildTimeReport(input: TimeReportInput): TimeReport {
  const start = calendarDate(input.weekStart);
  const mode = input.periodMode ?? "week";
  if (mode !== "week" && mode !== "month")
    throw new Error("Invalid Time Report period mode.");
  if (mode === "week" && start.getUTCDay() !== 1)
    throw new Error("Time Report week must start on Monday.");
  if (mode === "month" && start.getUTCDate() !== 1)
    throw new Error("Time Report month must start on its first day.");
  const dayCount =
    mode === "week"
      ? 7
      : new Date(
          Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
        ).getUTCDate();
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const users = new Set<string>();
  for (const user of input.users) {
    if (!user.userId || users.has(user.userId))
      throw new Error("Time Report users must have unique non-empty IDs.");
    users.add(user.userId);
  }
  const offByUser = new Map<string, Set<string>>();
  for (const off of input.dayOffs) {
    calendarDate(off.date);
    const dates = offByUser.get(off.userId) ?? new Set<string>();
    dates.add(off.date);
    offByUser.set(off.userId, dates);
  }
  const logs = new Map<string, TimeReportWorklog>();
  for (const log of input.worklogs) {
    calendarDate(log.day);
    if (
      !log.id ||
      !log.userId ||
      !log.issueKey ||
      !Number.isSafeInteger(log.timeSpentSeconds) ||
      log.timeSpentSeconds < 0
    )
      throw new Error("Invalid Time Report worklog.");
    const previous = logs.get(log.id);
    if (
      previous &&
      (previous.userId !== log.userId ||
        previous.issueKey !== log.issueKey ||
        previous.day !== log.day ||
        previous.timeSpentSeconds !== log.timeSpentSeconds)
    )
      throw new Error(`Conflicting duplicate worklog: ${log.id}`);
    logs.set(log.id, log);
  }
  const period = new Set(days);
  const employees = input.users.map((user): TimeReportEmployee => {
    const userLogs = [...logs.values()].filter(
      (log) => log.userId === user.userId && period.has(log.day),
    );
    const off = offByUser.get(user.userId);
    const cells = (records: TimeReportWorklog[]): TimeReportDay[] =>
      days.map((date) => {
        const dayLogs = records.filter((log) => log.day === date);
        const dayOff = off?.has(date) ?? false;
        return {
          date,
          loggedSeconds: dayLogs.reduce((sum, log) => sum + log.timeSpentSeconds, 0),
          worklogCount: dayLogs.length,
          dayOff,
          conflict: dayOff && dayLogs.length > 0,
        };
      });
    const employeeDays = cells(userLogs);
    const expected = employeeDays.reduce((sum, day) => {
      const weekday = calendarDate(day.date).getUTCDay();
      return sum + (weekday !== 0 && weekday !== 6 && !day.dayOff ? DAY_SECONDS : 0);
    }, 0);
    const logged = employeeDays.reduce((sum, day) => sum + day.loggedSeconds, 0);
    return {
      user: { ...user },
      days: employeeDays,
      issues: [...new Set(userLogs.map((log) => log.issueKey))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((issueKey) => {
          const issueDays = cells(userLogs.filter((log) => log.issueKey === issueKey));
          return {
            issueKey,
            days: issueDays,
            loggedSeconds: issueDays.reduce((sum, day) => sum + day.loggedSeconds, 0),
          };
        }),
      ...metrics(logged, expected),
    };
  });
  return {
    days,
    employees,
    team: {
      ...metrics(
        employees.reduce((sum, employee) => sum + employee.loggedSeconds, 0),
        employees.reduce((sum, employee) => sum + (employee.expectedSeconds ?? 0), 0),
      ),
      days: days.map((date, index) => ({
        date,
        loggedSeconds: employees.reduce(
          (sum, employee) => sum + employee.days[index]!.loggedSeconds,
          0,
        ),
        conflictCount: employees.filter((employee) => employee.days[index]!.conflict)
          .length,
      })),
    },
  };
}
