import type {
  BoardReportConfiguration,
  ReportChangeEvent,
  ReportingIssueSnapshot,
  ReportWorklog,
} from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import { MemoryJiraHistoryCache, type JiraHistoryCache } from "@power-view/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { changelogFingerprint, worklogFingerprint } from "./history-cache";
import { generateReport } from "./reporting-generator";

const baseUrl = "https://example.atlassian.net";
const jql = "filter = 9001 ORDER BY Rank ASC";
const statusMapping: BoardReportConfiguration = {
  schemaVersion: 1,
  jiraBaseUrl: baseUrl,
  boardId: "7",
  completedStatusIds: ["3"],
  completedStatusNames: ["Done"],
  updatedAt: "2026-08-04T00:00:00.000Z",
};

// Inside the Daily period for 2026-08-04 (08:00 Kyiv boundaries), so every issue is a
// changelog candidate.
const updatedAt = "2026-08-04T04:00:00.000Z";

function issue(
  id: string,
  overrides: Partial<ReportingIssueSnapshot> = {},
): ReportingIssueSnapshot {
  return {
    id,
    key: `POWER-${id}`,
    browseUrl: `${baseUrl}/browse/POWER-${id}`,
    summary: `Issue ${id}`,
    issueType: { id: "1", name: "Task" },
    status: { id: "3", name: "Done" },
    sprintIds: [],
    updatedAt,
    ...overrides,
  };
}

function undatedIssue(id: string): ReportingIssueSnapshot {
  const snapshot = issue(id);
  delete snapshot.updatedAt;
  return snapshot;
}

function changeEvent(issueId: string): ReportChangeEvent {
  return {
    id: `status:${issueId}`,
    issueId,
    issueKey: `POWER-${issueId}`,
    type: "status-changed",
    occurredAt: "2026-08-04T04:30:00.000Z",
  };
}

function worklog(issueId: string): ReportWorklog {
  return {
    id: `worklog:${issueId}`,
    issueId,
    issueKey: `POWER-${issueId}`,
    author: { id: "u1", displayName: "Ada" },
    startedAt: "2026-08-04T04:30:00.000Z",
    timeSpentSeconds: 3_600,
  };
}

function clientFixture(issues: ReportingIssueSnapshot[]) {
  const ids = (request: { issues: Array<{ id: string }> }) =>
    request.issues.map((item) => item.id);
  return {
    getBoard: vi.fn().mockResolvedValue({
      id: "7",
      name: "Power Delivery Board",
      type: "scrum",
      projectKeys: ["POWER"],
    }),
    getBoardConfiguration: vi
      .fn()
      .mockResolvedValue({ id: "7", name: "Power Delivery Board", statusIds: ["3"] }),
    getBoardIssues: vi.fn().mockResolvedValue({
      values: issues,
      startAt: 0,
      maxResults: 100,
      total: issues.length,
      isLast: true,
    }),
    getSprint: vi.fn(),
    getSprintIssues: vi.fn(),
    // Issues "1" and "3" have history; "2" is the issue that legitimately has none.
    getIssueChangelogs: vi
      .fn()
      .mockImplementation((request: { issues: Array<{ id: string }> }) =>
        Promise.resolve(
          ids(request)
            .filter((id) => id !== "2")
            .map(changeEvent),
        ),
      ),
    getIssueWorklogs: vi
      .fn()
      .mockImplementation((request: { issues: Array<{ id: string }> }) =>
        Promise.resolve(
          ids(request)
            .filter((id) => id !== "2")
            .map(worklog),
        ),
      ),
  };
}

type ClientFixture = ReturnType<typeof clientFixture>;

async function run(
  client: ClientFixture,
  options: {
    cache?: JiraHistoryCache;
    forceRefresh?: boolean;
    mapping?: BoardReportConfiguration;
  } = {},
) {
  return generateReport({
    client: client as unknown as JiraClient,
    baseUrl,
    deploymentType: "cloud",
    request: {
      type: "daily",
      boardId: "7",
      jql,
      localDate: "2026-08-04",
      scope: { kind: "team" },
      language: "uk",
      statusMapping: options.mapping ?? statusMapping,
    },
    ...(options.cache ? { historyCache: options.cache } : {}),
    ...(options.forceRefresh ? { forceRefresh: true } : {}),
  });
}

