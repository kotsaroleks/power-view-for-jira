import type { JiraTransportRequest } from "@power-view/extension-messaging";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { JiraCloudClient } from "./JiraCloudClient";
import { JiraDataCenterClient } from "./JiraDataCenterClient";
import type { JiraTransport } from "./JiraTransport";
import type { GetIssueChangelogsRequest } from "./reporting-api";

interface RawEntry {
  id: string;
  created: string;
  author: { accountId: string; displayName: string };
  items: Array<{
    field: string;
    from?: string;
    to?: string;
    fromString: string;
    toString: string;
  }>;
}

function entry(id: string, created: string, from: string, to: string): RawEntry {
  return {
    id,
    created,
    author: { accountId: "acct-1", displayName: "Mia Krystof" },
    items: [
      { field: "summary", fromString: "old", toString: "new" },
      { field: "status", from: "1", to: "3", fromString: from, toString: to },
    ],
  };
}

const issues = [
  { id: "10001", key: "POWER-1" },
  { id: "10002", key: "POWER-2" },
  { id: "10003", key: "POWER-3" },
];

/** Keyed by issue id, ordered oldest-first exactly as Jira returns a changelog. */
const fixture: Record<string, RawEntry[]> = {
  "10001": [
    entry("9001", "2026-01-01T09:00:00.000+0000", "To Do", "In Progress"),
    entry("9004", "2026-01-02T09:00:00.000+0000", "In Progress", "Done"),
    entry("9007", "2026-01-03T09:00:00.000+0000", "Done", "In Progress"),
  ],
  "10002": [
    entry("9002", "2026-01-01T10:00:00.000+0000", "To Do", "In Progress"),
    entry("9005", "2026-01-02T10:00:00.000+0000", "In Progress", "Done"),
  ],
  "10003": [],
};

const changelogRequest = {
  issues,
  completedStatusNames: ["Done"],
} satisfies GetIssueChangelogsRequest;

function perIssueTransport(): JiraTransport {
  return {
    request<TResponse>(request: JiraTransportRequest, schema: z.ZodType<TResponse>) {
      const issueKey = /\/issue\/([^/]+)\/changelog$/.exec(request.path)?.[1];
      const issue = issues.find((candidate) => candidate.key === issueKey);
      const values = issue ? (fixture[issue.id] ?? []) : [];
      return Promise.resolve(
        schema.parse({
          values,
          startAt: 0,
          maxResults: 100,
          total: values.length,
          isLast: true,
        }),
      );
    },
  };
}

/**
 * Serves the bulk endpoint the way the API documents it: one continuation token for the
 * whole request, pages ordered by changelog date then issue id, so `pageSize` below the
 * total entry count splits an issue's history across pages.
 */
function bulkTransport(pageSize: number): {
  transport: JiraTransport;
  requestMock: ReturnType<typeof vi.fn>;
} {
  const flattened = Object.entries(fixture)
    .flatMap(([issueId, entries]) => entries.map((changelog) => ({ issueId, changelog })))
    .sort(
      (left, right) =>
        Date.parse(left.changelog.created) - Date.parse(right.changelog.created) ||
        Number(left.issueId) - Number(right.issueId),
    );

  const requestMock = vi.fn(
    <TResponse>(request: JiraTransportRequest, schema: z.ZodType<TResponse>) => {
      const body = (request.body ?? {}) as { nextPageToken?: string };
      const offset = body.nextPageToken ? Number(body.nextPageToken) : 0;
      const page = flattened.slice(offset, offset + pageSize);
      const nextOffset = offset + page.length;
      const grouped = new Map<string, RawEntry[]>();
      for (const { issueId, changelog } of page)
        grouped.set(issueId, [...(grouped.get(issueId) ?? []), changelog]);
      return Promise.resolve(
        schema.parse({
          issueChangeLogs: [...grouped].map(([issueId, changeHistories]) => ({
            issueId,
            changeHistories,
          })),
          nextPageToken: nextOffset < flattened.length ? String(nextOffset) : null,
        }),
      );
    },
  );

  return {
    transport: { request: requestMock as unknown as JiraTransport["request"] },
    requestMock,
  };
}

