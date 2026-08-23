import type { GanttViewport } from "./GanttRenderer";
import { nonWorkingDayRanges } from "./GanttRenderer";

export function GanttNonWorkingDaysLayer({ viewport, nonWorkingDays }: { viewport: GanttViewport; nonWorkingDays: number[] }) {
  const ranges = nonWorkingDayRanges(viewport, nonWorkingDays);
  if (ranges.length === 0) return null;
  return (
    <div className="gantt-non-working-days-layer">
      {ranges.map((range) => (
        <div key={`${range.left}-${range.width}`} className="gantt-non-working-day" style={range} />
      ))}
    </div>
  );
}
