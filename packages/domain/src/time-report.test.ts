import { describe, expect, it } from "vitest";
import {
  buildTimeReport,
  type TimeReportInput,
  type TimeReportWorklog,
} from "./time-report";
const weekStart = "2026-10-26";
const users = [
  { userId: "a", displayName: "A" },
  { userId: "b", displayName: "B" },
];
const log = (
  id: string,
  userId: string,
  day: string,
  hours: number,
  issueKey = "ADMIN-1",
): TimeReportWorklog => ({ id, userId, day, issueKey, timeSpentSeconds: hours * 3600 });
const report = (patch: Partial<TimeReportInput> = {}) =>
  buildTimeReport({ weekStart, users, worklogs: [], dayOffs: [], ...patch });
describe("Time Report agreed calculations", () => {
  it("uses a 40h base, removes 8h per unique weekday off, and divides team sums", () => {
    const result = report({
      dayOffs: [
        { userId: "a", date: weekStart },
        { userId: "a", date: weekStart },
      ],
      worklogs: [log("1", "a", "2026-10-27", 32), log("2", "b", weekStart, 20)],
    });
    expect(result.employees[0]).toMatchObject({
      loggedSeconds: 32 * 3600,
      expectedSeconds: 32 * 3600,
      utilizationPercent: 100,
      missingSeconds: 0,
      overtimeSeconds: 0,
    });
    expect(result.employees[1]).toMatchObject({
      expectedSeconds: 40 * 3600,
      utilizationPercent: 50,
      missingSeconds: 20 * 3600,
    });
    expect(result.team.utilizationPercent).toBeCloseTo((52 / 72) * 100);
    expect(result.team.utilizationPercent).not.toBe(75);
  });
  it("returns N/A as null for zero expected even with externally logged time", () => {
    const dates = [26, 27, 28, 29, 30].map((day) => `2026-10-${day}`);
    const result = report({
      users: [users[0]!],
      dayOffs: dates.map((date) => ({ userId: "a", date })),
      worklogs: [log("1", "a", weekStart, 2)],
    });
    expect(result.employees[0]).toMatchObject({
      expectedSeconds: 0,
      utilizationPercent: null,
      loggedSeconds: 7200,
      overtimeSeconds: 7200,
    });
    expect(result.employees[0]!.days[0]).toMatchObject({
      dayOff: true,
      conflict: true,
      loggedSeconds: 7200,
    });
    expect(result.team.utilizationPercent).toBeNull();
  });
  it("counts Saturday and Sunday worklogs without reducing capacity for a weekend Day Off", () => {
    const result = report({
      users: [users[0]!],
      worklogs: [log("1", "a", "2026-10-31", 3), log("2", "a", "2026-11-01", 2)],
      dayOffs: [{ userId: "a", date: "2026-10-31" }],
    });
    expect(result.days).toHaveLength(7);
    expect(result.employees[0]).toMatchObject({
      loggedSeconds: 18000,
      expectedSeconds: 144000,
    });
    expect(result.employees[0]!.issues[0]!.loggedSeconds).toBe(18000);
  });
  it("retains zero-duration worklogs as conflicts and never mutates input", () => {
    const worklogs = [log("1", "a", weekStart, 0)];
    const dayOffs = [{ userId: "a", date: weekStart }];
    const original = JSON.stringify({ worklogs, dayOffs });
    const result = report({ worklogs, dayOffs });
    expect(result.employees[0]!.days[0]).toMatchObject({
      conflict: true,
      worklogCount: 1,
    });
    expect(result.team.days[0]!.conflictCount).toBe(1);
    expect(JSON.stringify({ worklogs, dayOffs })).toBe(original);
  });
  it("deduplicates identical worklogs, rejects differing copies, and filters period and users", () => {
    const first = log("1", "a", weekStart, 1);
    expect(
      report({
        worklogs: [
          first,
          { ...first },
          log("2", "a", "2026-10-25", 5),
          log("3", "other", weekStart, 6),
        ],
      }).team.loggedSeconds,
    ).toBe(3600);
    expect(() =>
      report({ worklogs: [first, { ...first, timeSpentSeconds: 2 }] }),
    ).toThrow("Conflicting duplicate");
  });
  it("groups all supplied Jira issues and gives members without worklogs their full capacity", () => {
    const result = report({
      worklogs: [
        log("1", "a", weekStart, 1, "OTHER-2"),
        log("2", "a", weekStart, 2, "ADMIN-1"),
      ],
    });
    expect(result.employees[0]!.issues.map((issue) => issue.issueKey)).toEqual([
      "ADMIN-1",
      "OTHER-2",
    ]);
    expect(result.employees[1]!.issues).toEqual([]);
    expect(result.employees[1]!.expectedSeconds).toBe(144000);
    expect(result.team.loggedSeconds).toBe(10800);
  });
  it("validates real calendar dates, Monday boundaries, durations, and user uniqueness", () => {
    expect(() => report({ weekStart: "2026-02-30" })).toThrow("Invalid calendar date");
    expect(() => report({ weekStart: "2026-10-27" })).toThrow("Monday");
    expect(() => report({ dayOffs: [{ userId: "a", date: "2026-02-30" }] })).toThrow(
      "Invalid calendar date",
    );
    expect(() => report({ worklogs: [log("1", "a", weekStart, -1)] })).toThrow(
      "Invalid Time Report worklog",
    );
    expect(() => report({ users: [users[0]!, users[0]!] })).toThrow("unique");
  });
  it("returns N/A for an empty team", () => {
    expect(report({ users: [] }).team).toMatchObject({
      loggedSeconds: 0,
      expectedSeconds: 0,
      utilizationPercent: null,
    });
  });
});

