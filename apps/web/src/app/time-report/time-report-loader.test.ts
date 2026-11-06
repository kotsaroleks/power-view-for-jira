import { describe, expect, it } from "vitest";
import { WorklogIdentityError } from "@power-view/jira-client";
import { periodDays } from "../timesheet/timesheet-model";
import { testApi, testIssue, testLog } from "../timesheet/test-fixtures";
import { loadTimeReport, type TimeReportQuery } from "./time-report-loader";

const query = (): TimeReportQuery => ({
  accountIds: ["me", "colleague"],
  days: periodDays("2026-10-26", "week"),
  timeZone: "Europe/Kyiv",
});
const run = (
  api = testApi(),
  selection = query(),
  signal = new AbortController().signal,
) => loadTimeReport(api, selection, "me", signal);

const expectedJql =
  'worklogAuthor in ("me", "colleague") AND worklogDate >= "2026-10-24" AND worklogDate < "2026-11-04" ORDER BY id ASC';

describe("Time Report targeted worklog discovery", () => {
  it("reads a complete leap February with timezone-safe discovery and exact month boundaries", async () => {
    const api = testApi();
    api.getWorklogs.mockResolvedValue([
      testLog("before", "2028-01-31T21:59:59Z"),
      testLog("first", "2028-01-31T22:00:00Z"),
      testLog("leap", "2028-02-29T21:59:59Z"),
      testLog("after", "2028-02-29T22:00:00Z"),
    ]);
    const result = await run(api, {
      ...query(),
      periodMode: "month",
      days: periodDays("2028-02-15", "month"),
    });
    expect(result.worklogs.map((log) => log.id)).toEqual(["first", "leap"]);
    expect(result.discoveryJql).toBe(
      'worklogAuthor in ("me", "colleague") AND worklogDate >= "2028-01-30" AND worklogDate < "2028-03-03" ORDER BY id ASC',
    );
  });

  it.each(["2027-02-01", "2026-04-01", "2026-12-01"])(
    "accepts the full calendar month containing %s",
    async (anchor) => {
      const api = testApi();
      api.getWorklogs.mockResolvedValue([]);
      const result = await run(api, {
        ...query(),
        periodMode: "month",
        days: periodDays(anchor, "month"),
      });
      expect(result.state).toBe("ready");
      expect(api.search).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects truncated, shifted, gapped, duplicated and impossible calendar months before reads", async () => {
    const february = periodDays("2028-02-01", "month");
    const invalid = [
      [],
      february.slice(0, -1),
      february.slice(1),
      [...february, "2028-03-01"],
      february.map((day, index) => (index === 10 ? "2028-02-12" : day)),
      [...february.slice(0, -1), "2028-02-30"],
    ];
    for (const days of invalid) {
      const api = testApi();
      await expect(run(api, { ...query(), periodMode: "month", days })).rejects.toThrow(
        "complete calendar month",
      );
      expect(api.getUser).not.toHaveBeenCalled();
    }
    const api = testApi();
    await expect(run(api, { ...query(), days: february })).rejects.toThrow("Monday");
    expect(api.getUser).not.toHaveBeenCalled();
  });

  it("keeps escaped long author IDs within the request size limit", async () => {
    const api = testApi();
    const accountIds = Array.from(
      { length: 50 },
      (_, index) => `${index}${'"'.repeat(250)}`,
    );
    api.search.mockResolvedValue({ issues: [], isLast: true });
    await run(api, { ...query(), accountIds });
    expect(api.search.mock.calls.length).toBeGreaterThan(1);
    for (const [jql] of api.search.mock.calls)
      expect(jql.length).toBeLessThanOrEqual(10_000);
  });
  it("limits discovery to selected authors and a timezone-safe week envelope without restricting issue age", async () => {
    const api = testApi();
    api.search.mockImplementation((jql) => {
      if (jql !== expectedJql)
        return Promise.reject(new Error("Unbounded JQL queries are not allowed here."));
      return Promise.resolve({ issues: [testIssue], isLast: true });
    });
    api.getWorklogs.mockResolvedValue([
      testLog("old-issue-log", "2026-10-26T09:00:00Z", 3600),
    ]);
    const result = await run(api);
    expect(result.state).toBe("ready");
    expect(result.worklogs).toHaveLength(1);
    expect(result.discoveryJql).toBe(expectedJql);
    expect(result.discoveryJql).not.toMatch(/project|board|assignee|created/i);
    expect(result.coverage).toBe("jql-limited");
    expect(result.coverageNotice).toContain("latest 1,000 worklogs");
    expect(result.coverageNotice).toContain("complete coverage is not guaranteed");
  });
  it("reads every matching issue page, including unrelated projects, without board filters", async () => {
    const api = testApi();
    const other = { ...testIssue, id: "2", key: "ADMIN-2", projectId: "200" };
    api.search
      .mockResolvedValueOnce({
        issues: [testIssue],
        isLast: false,
        nextPageToken: "second",
      })
      .mockResolvedValueOnce({ issues: [other], isLast: true });
    api.getWorklogs.mockImplementation((issue) =>
      Promise.resolve([
        {
          ...testLog(issue.id, "2026-10-26T10:00:00Z", 3600),
          issueId: issue.id,
          issueKey: issue.key,
        },
      ]),
    );
    const result = await run(api);
    expect(api.search.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [expectedJql, undefined],
      [expectedJql, "second"],
    ]);
    expect(result.worklogs.map((log) => log.issueKey)).toEqual(["PV-1", "ADMIN-2"]);
    expect(result.coverage).toBe("jql-limited");
    expect(result.coverageNotice).toContain("permissions");
    expect(result.state).toBe("ready");
  });

  it("batches unique authors at 50 and fetches repeated issue candidates only once", async () => {
    const api = testApi();
    const accountIds = Array.from({ length: 51 }, (_, index) => `author-${index}`);
    accountIds.push(accountIds[0]!);
    await run(api, { ...query(), accountIds });
    expect(api.search).toHaveBeenCalledTimes(2);
    const first = api.search.mock.calls[0]![0];
    const second = api.search.mock.calls[1]![0];
    expect(first).toContain('"author-0"');
    expect(first).toContain('"author-49"');
    expect(first).not.toContain('"author-50"');
    expect(second).toBe(
      'worklogAuthor in ("author-50") AND worklogDate >= "2026-10-24" AND worklogDate < "2026-11-04" ORDER BY id ASC',
    );
    expect(api.getWorklogs).toHaveBeenCalledTimes(1);
  });

  it("escapes author IDs as JQL string values and rejects control characters or oversized IDs", async () => {
    const api = testApi();
    await run(api, { ...query(), accountIds: ['account"\\suffix'] });
    expect(api.search.mock.calls[0]![0]).toContain(
      'worklogAuthor in ("account\\"\\\\suffix")',
    );
    for (const id of ["bad\naccount", "bad\u007faccount", "x".repeat(256)]) {
      const invalid = testApi();
      await expect(run(invalid, { ...query(), accountIds: [id] })).rejects.toThrow(
        "roster",
      );
      expect(invalid.getUser).not.toHaveBeenCalled();
    }
  });

  it("does not fall back to a site-wide scan when targeted discovery fails", async () => {
    const api = testApi();
    api.search.mockRejectedValue(new Error("Worklog search is unavailable"));
    await expect(run(api)).rejects.toThrow("Worklog search is unavailable");
    expect(api.search).toHaveBeenCalledTimes(1);
    expect(api.search.mock.calls[0]![0]).toBe(expectedJql);
    expect(api.getWorklogs).not.toHaveBeenCalled();
  });

  it("filters by exact selected author and local day, retains weekends and deduplicates identical logs", async () => {
    const api = testApi();
    const valid = testLog("1", "2026-10-25T22:30:00Z", 3600);
    api.getWorklogs.mockResolvedValue([
      valid,
      valid,
      testLog("2", "2026-11-01T21:59:00Z", 1800),
      testLog("3", "2026-11-01T22:00:00Z", 1800),
      testLog("4", "2026-10-25T21:59:00Z", 1800),
      { ...testLog("5", valid.started), authorId: "outsider" },
      { ...testLog("6", valid.started), authorId: "colleague" },
    ]);
    const result = await run(api);
    expect(result.worklogs.map((log) => log.id)).toEqual(["1", "2", "6"]);
  });

  it("returns explicitly partial coverage on individual issue failures", async () => {
    const api = testApi();
    api.getWorklogs.mockRejectedValue(new Error("Permission denied"));
    const result = await run(api);
    expect(result.state).toBe("partial");
    expect(result.failedIssueIds).toEqual(["1"]);
    expect(result.reasons).toEqual(["PV-1: Permission denied"]);
    expect(result.worklogs).toEqual([]);
  });

  it("rejects incomplete issue pagination rather than returning plausible totals", async () => {
    const api = testApi();
    api.search.mockResolvedValue({
      issues: [testIssue],
      isLast: false,
      nextPageToken: "same",
    });
    await expect(run(api)).rejects.toThrow("pagination was incomplete");
    expect(api.getWorklogs).not.toHaveBeenCalled();
  });

  it("checks viewer identity both before and after loading", async () => {
    const api = testApi();
    api.getUser.mockResolvedValueOnce({ accountId: "other", displayName: "Other" });
    await expect(run(api)).rejects.toBeInstanceOf(WorklogIdentityError);
    expect(api.search).not.toHaveBeenCalled();
    api.getUser
      .mockResolvedValueOnce({ accountId: "me", displayName: "Me" })
      .mockResolvedValueOnce({ accountId: "other", displayName: "Other" });
    await expect(run(api)).rejects.toBeInstanceOf(WorklogIdentityError);
  });

  it("honors cancellation before and during reads without returning a completed result", async () => {
    const api = testApi();
    const controller = new AbortController();
    controller.abort();
    await expect(run(api, query(), controller.signal)).rejects.toThrow();
    expect(api.getUser).not.toHaveBeenCalled();
    const active = new AbortController();
    api.getWorklogs.mockImplementation(() => {
      active.abort();
      return Promise.resolve([]);
    });
    await expect(run(api, query(), active.signal)).rejects.toThrow();
  });

  it("rejects unsupported roster, calendar and time zone selections before requests", async () => {
    const api = testApi();
    await expect(run(api, { ...query(), accountIds: [] })).rejects.toThrow("roster");
    await expect(run(api, { ...query(), days: ["2026-02-30"] })).rejects.toThrow(
      "Monday",
    );
    await expect(run(api, { ...query(), timeZone: "invalid-zone" })).rejects.toThrow();
    expect(api.getUser).not.toHaveBeenCalled();
  });

  it("marks conflicting worklog copies as partial rather than silently replacing hours", async () => {
    const api = testApi();
    const log = testLog("1", "2026-10-26T10:00:00Z", 3600);
    api.getWorklogs.mockResolvedValue([log, { ...log, timeSpentSeconds: 7200 }]);
    const result = await run(api);
    expect(result.state).toBe("partial");
    expect(result.worklogs).toEqual([]);
  });
});
