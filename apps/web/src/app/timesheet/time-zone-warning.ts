import { duration } from "./timesheet-model";

/** Compare both zones at the same instant on each displayed date (including DST). */
function offsetMinutes(zone: string, day: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(`${day}T12:00:00Z`));
  const offset = parts.find((part) => part.type === "timeZoneName")?.value;
  if (offset === "GMT") return 0;
  const match = offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Unsupported time zone offset");
  return (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]));
}

export function timeZoneWarning(
  authorZone: string | undefined,
  days: string[],
): string | undefined {
  if (!authorZone || !days.length) return undefined;
  try {
    const differences = days.map(
      (day) => offsetMinutes(authorZone, day) - offsetMinutes("Europe/Kyiv", day),
    );
    const min = Math.min(...differences);
    const max = Math.max(...differences);
    if (min >= -60 && max <= 60) return undefined;
    const label = (minutes: number) =>
      `${minutes < 0 ? "−" : "+"}${duration(Math.abs(minutes) * 60)}`;
    const difference = min === max ? label(min) : `${label(min)} to ${label(max)}`;
    return `Your Jira profile uses ${authorZone} (${difference} relative to Europe/Kyiv during this period; expected: ±1h). Worklog dates may differ from Kyiv. Check your time zone in Jira profile settings.`;
  } catch {
    return undefined;
  }
}