function requestedChangelogIds(client: ClientFixture, call: number): string[] {
  const [request] = client.getIssueChangelogs.mock.calls[call] as [
    { issues: Array<{ id: string }> },
  ];
  return request.issues.map((item) => item.id);
}

function requestedWorklogIds(client: ClientFixture, call: number): string[] {
  const [request] = client.getIssueWorklogs.mock.calls[call] as [
    { issues: Array<{ id: string }> },
  ];
  return request.issues.map((item) => item.id);
}

describe("history fingerprints", () => {
  it("changes with any input that shapes a mapped changelog event", () => {
    const request = {
      storyPointsFieldId: "customfield_1",
      sprintFieldId: "customfield_2",
      sprintId: "101",
      completedStatusIds: ["3"],
      completedStatusNames: ["Done"],
    };
    const baseline = changelogFingerprint(request);

    expect(changelogFingerprint({ ...request })).toBe(baseline);
    // Membership sets: reordering is not a change, contents are.
    expect(
      changelogFingerprint({ ...request, completedStatusNames: ["Done", "Closed"] }),
    ).not.toBe(changelogFingerprint({ ...request, completedStatusNames: ["Done"] }));
    expect(changelogFingerprint({ ...request, completedStatusIds: ["3", "6"] })).toBe(
      changelogFingerprint({ ...request, completedStatusIds: ["6", "3"] }),
    );
    expect(changelogFingerprint({ ...request, sprintId: "102" })).not.toBe(baseline);
    expect(changelogFingerprint({ ...request, storyPointsFieldId: "x" })).not.toBe(
      baseline,
    );
  });

  it("separates worklogs fetched for different periods", () => {
    expect(
      worklogFingerprint("2026-08-03T05:00:00.000Z", "2026-08-04T05:00:00.000Z"),
    ).not.toBe(
      worklogFingerprint("2026-07-27T05:00:00.000Z", "2026-08-04T05:00:00.000Z"),
    );
  });
});

