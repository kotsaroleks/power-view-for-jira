import {
  DESCRIPTION_REPORT_TIME_ZONE,
  shiftDescriptionDate,
  type DescriptionReportPeriod,
} from "./description-report";

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

/** Monday–Friday only; public holidays are ordinary working days for these bots. */
export function nextWorkReportDate(date: string): string {
  let next = shiftDescriptionDate(date, 1);
  while (!isWorkingDay(next)) next = shiftDescriptionDate(next, 1);
  return next;
}

/** Returns the strict previous weekday, including when the input is a weekend. */
export function previousWorkReportDate(date: string): string {
  let previous = shiftDescriptionDate(date, -1);
  while (!isWorkingDay(previous)) previous = shiftDescriptionDate(previous, -1);
  return previous;
}

function morning(date: string): string {
  const desired = Date.parse(date + "T08:00:00.000Z");
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

/** Bot-only calendar: previous weekday 08:00 inclusive → report date 08:00 exclusive.
 * Monday includes the whole weekend. Civil boundaries preserve Kyiv DST changes. */
export function workReportPeriod(date: string): DescriptionReportPeriod {
  if (!isWorkingDay(date)) throw new Error("A work report date must be Monday–Friday.");
  return {
    date,
    start: morning(previousWorkReportDate(date)),
    end: morning(date),
    timeZone: DESCRIPTION_REPORT_TIME_ZONE,
  };
}

/** Latest report eligible at 08:01 Kyiv on a weekday; weekends retain Friday. */
export function latestWorkReportDate(now = new Date()): string {
  const parts = localParts(now);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  if (isWorkingDay(date) && Number(parts.hour) * 60 + Number(parts.minute) >= 8 * 60 + 1)
    return date;
  return previousWorkReportDate(date);
}
