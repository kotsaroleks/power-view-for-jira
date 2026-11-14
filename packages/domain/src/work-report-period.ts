import {
  DESCRIPTION_REPORT_TIME_ZONE,
  shiftDescriptionDate,
  type DescriptionReportPeriod,
} from "./description-report";

export const WEEKDAY_WORK_REPORT_CALENDAR = "kyiv-workdays-08-v1" as const;
export const DAILY_WORK_REPORT_CALENDAR = "kyiv-calendar-days-00-v1" as const;
export type WorkReportCalendar =
  typeof WEEKDAY_WORK_REPORT_CALENDAR | typeof DAILY_WORK_REPORT_CALENDAR;

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DESCRIPTION_REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(instant: Date): Record<string, string> {
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid work report time.");
  return Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
}

function isWorkingDay(date: string): boolean {
  const checked = shiftDescriptionDate(date, 0);
  const weekday = new Date(checked + "T12:00:00.000Z").getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function nextWorkReportDate(
  date: string,
  calendar: WorkReportCalendar = WEEKDAY_WORK_REPORT_CALENDAR,
): string {
  let next = shiftDescriptionDate(date, 1);
  while (calendar === WEEKDAY_WORK_REPORT_CALENDAR && !isWorkingDay(next))
    next = shiftDescriptionDate(next, 1);
  return next;
}

export function previousWorkReportDate(
  date: string,
  calendar: WorkReportCalendar = WEEKDAY_WORK_REPORT_CALENDAR,
): string {
  let previous = shiftDescriptionDate(date, -1);
  while (calendar === WEEKDAY_WORK_REPORT_CALENDAR && !isWorkingDay(previous))
    previous = shiftDescriptionDate(previous, -1);
  return previous;
}

function civilBoundary(date: string, calendar: WorkReportCalendar): string {
  const hour = calendar === DAILY_WORK_REPORT_CALENDAR ? "00" : "08";
  const desired = Date.parse(`${date}T${hour}:00:00.000Z`);
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = localParts(new Date(guess));
    const wall = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000Z`,
    );
    guess = desired - (wall - guess);
  }
  return new Date(guess).toISOString();
}

/** A report date names its closing boundary. Civil boundaries preserve Kyiv DST changes. */
export function workReportPeriod(
  date: string,
  calendar: WorkReportCalendar = WEEKDAY_WORK_REPORT_CALENDAR,
): DescriptionReportPeriod {
  if (calendar === WEEKDAY_WORK_REPORT_CALENDAR && !isWorkingDay(date))
    throw new Error("A work report date must be Monday–Friday.");
  return {
    date,
    start: civilBoundary(previousWorkReportDate(date, calendar), calendar),
    end: civilBoundary(date, calendar),
    timeZone: DESCRIPTION_REPORT_TIME_ZONE,
  };
}

export function latestWorkReportDate(
  now = new Date(),
  calendar: WorkReportCalendar = WEEKDAY_WORK_REPORT_CALENDAR,
): string {
  const parts = localParts(now);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const daily = calendar === DAILY_WORK_REPORT_CALENDAR;
  const readyAt = daily ? 5 : 8 * 60 + 1;
  if (
    (daily || isWorkingDay(date)) &&
    Number(parts.hour) * 60 + Number(parts.minute) >= readyAt
  )
    return date;
  return previousWorkReportDate(date, calendar);
}
