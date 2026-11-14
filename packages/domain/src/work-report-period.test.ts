import { describe, expect, it } from "vitest";
import {
  DAILY_WORK_REPORT_CALENDAR,
  latestWorkReportDate,
  nextWorkReportDate,
  previousWorkReportDate,
  workReportPeriod,
} from "./work-report-period";

describe("Kyiv calendar-day reports", () => {
  const calendar = DAILY_WORK_REPORT_CALENDAR;

  it("covers the previous day and waits until 00:05 on weekends too", () => {
    expect(workReportPeriod("2026-11-15", calendar)).toEqual({
      date: "2026-11-15",
      start: "2026-11-13T22:00:00.000Z",
      end: "2026-11-14T22:00:00.000Z",
      timeZone: "Europe/Kyiv",
    });
    expect(nextWorkReportDate("2026-11-14", calendar)).toBe("2026-11-15");
    expect(latestWorkReportDate(new Date("2026-11-15T00:04:59+02:00"), calendar)).toBe(
      "2026-11-14",
    );
    for (const time of ["00:05:00", "19:42:00"])
      expect(latestWorkReportDate(new Date(`2026-11-15T${time}+02:00`), calendar)).toBe(
        "2026-11-15",
      );
  });

  it.each([
    ["2026-03-30", "2026-03-28T22:00:00.000Z", "2026-03-29T21:00:00.000Z"],
    ["2026-10-26", "2026-10-24T21:00:00.000Z", "2026-10-25T22:00:00.000Z"],
  ])("keeps local midnight across the DST change ending on %s", (date, start, end) => {
    const period = workReportPeriod(date, calendar);
    expect(period).toMatchObject({ start, end });
    expect(workReportPeriod(nextWorkReportDate(date, calendar), calendar).start).toBe(
      end,
    );
  });
});

describe("Bot working-day report calendar", () => {
  it("uses the previous weekday 08:00 through the report date 08:00 in Kyiv", () => {
    expect(workReportPeriod("2026-11-10")).toEqual({
      date: "2026-11-10",
      start: "2026-11-09T06:00:00.000Z",
      end: "2026-11-10T06:00:00.000Z",
      timeZone: "Europe/Kyiv",
    });
  });

  it("includes Friday morning through Monday morning without a weekend gap", () => {
    const friday = workReportPeriod("2026-11-06");
    const monday = workReportPeriod("2026-11-09");
    expect(monday.start).toBe(friday.end);
    expect(monday.end).toBe("2026-11-09T06:00:00.000Z");
    expect((Date.parse(monday.end) - Date.parse(monday.start)) / 3_600_000).toBe(72);
  });

  it.each([
    ["2026-11-10T07:59:59+02:00", "2026-11-09"],
    ["2026-11-10T08:00:00+02:00", "2026-11-09"],
    ["2026-11-10T08:00:59.999+02:00", "2026-11-09"],
    ["2026-11-10T08:01:00+02:00", "2026-11-10"],
    ["2026-11-09T08:00:59+02:00", "2026-11-06"],
    ["2026-11-09T08:01:00+02:00", "2026-11-09"],
    ["2026-11-07T12:00:00+02:00", "2026-11-06"],
    ["2026-11-08T23:59:59+02:00", "2026-11-06"],
    ["2026-11-09T01:00:00+02:00", "2026-11-06"],
    ["2026-11-10T01:00:00+02:00", "2026-11-09"],
    ["2026-11-10T04:00:00+02:00", "2026-11-09"],
    ["2026-11-10T23:59:59+02:00", "2026-11-10"],
  ])("selects %s → report date %s", (instant, date) => {
    expect(latestWorkReportDate(new Date(instant))).toBe(date);
  });

  it.each([
    ["2026-11-06", "2026-11-09", "2026-11-05"],
    ["2026-11-07", "2026-11-09", "2026-11-06"],
    ["2026-11-08", "2026-11-09", "2026-11-06"],
    ["2026-11-09", "2026-11-10", "2026-11-06"],
    ["2026-01-01", "2026-01-02", "2025-12-31"],
  ])("finds adjacent weekdays around %s", (date, next, previous) => {
    expect(nextWorkReportDate(date)).toBe(next);
    expect(previousWorkReportDate(date)).toBe(previous);
  });

  it.each([
    ["2026-03-30", "2026-03-27T06:00:00.000Z", "2026-03-30T05:00:00.000Z", 71],
    ["2026-10-26", "2026-10-23T05:00:00.000Z", "2026-10-26T06:00:00.000Z", 73],
  ])("preserves civil morning boundaries over DST for %s", (date, start, end, hours) => {
    const period = workReportPeriod(date);
    expect(period.start).toBe(start);
    expect(period.end).toBe(end);
    expect((Date.parse(period.end) - Date.parse(period.start)) / 3_600_000).toBe(hours);
    expect(workReportPeriod(nextWorkReportDate(date)).start).toBe(end);
    expect(latestWorkReportDate(new Date(end))).toBe(previousWorkReportDate(date));
    expect(latestWorkReportDate(new Date(Date.parse(end) + 60_000))).toBe(date);
  });

  it("catches up missed working dates in order with contiguous windows", () => {
    const latest = latestWorkReportDate(new Date("2026-11-11T08:01:00+02:00"));
    const periods = [];
    for (
      let date = nextWorkReportDate("2026-11-06");
      date <= latest;
      date = nextWorkReportDate(date)
    )
      periods.push(workReportPeriod(date));
    expect(periods.map((period) => period.date)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
    ]);
    expect(periods[0]!.start).toBe(workReportPeriod("2026-11-06").end);
    expect(periods[1]!.start).toBe(periods[0]!.end);
    expect(periods[2]!.start).toBe(periods[1]!.end);
  });

  it("has no holiday calendar beyond the Monday–Friday rule", () => {
    expect(workReportPeriod("2026-01-01").start).toBe("2025-12-31T06:00:00.000Z");
    expect(latestWorkReportDate(new Date("2026-01-01T08:01:00+02:00"))).toBe(
      "2026-01-01",
    );
  });

  it("rejects invalid dates, weekend report dates and invalid current times", () => {
    for (const date of ["2026-02-30", "not-a-date"])
      for (const operation of [
        workReportPeriod,
        nextWorkReportDate,
        previousWorkReportDate,
      ])
        expect(() => operation(date)).toThrow();
    for (const date of ["2026-11-07", "2026-11-08"])
      expect(() => workReportPeriod(date)).toThrow(/Monday–Friday/);
    expect(() => latestWorkReportDate(new Date("not-a-time"))).toThrow(/time/);
  });
});