describe("generateReport history cache", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-07T09:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves an unchanged issue from the cache on the second run", async () => {
    const cache = new MemoryJiraHistoryCache();
    const issues = [issue("1")];

    const first = await run(clientFixture(issues), { cache });
    const client = clientFixture(issues);
    const second = await run(client, { cache });

    expect(requestedChangelogIds(client, 0)).toEqual([]);
    expect(requestedWorklogIds(client, 0)).toEqual([]);
    expect(second.changes).toEqual(first.changes);
    expect(second.worklogs).toEqual(first.worklogs);
  });

  it("caches an issue with zero events and hits on the re-run", async () => {
    const cache = new MemoryJiraHistoryCache();
    // "2" has no changelog and no worklog, so it contributes nothing to the flattened
    // results — the run must still record it, or it would miss forever.
    const issues = [issue("1"), issue("2")];

    const first = await run(clientFixture(issues), { cache });
    const client = clientFixture(issues);
    const second = await run(client, { cache });

    expect(requestedChangelogIds(client, 0)).toEqual([]);
    expect(requestedWorklogIds(client, 0)).toEqual([]);
    expect(second.changes).toEqual(first.changes);
    expect(second.worklogs).toEqual(first.worklogs);
  });

  it("re-fetches only the issue whose updatedAt moved", async () => {
    const cache = new MemoryJiraHistoryCache();
    await run(clientFixture([issue("1"), issue("2")]), { cache });

    const client = clientFixture([
      issue("1"),
      issue("2", { updatedAt: "2026-08-04T04:45:00.000Z" }),
    ]);
    await run(client, { cache });

    expect(requestedChangelogIds(client, 0)).toEqual(["2"]);
    expect(requestedWorklogIds(client, 0)).toEqual(["2"]);
  });

  it("never caches an issue without updatedAt", async () => {
    const cache = new MemoryJiraHistoryCache();
    const issues = [undatedIssue("1")];

    await run(clientFixture(issues), { cache });
    const client = clientFixture(issues);
    await run(client, { cache });

    expect(requestedChangelogIds(client, 0)).toEqual(["1"]);
    expect(requestedWorklogIds(client, 0)).toEqual(["1"]);
  });

  it("misses changelogs when the completed-status mapping changed", async () => {
    const cache = new MemoryJiraHistoryCache();
    const issues = [issue("1")];
    await run(clientFixture(issues), { cache });

    const client = clientFixture(issues);
    await run(client, {
      cache,
      mapping: {
        ...statusMapping,
        completedStatusIds: ["3", "6"],
        completedStatusNames: ["Done", "Closed"],
      },
    });

    expect(requestedChangelogIds(client, 0)).toEqual(["1"]);
    // The worklog mapping is config-free, so that half of the cache still hits.
    expect(requestedWorklogIds(client, 0)).toEqual([]);
  });

  it("force refresh bypasses reads but still writes", async () => {
    const cache = new MemoryJiraHistoryCache();
    const issues = [issue("1"), issue("2")];
    await run(clientFixture(issues), { cache });

    const forced = clientFixture(issues);
    await run(forced, { cache, forceRefresh: true });
    expect(requestedChangelogIds(forced, 0)).toEqual(["1", "2"]);

    const afterForce = clientFixture(issues);
    await run(afterForce, { cache });
    expect(requestedChangelogIds(afterForce, 0)).toEqual([]);
    expect(requestedWorklogIds(afterForce, 0)).toEqual([]);
  });

  it("reports cache hits through the progress callback", async () => {
    const cache = new MemoryJiraHistoryCache();
    const issues = [issue("1"), issue("2")];
    await run(clientFixture(issues), { cache });

    const progress: Array<{ stage: string; cached?: number; total?: number }> = [];
    await generateReport({
      client: clientFixture(issues) as unknown as JiraClient,
      baseUrl,
      deploymentType: "cloud",
      request: {
        type: "daily",
        boardId: "7",
        jql,
        localDate: "2026-08-04",
        scope: { kind: "team" },
        language: "uk",
        statusMapping,
      },
      historyCache: cache,
      onProgress: (update) => progress.push(update),
    });

    expect(progress).toContainEqual({ stage: "changes", cached: 2, total: 2 });
    expect(progress).toContainEqual({ stage: "worklogs", cached: 2, total: 2 });
  });

  it("still produces the report when every cache operation throws", async () => {
    const broken: JiraHistoryCache = {
      getMany: () => Promise.reject(new Error("IndexedDB is unavailable.")),
      putMany: () => Promise.reject(new Error("IndexedDB is unavailable.")),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const issues = [issue("1"), issue("2")];
    const expected = await run(clientFixture(issues));

    const client = clientFixture(issues);
    const snapshot = await run(client, { cache: broken });

    expect(requestedChangelogIds(client, 0)).toEqual(["1", "2"]);
    expect(snapshot.changes).toEqual(expected.changes);
    expect(snapshot.worklogs).toEqual(expected.worklogs);
    warn.mockRestore();
  });

  it("returns the same entry order whether the answer came from cache or Jira", async () => {
    const cache = new MemoryJiraHistoryCache();
    const issues = [issue("1"), issue("2"), issue("3")];
    const uncached = await run(clientFixture(issues), {});

    await run(clientFixture(issues), { cache });
    // Issue "1" moves, so this run mixes a live fetch with two cache hits — and "1"'s
    // entries must still lead, exactly as the flat per-issue fetch would order them.
    const mixed = await run(
      clientFixture([
        issue("1", { updatedAt: "2026-08-04T04:50:00.000Z" }),
        issue("2"),
        issue("3"),
      ]),
      { cache },
    );

    expect(mixed.changes).toEqual(uncached.changes);
    expect(mixed.worklogs).toEqual(uncached.worklogs);
  });
});
