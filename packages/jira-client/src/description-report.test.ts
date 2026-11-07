import { describe, expect, it, vi } from "vitest";
import { collectDescriptionChangeReport } from "./description-report";
import {
  descriptionEvent,
  descriptionIssue,
} from "../../domain/src/description-report.test-fixtures";
import { mapChangelogEntry } from "./reporting-mappers";
function setup() {
  const issue = descriptionIssue("2", "1");
  const user = { accountId: "viewer", displayName: "Viewer" };
  const client = {
    getCurrentUser: vi.fn().mockResolvedValue(user),
    getBoard: vi.fn().mockResolvedValue({ id: "7", name: "Board" }),
    getBoardIssues: vi.fn().mockResolvedValue({
      values: [issue],
      startAt: 0,
      maxResults: 100,
      total: 1,
      isLast: true,
    }),
    getIssueChangelogs: vi.fn().mockResolvedValue([descriptionEvent("e")]),
    getReportIssue: vi.fn().mockResolvedValue(descriptionIssue("1")),
  };
  return {
    client,
    collect: () =>
      collectDescriptionChangeReport({
        client: client,
        jiraBaseUrl: "https://fixture.atlassian.net",
        boardId: "7",
        date: "2026-11-06",
        now: new Date("2026-11-06T19:05Z"),
        expectedUserId: "viewer",
      }),
  };
}
describe("Description report Jira boundary", () => {
  it("reads only candidate metadata and history, and loads an out-of-board ancestor", async () => {
    const { client, collect } = setup();
    const report = await collect();
    expect(report.rows.map((r) => r.issueKey)).toEqual(["TEST-1", "TEST-2"]);
    expect(client.getBoardIssues.mock.calls[0]?.[0]).toMatchObject({
      fieldsOverride: ["summary", "parent", "issuetype", "updated"],
    });
    expect(client.getReportIssue).toHaveBeenCalledWith("TEST-1", undefined);
  });
  it("rejects incomplete issue pagination rather than returning no changes", async () => {
    const { client, collect } = setup();
    client.getBoardIssues.mockResolvedValue({ values: [], total: 10, isLast: true });
    await expect(collect()).rejects.toThrow(/incomplete/);
    expect(client.getIssueChangelogs).not.toHaveBeenCalled();
  });
  it("does not publish a partial report when any history or parent read fails", async () => {
    const { client, collect } = setup();
    client.getIssueChangelogs.mockRejectedValue(new Error("Forbidden"));
    await expect(collect()).rejects.toThrow();
    client.getIssueChangelogs.mockResolvedValue([descriptionEvent("e")]);
    client.getReportIssue.mockRejectedValue(new Error("Forbidden"));
    await expect(collect()).rejects.toThrow();
  });
  it("cancels on an account switch and does not accept an open future period", async () => {
    const { client, collect } = setup();
    client.getCurrentUser
      .mockResolvedValueOnce({ accountId: "viewer" })
      .mockResolvedValueOnce({ accountId: "other" });
    await expect(collect()).rejects.toThrow(/account/);
    await expect(
      collectDescriptionChangeReport({
        client: client,
        jiraBaseUrl: "https://fixture.atlassian.net",
        boardId: "7",
        date: "2026-11-07",
        now: new Date("2026-11-06T19:05Z"),
      }),
    ).rejects.toThrow(/not ended/);
  });
  it("maps description events without retaining description contents or confusing unknown fields with points", () => {
    const events = mapChangelogEntry(
      {
        id: "10",
        created: "2026-11-06T10:00Z",
        author: { accountId: "a", displayName: "A" },
        items: [
          {
            fieldId: "description",
            field: "Опис",
            fromString: "private previous text",
            toString: "private next text",
          },
        ],
      },
      { id: "2", key: "TEST-2" },
      {},
    );
    expect(events[0]).toMatchObject({ type: "description-changed", actor: { id: "a" } });
    expect(events[0]).not.toHaveProperty("from");
    expect(events[0]).not.toHaveProperty("to");
    expect(
      mapChangelogEntry(
        {
          id: "11",
          created: "2026-11-06T10:00Z",
          items: [{ field: "unknown", fromString: null, toString: null }],
        },
        { id: "2", key: "TEST-2" },
        {},
      ),
    ).toEqual([]);
  });
});
