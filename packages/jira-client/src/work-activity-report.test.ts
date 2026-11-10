import { describe, expect, it, vi } from "vitest";
import type { ReportingIssueSnapshot } from "@power-view/domain";
import type { JiraTransport } from "./JiraTransport";
import type { GetBoardIssuesRequest } from "./reporting-api";
import {
  collectWorkActivityReport,
  collectWorkActivitySource,
  type CollectWorkActivityInput,
} from "./work-activity-report";

const period = {
  date: "2026-11-10",
  start: "2026-11-09T06:00:00.000Z",
  end: "2026-11-10T06:00:00.000Z",
  timeZone: "Europe/Kyiv" as const,
};
function issue(id = "2", parent = "1"): ReportingIssueSnapshot {
  return {
    id,
    key: `TEST-${id}`,
    summary: `Task ${id}`,
    issueType: { id: "task", name: "Task" },
    status: { id: "review", name: "In Review" },
    assignee: { id: "owner", displayName: "Current owner" },
    browseUrl: `https://fixture.atlassian.net/browse/TEST-${id}`,
    sprintIds: [],
    ...(parent ? { parentId: parent, parentKey: `TEST-${parent}` } : {}),
  };
}
function entry(
  id: string,
  items: Array<Record<string, unknown>>,
  created = "2026-11-09T11:00:00.000Z",
) {
  return {
    id,
    created,
    author: { accountId: "actor", displayName: "Editor" },
    items,
  };
}
function setup() {
  const rows = [issue()];
  const client = {
    getCurrentUser: vi
      .fn()
      .mockResolvedValue({ accountId: "viewer", displayName: "Viewer" }),
    getBoard: vi.fn().mockResolvedValue({ id: "7", name: "TEST DATA" }),
    getBoardIssues: vi.fn().mockResolvedValue({
      values: rows,
      startAt: 0,
      maxResults: 100,
      total: 1,
      isLast: true,
    }),
    getReportIssue: vi.fn().mockResolvedValue(issue("1", "")),
    getSprint: vi.fn((id: string) =>
      Promise.resolve({
        id,
        name: id === "101" ? "Aria Sprint 3" : "Aria Sprint 4",
        state: "active" as const,
      }),
    ),
  };
  const histories = new Map([
    [
      "TEST-2:0",
      {
        startAt: 0,
        maxResults: 100,
        total: 2,
        isLast: true,
        values: [
          entry("10", [
            {
              fieldId: "status",
              field: "Status",
              fromString: "In Progress",
              toString: "In Review",
            },
            { fieldId: "assignee", fromString: "Editor", toString: "Current owner" },
          ]),
          entry("11", [
            {
              fieldId: "description",
              fromString: "private previous body",
              toString: "private new body",
            },
          ]),
        ],
      },
    ],
  ]);
  const transport: JiraTransport = {
    request: (req, schema) => {
      expect(req.method).toBe("GET");
      const key = req.path.split("/").at(-2)!;
      const page = histories.get(key + ":" + (req.query?.startAt ?? 0));
      if (!page) throw new Error("Unexpected history read");
      return Promise.resolve(schema.parse(page));
    },
  };
  const request = vi.spyOn(transport, "request");
  const input: CollectWorkActivityInput = {
    client,
    transport,
    jiraBaseUrl: "https://fixture.atlassian.net",
    boardId: "7",
    period,
    now: new Date("2026-11-11T02:00:00.000Z"),
    expectedUserId: "viewer",
  };
  return {
    client,
    request,
    histories,
    input,
    collect: () => collectWorkActivitySource(input),
  };
}

