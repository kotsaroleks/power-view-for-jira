import type { JiraTransportRequest } from "@power-view/extension-messaging";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { JiraTransport } from "./JiraTransport";
import {
  CloudTimesheetClient,
  plainTextComment,
  UnknownWorklogOutcomeError,
  WorklogConflictError,
  WorklogIdentityError,
} from "./TimesheetClient";
import { JiraClientError } from "./errors";
const baseUrl = "https://example.atlassian.net";
const issue = {
  id: "1",
  key: "PV-1",
  summary: "Task",
  projectId: "100",
  projectKey: "PV",
};
const rawIssue = {
  id: "1",
  key: "PV-1",
  fields: { summary: "Task", project: { id: "100", key: "PV" } },
};
const rawLog = {
  id: "10",
  issueId: "1",
  author: { accountId: "me" },
  started: "2026-10-29T09:00:00.000+0200",
  timeSpentSeconds: 1801,
  updated: "2026-10-29T10:00:00Z",
  comment: plainTextComment("Review\nTests"),
};
function fixture(handler: (request: JiraTransportRequest) => unknown = () => rawLog) {
  const request = vi.fn(async <T>(req: JiraTransportRequest, schema: z.ZodType<T>) =>
    schema.parse(await handler(req)),
  );
  const client = new CloudTimesheetClient(
    { request: request as unknown as JiraTransport["request"] },
    baseUrl,
  );
  return { client, request };
}
const input = { started: rawLog.started, timeSpentSeconds: rawLog.timeSpentSeconds };
describe("Cloud Timesheet API contracts", () => {
  it("uses minimal POST enhanced search and continuation without any board dependency", async () => {
    const { client, request } = fixture(() => ({
      issues: [rawIssue],
      isLast: false,
      nextPageToken: "next",
    }));
    expect(await client.search("worklogAuthor = currentUser()", "previous")).toEqual({
      issues: [issue],
      isLast: false,
      nextPageToken: "next",
    });
    expect(request.mock.calls[0]?.[0]).toEqual({
      baseUrl,
      method: "POST",
      path: "/rest/api/3/search/jql",
      body: {
        jql: "worklogAuthor = currentUser()",
        fields: ["summary", "project"],
        maxResults: 100,
        nextPageToken: "previous",
      },
    });
  });
  it("drains worklog pages and rejects empty, repeated, malformed or cross-issue records", async () => {
    const { client, request } = fixture((req) => ({
      worklogs: [req.query?.startAt === 0 ? rawLog : { ...rawLog, id: "11" }],
      startAt: req.query?.startAt,
      total: 2,
    }));
    const logs = await client.getWorklogs(issue);
    expect(logs.map((log) => log.id)).toEqual(["10", "11"]);
    expect(logs[0]?.commentText).toBe("Review\nTests");
    expect(request.mock.calls[1]?.[0].query).toEqual({ startAt: 1, maxResults: 100 });
    await expect(
      fixture(() => ({ worklogs: [], startAt: 0, total: 1 })).client.getWorklogs(issue),
    ).rejects.toThrow("pagination was incomplete");
    await expect(
      fixture(() => ({
        worklogs: [{ ...rawLog, issueId: "2" }],
        startAt: 0,
        total: 1,
      })).client.getWorklogs(issue),
    ).rejects.toThrow("different issue");
    await expect(
      fixture(() => ({
        worklogs: [{ ...rawLog, author: {} }],
        startAt: 0,
        total: 1,
      })).client.getWorklogs(issue),
    ).rejects.toThrow();
  });
  it("creates without author, preserves estimate and returns exact seconds", async () => {
    const { client, request } = fixture((req) =>
      req.path.endsWith("myself") ? { accountId: "me", displayName: "Alex" } : rawLog,
    );
    expect((await client.saveWorklog(issue, input, "me")).timeSpentSeconds).toBe(1801);
    expect(request.mock.calls.at(-1)?.[0]).toEqual({
      baseUrl,
      method: "POST",
      path: "/rest/api/3/issue/PV-1/worklog",
      query: { adjustEstimate: "leave" },
      body: input,
    });
  });
  it.each([
    ["2026-11-02T07:00:00.000Z", "2026-11-02T07:00:00.000+0000"],
    ["2026-11-02T07:00:00Z", "2026-11-02T07:00:00.000+0000"],
    ["2026-11-02T09:00:00.000+02:00", "2026-11-02T09:00:00.000+0200"],
    ["2026-11-02T01:30:00.125-05:30", "2026-11-02T01:30:00.125-0530"],
    ["2026-11-02T09:00:00.123+0200", "2026-11-02T09:00:00.123+0200"],
  ])(
    "serializes worklog start %s in Jira's numeric offset format",
    async (started, expected) => {
      const { client, request } = fixture((req) => {
        if (req.path.endsWith("myself")) return { accountId: "me", displayName: "Alex" };
        const body = req.body as { started: string; timeSpentSeconds: number };
        // Model Jira's strict write parser, which permissive response fixtures missed.
        if (!/\.\d{3}[+-]\d{4}$/.test(body.started))
          throw new Error("Invalid started format");
        return {
          ...rawLog,
          started: body.started,
          timeSpentSeconds: body.timeSpentSeconds,
        };
      });
      const saved = await client.saveWorklog(
        issue,
        { started, timeSpentSeconds: 28800 },
        "me",
      );
      expect(request.mock.calls.at(-1)?.[0].body).toEqual({
        started: expected,
        timeSpentSeconds: 28800,
      });
      expect(Date.parse(saved.started)).toBe(Date.parse(started));
      expect(saved.timeSpentSeconds).toBe(28800);
      expect(request.mock.calls.filter(([req]) => req.method === "POST")).toHaveLength(1);
    },
  );
  it("rereads identity and version before editing or deleting; leaves comment untouched", async () => {
    const { client, request } = fixture((req) =>
      req.path.endsWith("myself")
        ? { accountId: "me", displayName: "Alex" }
        : req.method === "DELETE"
          ? null
          : rawLog,
    );
    const original = await client.getWorklog(issue, "10");
    request.mockClear();
    await client.saveWorklog(issue, input, "me", original);
    expect(request.mock.calls.map(([req]) => req.method)).toEqual(["GET", "GET", "PUT"]);
    expect(request.mock.calls.at(-1)?.[0].body).toEqual(input);
    request.mockClear();
    await client.deleteWorklog(issue, original, "me");
    expect(request.mock.calls.map(([req]) => req.method)).toEqual([
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(request.mock.calls.at(-1)?.[0].query).toEqual({ adjustEstimate: "leave" });
  });
  it("blocks changed accounts, another author, and changed versions before a write", async () => {
    const original = await fixture().client.getWorklog(issue, "10");
    const identity = fixture(() => ({ accountId: "other", displayName: "Other" }));
    await expect(identity.client.saveWorklog(issue, input, "me")).rejects.toBeInstanceOf(
      WorklogIdentityError,
    );
    const changed = fixture((req) =>
      req.path.endsWith("myself")
        ? { accountId: "me", displayName: "Alex" }
        : { ...rawLog, timeSpentSeconds: 999 },
    );
    await expect(
      changed.client.deleteWorklog(issue, original, "me"),
    ).rejects.toBeInstanceOf(WorklogConflictError);
    expect(changed.request.mock.calls.every(([req]) => req.method === "GET")).toBe(true);
    const other = fixture((req) =>
      req.path.endsWith("myself")
        ? { accountId: "me", displayName: "Alex" }
        : { ...rawLog, author: { accountId: "other" } },
    );
    await expect(
      other.client.saveWorklog(issue, input, "me", original),
    ).rejects.toBeInstanceOf(WorklogIdentityError);
  });
  it("never repeats uncertain writes and distinguishes explicit Jira rejections", async () => {
    const uncertain = fixture((req) => {
      if (req.path.endsWith("myself")) return { accountId: "me", displayName: "Alex" };
      throw new Error("Connection lost after send");
    });
    await expect(uncertain.client.saveWorklog(issue, input, "me")).rejects.toBeInstanceOf(
      UnknownWorklogOutcomeError,
    );
    expect(
      uncertain.request.mock.calls.filter(([req]) => req.method === "POST"),
    ).toHaveLength(1);
    const denied = fixture((req) => {
      if (req.path.endsWith("myself")) return { accountId: "me", displayName: "Alex" };
      throw new JiraClientError({
        code: "PERMISSION_DENIED",
        message: "Forbidden",
        retryable: false,
        httpStatus: 403,
      });
    });
    await expect(denied.client.saveWorklog(issue, input, "me")).rejects.toThrow(
      "Forbidden",
    );
  });
});

describe("Worklog board selection API", () => {
  const pickerIssue = {
    ...rawIssue,
    fields: {
      ...rawIssue.fields,
      issuetype: { name: "Story", subtask: false, hierarchyLevel: 0 },
      assignee: { accountId: "me" },
      parent: { key: "PV-99" },
    },
  };
  it("paginates boards and searches the selected board filter with minimal hierarchy fields", async () => {
    const { client, request } = fixture((req) => {
      if (req.path === "/rest/agile/1.0/board")
        return req.query?.startAt === 0
          ? { values: [{ id: 7, name: "Alpha" }], startAt: 0, isLast: false }
          : { values: [{ id: 8, name: "Beta" }], startAt: 1, isLast: true };
      if (req.path.endsWith("/configuration")) return { filter: { id: "42" } };
      const body = req.body as { nextPageToken?: string };
      return body.nextPageToken
        ? { issues: [{ ...pickerIssue, id: "2", key: "PV-2" }], isLast: true }
        : { issues: [pickerIssue], nextPageToken: "next", isLast: false };
    });
    expect(await client.getWorklogBoards()).toEqual([
      { id: 7, name: "Alpha" },
      { id: 8, name: "Beta" },
    ]);
    const loaded = await client.getBoardPickerIssues(7);
    expect(loaded.map((value) => value.key)).toEqual(["PV-1", "PV-2"]);
    expect(loaded[0]).toMatchObject({
      assigneeId: "me",
      parentKey: "PV-99",
      typeName: "Story",
    });
    const calls = request.mock.calls.map(([req]) => req);
    expect(calls[3]?.body).toEqual({
      jql: "filter = 42 ORDER BY key ASC",
      fields: ["summary", "project", "issuetype", "assignee", "parent"],
      maxResults: 100,
    });
    expect(calls[4]?.body).toMatchObject({ nextPageToken: "next" });
    expect(calls.some((req) => req.path.includes("worklog"))).toBe(false);
  });
  it.each(["empty", "repeated token", "duplicate issue"])(
    "rejects incomplete pagination: %s",
    async (mode) => {
      let page = 0;
      const { client } = fixture((req) => {
        if (req.path.endsWith("/configuration")) return { filter: { id: "42" } };
        page += 1;
        return {
          issues:
            mode === "empty"
              ? []
              : [{ ...pickerIssue, id: mode === "duplicate issue" ? "1" : String(page) }],
          isLast: false,
          nextPageToken: "same",
        };
      });
      await expect(client.getBoardPickerIssues(7)).rejects.toThrow();
    },
  );
  it("fails explicitly if the board filter is unavailable", async () => {
    const { client } = fixture(() => ({ filter: {} }));
    await expect(client.getBoardPickerIssues(7)).rejects.toThrow();
  });
});
