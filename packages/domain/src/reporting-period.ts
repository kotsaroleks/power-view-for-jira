import type { JiraSprint } from "./reporting";
import type { ReportPeriod, ReportType } from "./reporting";

const KYIV_TIME_ZONE = "Europe/Kyiv" as const;
const MS_PER_DAY = 86_400_000;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KYIV_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(instant: Date): LocalParts {
  const values = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function localDateAsUtc(
  parts: Pick<LocalParts, "year" | "month" | "day" | "hour" | "minute" | "second">,
): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function kyivOffsetMs(instantMs: number): number {
  const parts = localParts(new Date(instantMs));
  return localDateAsUtc(parts) - instantMs;
}

function instantForKyivLocal(
  parts: Pick<LocalParts, "year" | "month" | "day" | "hour" | "minute" | "second">,
): Date {
  const localAsUtc = localDateAsUtc(parts);
  let guess = localAsUtc - kyivOffsetMs(localAsUtc);
  guess = localAsUtc - kyivOffsetMs(guess);
  return new Date(guess);
}

function dateKey(parts: Pick<LocalParts, "year" | "month" | "day">): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function datePartsFromKey(value: string): Pick<LocalParts, "year" | "month" | "day"> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("Expected an ISO local date in YYYY-MM-DD format.");
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function shiftCalendarDate(
  parts: Pick<LocalParts, "year" | "month" | "day">,
  days: number,
): Pick<LocalParts, "year" | "month" | "day"> {
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) + days * MS_PER_DAY,
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function boundary(date: Pick<LocalParts, "year" | "month" | "day">): Date {
  return instantForKyivLocal({ ...date, hour: 8, minute: 0, second: 0 });
}

function mondayFor(
  date: Pick<LocalParts, "year" | "month" | "day">,
): Pick<LocalParts, "year" | "month" | "day"> {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return shiftCalendarDate(date, -daysSinceMonday);
}

function minIso(left: string, right: string): string {
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

export function buildDailyPeriod(
  localDate: string,
  generatedAt = new Date().toISOString(),
): ReportPeriod {
  const endDate = datePartsFromKey(localDate);
  const startDate = shiftCalendarDate(endDate, -1);
  const start = boundary(startDate).toISOString();
  const end = boundary(endDate).toISOString();
  return { timeZone: KYIV_TIME_ZONE, start, end, dataCutoff: minIso(end, generatedAt) };
}

export function buildWeeklyPeriod(
  localDate: string,
  generatedAt = new Date().toISOString(),
): ReportPeriod {
  const startDate = mondayFor(datePartsFromKey(localDate));
  const endDate = shiftCalendarDate(startDate, 7);
  const start = boundary(startDate).toISOString();
  const end = boundary(endDate).toISOString();
  return { timeZone: KYIV_TIME_ZONE, start, end, dataCutoff: minIso(end, generatedAt) };
}

export function buildSprintPeriod(
  sprint: JiraSprint,
  generatedAt = new Date().toISOString(),
): ReportPeriod {
  if (!sprint.startDate) {
    throw new Error("The selected sprint has no start date.");
  }
  const start = new Date(sprint.startDate).toISOString();
  const end =
    sprint.state === "active"
      ? generatedAt
      : new Date(sprint.completeDate ?? sprint.endDate ?? generatedAt).toISOString();
  return {
    timeZone: KYIV_TIME_ZONE,
    start,
    end,
    dataCutoff: minIso(end, generatedAt),
  };
}

export function buildReportPeriod(
  type: ReportType,
  localDate: string,
  generatedAt = new Date().toISOString(),
  sprint?: JiraSprint,
): ReportPeriod {
  if (type === "daily") {
    return buildDailyPeriod(localDate, generatedAt);
  }
  if (type === "weekly") {
    return buildWeeklyPeriod(localDate, generatedAt);
  }
  if (!sprint) {
    throw new Error("A sprint is required for a Sprint Report.");
  }
  return buildSprintPeriod(sprint, generatedAt);
}

export function localKyivDate(instant = new Date()): string {
  return dateKey(localParts(instant));
}