function cloudClient(transport: JiraTransport): JiraCloudClient {
  return new JiraCloudClient(transport, "https://example.atlassian.net");
}

async function perIssueEvents() {
  const client = new JiraDataCenterClient(
    perIssueTransport(),
    "https://example.atlassian.net",
  );
  return client.getIssueChangelogs(changelogRequest);
}

describe("JiraCloudClient bulk changelog", () => {
  it("uses the bulk endpoint and never touches the per-issue endpoint", async () => {
    const { transport, requestMock } = bulkTransport(100);

    const events = await cloudClient(transport).getIssueChangelogs(changelogRequest);

    expect(events).toEqual(await perIssueEvents());
    expect(events.length).toBeGreaterThan(0);
    for (const call of requestMock.mock.calls) {
      const request = call[0] as JiraTransportRequest;
      expect(request.method).toBe("POST");
      expect(request.path).toBe("/rest/api/3/changelog/bulkfetch");
    }
  });

  // An empty fieldIds has no defined meaning in the Atlassian schema and could be read as
  // "filter to no fields", which would return zero changes without an error.
  it("omits fieldIds rather than sending an empty filter", async () => {
    const { transport, requestMock } = bulkTransport(100);

    await cloudClient(transport).getIssueChangelogs(changelogRequest);

    expect(requestMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of requestMock.mock.calls) {
      const body = (call[0] as JiraTransportRequest).body as Record<string, unknown>;
      expect(body).not.toHaveProperty("fieldIds");
    }
  });

  it("batches issue ids at the documented cap of 1000", async () => {
    const { transport, requestMock } = bulkTransport(100);
    const many = Array.from({ length: 2_500 }, (_, index) => ({
      id: String(20_000 + index),
      key: `POWER-${index}`,
    }));

    await cloudClient(transport).getIssueChangelogs({ issues: many });

    const batchSizes = requestMock.mock.calls.map(
      (call) =>
        ((call[0] as JiraTransportRequest).body as { issueIdsOrKeys: string[] })
          .issueIdsOrKeys.length,
    );
    expect(batchSizes).toEqual([1_000, 1_000, 500]);
  });

  it("drains the continuation token so no entry is lost when a page truncates an issue", async () => {
    const expected = await perIssueEvents();

    // pageSize 1 is the worst case: every issue's history is split across pages.
    for (const pageSize of [1, 2, 3, 4]) {
      const { transport, requestMock } = bulkTransport(pageSize);

      const events = await cloudClient(transport).getIssueChangelogs(changelogRequest);

      expect(events).toEqual(expected);
      expect(requestMock.mock.calls.length).toBeGreaterThan(1);
    }
  });

  it("falls back permanently to the per-issue path once bulk fails", async () => {
    let bulkCalls = 0;
    const perIssue = perIssueTransport();
    const requestMock = vi.fn(
      <TResponse>(request: JiraTransportRequest, schema: z.ZodType<TResponse>) => {
        if (request.method === "POST") {
          bulkCalls += 1;
          return Promise.reject(new Error("Failed to fetch"));
        }
        return perIssue.request(request, schema);
      },
    );
    const client = cloudClient({
      request: requestMock as unknown as JiraTransport["request"],
    });
    const expected = await perIssueEvents();

    await expect(client.getIssueChangelogs(changelogRequest)).resolves.toEqual(expected);
    await expect(client.getIssueChangelogs(changelogRequest)).resolves.toEqual(expected);

    expect(bulkCalls).toBe(1);
  });

  it("propagates an abort raised mid-bulk instead of falling back", async () => {
    const controller = new AbortController();
    const requestMock = vi.fn((request: JiraTransportRequest) => {
      expect(request.method).toBe("POST");
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    const client = cloudClient({ request: requestMock });

    await expect(
      client.getIssueChangelogs({ ...changelogRequest, signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
