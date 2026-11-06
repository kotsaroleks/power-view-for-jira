import { describe, expect, it } from "vitest";
import { timeZoneWarning } from "./time-zone-warning";
import { periodDays } from "./timesheet-model";

describe("Jira author time zone warning", () => {
  it("accepts Kyiv and exactly one hour either side", () => {
    for (const zone of ["Europe/Kyiv", "Europe/Warsaw", "Europe/Moscow"]) {
      expect(timeZoneWarning(zone, ["2026-11-02"])).toBeUndefined();
    }
  });
  it("warns for Los Angeles and fractional offsets beyond the limit", () => {
    for (const zone of ["America/Los_Angeles", "Asia/Kolkata"]) {
      expect(timeZoneWarning(zone, ["2026-11-02"])).toContain(zone);
    }
  });
  it("uses the selected dates and detects a DST change within the period", () => {
    expect(timeZoneWarning("UTC", ["2026-01-15"])).toBeDefined();
    expect(timeZoneWarning("Europe/London", ["2026-03-28", "2026-03-29"])).toBeDefined();
    expect(timeZoneWarning("Africa/Lagos", ["2026-03-28"])).toBeUndefined();
    expect(timeZoneWarning("Africa/Lagos", ["2026-03-28", "2026-03-29"])).toBeDefined();
  });
  it("does not invent a mismatch for missing or invalid profiles", () => {
    expect(timeZoneWarning(undefined, ["2026-11-02"])).toBeUndefined();
    expect(timeZoneWarning("invalid", ["2026-11-02"])).toBeUndefined();
    expect(timeZoneWarning("America/Los_Angeles", [])).toBeUndefined();
  });

  it.each([
    ["Europe/Kyiv", "2026-11-02"],
    ["Europe/Kiev", "2026-07-01"],
    ["Europe/Berlin", "2026-11-02"],
    ["Europe/Berlin", "2026-07-01"],
    ["Europe/Moscow", "2026-11-02"],
    ["Europe/Samara", "2026-07-01"],
  ])("accepts %s within the inclusive ±1h limit on %s", (zone, day) => {
    expect(timeZoneWarning(zone, [day])).toBeUndefined();
  });

  it.each([
    ["America/Los_Angeles", "2026-11-02", "−10h"],
    ["America/Los_Angeles", "2026-10-26", "−9h"],
    ["Europe/Samara", "2026-11-02", "+2h"],
    ["Asia/Kolkata", "2026-11-02", "+3h 30m"],
    ["Asia/Kolkata", "2026-07-01", "+2h 30m"],
    ["Pacific/Kiritimati", "2026-11-02", "+12h"],
    ["Pacific/Honolulu", "2026-11-02", "−12h"],
  ])("reports the signed difference for %s on %s", (zone, day, expected) => {
    expect(timeZoneWarning(zone, [day])).toContain(
      `${zone} (${expected} relative to Europe/Kyiv`,
    );
  });

  it("checks the whole period when DST moves the difference across the limit", () => {
    expect(timeZoneWarning("Europe/Samara", ["2026-03-29"])).toBeUndefined();
    expect(timeZoneWarning("Europe/Samara", periodDays("2026-03-29", "week"))).toContain(
      "+1h to +2h relative to Europe/Kyiv",
    );
    expect(
      timeZoneWarning("America/Los_Angeles", periodDays("2026-10-01", "month")),
    ).toContain("−10h to −9h relative to Europe/Kyiv");
  });
});