describe("Time Report monthly periods", () => {
  it.each([
    ["2026-02-01", 28, "2026-02-28", 20],
    ["2028-02-01", 29, "2028-02-29", 21],
    ["2026-04-01", 30, "2026-04-30", 22],
    ["2026-12-01", 31, "2026-12-31", 23],
  ])(
    "uses the exact calendar month and weekday capacity for %s",
    (anchor, count, last, weekdays) => {
      const result = report({ weekStart: anchor, periodMode: "month" });
      expect(result.days).toHaveLength(count);
      expect(result.days[0]).toBe(anchor);
      expect(result.days.at(-1)).toBe(last);
      expect(result.team).toMatchObject({
        expectedSeconds: weekdays * 8 * 3600 * users.length,
        utilizationPercent: 0,
        missingSeconds: weekdays * 8 * 3600 * users.length,
        overtimeSeconds: 0,
      });
    },
  );
  it("includes first/last month days across issues and subtracts weekday Day Off from capacity", () => {
    const result = report({
      weekStart: "2026-11-01",
      periodMode: "month",
      worklogs: [
        log("1", "a", "2026-11-01", 2),
        log("2", "a", "2026-11-30", 3, "OTHER-2"),
        log("3", "a", "2026-10-31", 10),
        log("4", "a", "2026-12-01", 10),
        log("5", "b", "2026-11-15", 1),
      ],
      dayOffs: [{ userId: "a", date: "2026-11-30" }],
    });
    expect(result.team.loggedSeconds).toBe(6 * 3600);
    expect(result.employees[0]).toMatchObject({
      loggedSeconds: 5 * 3600,
      expectedSeconds: 160 * 3600,
      utilizationPercent: 3.125,
      missingSeconds: 155 * 3600,
      overtimeSeconds: 0,
    });
    expect(result.employees[0]!.days.at(-1)).toMatchObject({
      dayOff: true,
      conflict: true,
      loggedSeconds: 3 * 3600,
    });
    expect(result.employees[0]!.issues).toHaveLength(2);
  });
  it("subtracts unique weekday days off only, and computes monthly team utilization from sums", () => {
    const result = report({
      weekStart: "2026-11-01",
      periodMode: "month",
      dayOffs: [
        { userId: "a", date: "2026-11-02" },
        { userId: "a", date: "2026-11-02" },
        { userId: "a", date: "2026-11-01" },
        { userId: "a", date: "2026-10-30" },
      ],
      worklogs: [log("1", "a", "2026-11-01", 8), log("2", "b", "2026-11-03", 16)],
    });
    expect(result.employees.map((row) => row.expectedSeconds)).toEqual([
      160 * 3600,
      168 * 3600,
    ]);
    expect(result.team.expectedSeconds).toBe(328 * 3600);
    expect(result.team.utilizationPercent).toBeCloseTo((24 / 328) * 100);
  });
  it("returns N/A utilization for a month with all weekdays off without deleting external hours", () => {
    const dates = [2, 9, 16, 23].flatMap((start) =>
      Array.from(
        { length: 5 },
        (_, offset) => `2026-02-${String(start + offset).padStart(2, "0")}`,
      ),
    );
    const result = report({
      weekStart: "2026-02-01",
      periodMode: "month",
      users: [users[0]!],
      dayOffs: dates.map((date) => ({ userId: "a", date })),
      worklogs: [log("1", "a", "2026-02-02", 2)],
    });
    expect(result.team).toMatchObject({
      expectedSeconds: 0,
      loggedSeconds: 7200,
      utilizationPercent: null,
      overtimeSeconds: 7200,
    });
    expect(result.employees[0]!.days[1]!.conflict).toBe(true);
  });
  it("requires first-of-month anchors and rejects unsupported modes", () => {
    expect(() => report({ weekStart: "2026-11-02", periodMode: "month" })).toThrow(
      "first day",
    );
    expect(() => report({ periodMode: "quarter" as "month" })).toThrow("period mode");
  });
});