describe("Work activity report Jira collection", () => {
  it("reads current owner/status and complete history, retaining fixed dates during a late run", async () => {
    const { collect, client, request } = setup();
    const source = await collect();
    expect(source.period).toEqual(period);
    expect(source.events.map((event) => event.type)).toEqual([
      "status-changed",
      "assignee-changed",
      "description-changed",
    ]);
    expect(source.events[0]).toMatchObject({ actor: { displayName: "Editor" } });
    expect(source.issues.find((row) => row.id === "2")?.assignee?.displayName).toBe(
      "Current owner",
    );
    const requestToBoard = client.getBoardIssues.mock
      .calls[0]?.[0] as GetBoardIssuesRequest;
    expect(requestToBoard.jql).toContain('updated >= "2026-11-08 06:00"');
    expect(requestToBoard.fieldsOverride).toContain("status");
    expect(requestToBoard.fieldsOverride).toContain("assignee");
    expect(requestToBoard.fieldsOverride).toContain("parent");
    expect(requestToBoard.fieldsOverride).not.toContain("description");
    expect(requestToBoard.jql).not.toContain("updated <=");
    expect(client.getReportIssue).toHaveBeenCalledWith("TEST-1", undefined);
    expect(request).toHaveBeenCalledOnce();
    expect(JSON.stringify(source)).not.toContain("private previous body");
    expect(JSON.stringify(source)).not.toContain("private new body");
    expect(client.getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it("diffs raw complete sprint ID sets, ignores digits in names, and resolves changed names", async () => {
    const { collect, histories, client } = setup();
    histories.set("TEST-2:0", {
      startAt: 0,
      maxResults: 100,
      total: 1,
      isLast: true,
      values: [
        entry("12", [
          {
            field: "Sprint",
            fieldId: "customfield_10020",
            from: "100,101",
            to: "100,102",
            fromString: "Aria Sprint 2, Aria Sprint 3",
            toString: "Aria Sprint 2, Aria Sprint 4",
          },
        ]),
      ],
    });
    const source = await collect();
    expect(source.events).toMatchObject([
      { type: "sprint-removed", sprintId: "101", from: "Aria Sprint 3" },
      { type: "sprint-added", sprintId: "102", to: "Aria Sprint 4" },
    ]);
    expect(client.getSprint.mock.calls.map(([id]) => id).sort()).toEqual(["101", "102"]);
  });

  it("paginates until confirmed totals and excludes exact-end or worklog-only history", async () => {
    const { collect, histories, request } = setup();
    histories.set("TEST-2:0", {
      startAt: 0,
      maxResults: 1,
      total: 3,
      isLast: false,
      values: [entry("10", [{ fieldId: "status", toString: "In Review" }], period.start)],
    });
    histories.set("TEST-2:1", {
      startAt: 1,
      maxResults: 2,
      total: 3,
      isLast: true,
      values: [
        entry("11", [{ fieldId: "status", toString: "Done" }], period.end),
        entry("12", [{ field: "WorklogId", to: "9" }]),
      ],
    });
    const source = await collect();
    expect(source.events).toHaveLength(1);
    expect(source.events[0]?.occurredAt).toBe(period.start);
    expect(request.mock.calls.map(([req]) => req.query?.startAt)).toEqual([0, 1]);
  });

  it.each(["missing-total", "partial", "repeated", "changing-total", "invalid-time"])(
    "rejects %s history instead of declaring no changes",
    async (kind) => {
      const { collect, histories } = setup();
      const first = histories.get("TEST-2:0")!;
      if (kind === "missing-total") {
        delete (first as { total?: number }).total;
      } else if (kind === "partial") {
        first.total = 3;
      } else if (kind === "invalid-time") {
        first.values[0]!.created = "invalid";
      } else {
        first.values = first.values.slice(0, 1);
        first.isLast = false;
        histories.set("TEST-2:1", {
          startAt: 1,
          maxResults: 100,
          total: kind === "changing-total" ? 3 : 2,
          isLast: true,
          values: [first.values[0]!],
        });
      }
      await expect(collect()).rejects.toThrow(/history/);
    },
  );

  it("rejects sprint display names without raw identifiers rather than inventing IDs", async () => {
    const { collect, histories } = setup();
    histories.set("TEST-2:0", {
      startAt: 0,
      maxResults: 100,
      total: 1,
      isLast: true,
      values: [entry("13", [{ field: "Sprint", toString: "Aria Sprint 4" }])],
    });
    await expect(collect()).rejects.toThrow(/identifiers/);
  });

  it("rejects contradictory last-page metadata even when the numeric total was reached", async () => {
    const { collect, histories } = setup();
    histories.get("TEST-2:0")!.isLast = false;
    await expect(collect()).rejects.toThrow(/history/);
  });

  it("preserves an explicit unassignment when Jira omits the destination text", async () => {
    const { collect, histories } = setup();
    histories.set("TEST-2:0", {
      startAt: 0,
      maxResults: 100,
      total: 1,
      isLast: true,
      values: [
        entry("15", [
          { field: "assignee", fieldId: "assignee", fromString: "Previous owner" },
        ]),
      ],
    });
    const source = await collect();
    expect(source.events).toMatchObject([
      { type: "assignee-changed", from: "Previous owner", to: null },
    ]);
  });

  it("rejects incomplete/repeated board pages before reading history", async () => {
    const { collect, client, request } = setup();
    client.getBoardIssues.mockResolvedValue({
      values: [],
      total: 10,
      startAt: 0,
      isLast: true,
    });
    await expect(collect()).rejects.toThrow(/incomplete/);
    expect(request).not.toHaveBeenCalled();
    client.getBoardIssues.mockResolvedValue({
      values: [issue()],
      total: 2,
      startAt: 0,
      isLast: false,
      nextCursor: 0,
    });
    await expect(collect()).rejects.toThrow(/repeated/);
  });

  it("rejects a wrong ancestor, cyclic ancestry and account switching", async () => {
    const wrong = setup();
    wrong.client.getReportIssue.mockResolvedValue(issue("9", ""));
    await expect(wrong.collect()).rejects.toThrow(/parent/);
    const cyclic = setup();
    cyclic.client.getReportIssue.mockResolvedValue(issue("1", "2"));
    await expect(cyclic.collect()).rejects.toThrow(/cyclic/);
    const switched = setup();
    switched.client.getCurrentUser
      .mockResolvedValueOnce({ accountId: "viewer" })
      .mockResolvedValueOnce({ accountId: "other" });
    await expect(switched.collect()).rejects.toThrow(/account/);
  });

  it("checks both parent ID and key when the ancestor was already a candidate", async () => {
    const { collect, client, histories } = setup();
    const ancestor = issue("1", "");
    ancestor.key = "TEST-9";
    client.getBoardIssues.mockResolvedValue({
      values: [issue(), ancestor],
      startAt: 0,
      maxResults: 100,
      total: 2,
      isLast: true,
    });
    histories.set("TEST-9:0", {
      startAt: 0,
      maxResults: 100,
      total: 0,
      isLast: true,
      values: [],
    });
    await expect(collect()).rejects.toThrow(/parent/);
  });

  it("does not read ancestors for a verified empty report and rejects an open future period", async () => {
    const { collect, input, client, histories } = setup();
    histories.set("TEST-2:0", {
      startAt: 0,
      maxResults: 100,
      total: 0,
      isLast: true,
      values: [],
    });
    expect((await collect()).events).toEqual([]);
    expect(client.getReportIssue).not.toHaveBeenCalled();
    await expect(
      collectWorkActivitySource({ ...input, now: new Date(period.start) }),
    ).rejects.toThrow(/not ended/);
  });

  it("passes the normalized shared source to the report builder", async () => {
    const { input } = setup();
    const report = await collectWorkActivityReport(input);
    expect(report.period).toEqual(period);
    expect(JSON.stringify(report)).not.toContain("private new body");
  });
});
