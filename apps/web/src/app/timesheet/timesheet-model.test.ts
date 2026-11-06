import { describe, expect, it, vi } from "vitest";
import { WorklogIdentityError } from "@power-view/jira-client";
import {
  adjacentPeriod,
  dayInZone,
  discoveryJql,
  duration,
  jqlFilter,
  loadTimesheet,
  localTimeChoices,
  parseDuration,
  periodDays,
  sumWorklogs,
  timesheetRows,
  type TimesheetQuery,
} from "./timesheet-model";
import { testApi, testIssue, testLog } from "./test-fixtures";
const query = (): TimesheetQuery => ({
  days: periodDays("2026-10-27", "week"),
  timeZone: "Europe/Kyiv",
  projectIds: [],
  explicitJql: "",
});
const run = (api = testApi(), q = query(), known = [testIssue]) =>
  loadTimesheet(api, q, "me", known, new AbortController().signal, vi.fn());

describe("Timesheet calendar", () => {
  it("uses full Monday weeks and leap months without month rollover", () => {
    expect(periodDays("2027-01-01", "week")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(periodDays("2028-02-29", "month")).toHaveLength(29);
    expect(adjacentPeriod("2026-01-31", "month", 1)).toBe("2026-02-01");
  });
  it("resolves repeated and nonexistent local DST times", () => {
    expect(localTimeChoices("2026-03-29", "03:30", "Europe/Kyiv")).toEqual([]);
    expect(localTimeChoices("2026-10-25", "03:30", "Europe/Kyiv")).toEqual([
      "2026-10-25T00:30:00.000Z",
      "2026-10-25T01:30:00.000Z",
    ]);
    expect(localTimeChoices("2026-02-30", "09:00", "UTC")).toEqual([]);
  });
  it("assigns dates with the selected zone, not the OS offset", () => {
    expect(dayInZone("2026-10-24T21:30:00Z", "Europe/Kyiv")).toBe("2026-10-25");
    expect(dayInZone("2026-10-25T22:30:00Z", "Europe/Kyiv")).toBe("2026-10-26");
  });
  it("accepts explicit hours/minutes and rejects ambiguous inputs", () => {
    ["1h 30m", "90m", "1:30"].forEach((value) => expect(parseDuration(value)).toBe(5400));
    ["0m", "90", "1.5", "-1h", "1:60", "1d", "3w", "1m 30s", "999999999h"].forEach(
      (value) => expect(parseDuration(value)).toBeUndefined(),
    );
  });
});
describe("Personal issue discovery", () => {
  it("keeps Setup opt-in, strips only a real ORDER BY and widens date discovery", () => {
    expect(jqlFilter('summary ~ "order by" ORDER BY Rank ASC')).toBe(
      'summary ~ "order by"',
    );
    const result = discoveryJql(query(), {
      accountId: "me",
      displayName: "Alex",
      timeZone: "Europe/Kyiv",
    });
    expect(result.jql).toBe(
      'worklogAuthor = currentUser() AND worklogDate >= "2026-10-24" AND worklogDate < "2026-11-04"',
    );
    expect(discoveryJql(query(), { accountId: "me", displayName: "Alex" }).jql).toBe(
      "worklogAuthor = currentUser()",
    );
    const q = {
      ...query(),
      projectIds: ["100", "200"],
      explicitJql: "filter = 77 ORDER BY Rank ASC",
    };
    expect(discoveryJql(q, { accountId: "me", displayName: "Alex" }).jql).toBe(
      "worklogAuthor = currentUser() AND project in (100,200) AND (filter = 77)",
    );
  });
  it("reads every search page and worklog only for candidates and known issues", async () => {
    const api = testApi();
    const other = { ...testIssue, id: "2", key: "OTHER-2", projectId: "200" };
    api.search
      .mockResolvedValueOnce({
        issues: [testIssue],
        isLast: false,
        nextPageToken: "page2",
      })
      .mockResolvedValueOnce({ issues: [other], isLast: true });
    const result = await run(api);
    expect(api.search.mock.calls[1]?.[1]).toBe("page2");
    expect(api.getWorklogs).toHaveBeenCalledTimes(2);
    expect(result.coverage).toBe("jql-limited");
    expect(result.candidateIssueCount).toBe(2);
  });
  it("stops cyclic pagination instead of claiming complete selection", async () => {
    const api = testApi();
    api.search.mockResolvedValue({
      issues: [testIssue],
      isLast: false,
      nextPageToken: "repeat",
    });
    await expect(run(api)).rejects.toThrow("pagination was incomplete");
  });
  it("bypasses worklog discovery for a manually known issue", async () => {
    const api = testApi();
    api.search.mockResolvedValue({ issues: [], isLast: true });
    const result = await run(api);
    expect(result.issues).toEqual([testIssue]);
    expect(api.getWorklogs).toHaveBeenCalledWith(testIssue, expect.any(AbortSignal));
    expect(result.coverage).toBe("jql-limited");
  });
  it("rechecks known issue membership against explicit filters", async () => {
    const api = testApi();
    api.search.mockResolvedValue({ issues: [], isLast: true });
    const result = await run(api, { ...query(), projectIds: ["200"] });
    expect(api.search).toHaveBeenLastCalledWith(
      "id in (1) AND project in (200)",
      undefined,
      expect.any(AbortSignal),
    );
    expect(api.getWorklogs).not.toHaveBeenCalled();
    expect(result.issues).toEqual([]);
  });
  it("marks issue failures partial without converting them to an empty success", async () => {
    const api = testApi();
    api.getWorklogs.mockRejectedValue(new Error("Forbidden"));
    const result = await run(api);
    expect(result.state).toBe("partial");
    expect(result.failedIssueIds).toEqual(["1"]);
    expect(result.loadedIssueCount).toBe(0);
  });
  it("rejects changed identity and cancellation", async () => {
    const api = testApi();
    api.getUser.mockResolvedValue({ accountId: "other", displayName: "Other" });
    await expect(run(api)).rejects.toBeInstanceOf(WorklogIdentityError);
    api.getUser.mockResolvedValue({ accountId: "me", displayName: "Alex" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadTimesheet(api, query(), "me", [], controller.signal, vi.fn()),
    ).rejects.toThrow();
  });
  it("filters each author/date, deduplicates and preserves seconds without subtask rollup", async () => {
    const api = testApi();
    const first = testLog("10", "2026-10-26T23:50:00+0200", 1801);
    api.getWorklogs.mockResolvedValue([
      first,
      first,
      testLog("11", first.started, 2700),
      { ...testLog("12", first.started), authorId: "someone-else" },
      testLog("13", "2026-11-02T00:00:00+0200"),
    ]);
    const result = await run(api);
    const rows = timesheetRows(result, query().days, query().timeZone);
    expect(rows).toHaveLength(1);
    expect(sumWorklogs(rows[0]!.cells.get("2026-10-26")!)).toBe(4501);
    expect(result.matchedWorklogCount).toBe(2);
    expect(duration(4501)).toBe("1h 15m 1s");
  });
});
