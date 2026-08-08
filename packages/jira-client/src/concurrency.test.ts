import type { JiraTransportRequest } from "@power-view/extension-messaging";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { MAX_CLIENT_CONCURRENCY, mapWithConcurrency } from "./concurrency";
import { createJiraClient } from "./JiraClient";
import type { JiraTransport } from "./JiraTransport";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function emptyChangelogTransport(
  onRequest?: () => void,
  onSettle?: () => void,
): JiraTransport {
  return {
    request<TResponse>(_request: JiraTransportRequest, schema: z.ZodType<TResponse>) {
      onRequest?.();
      return Promise.resolve().then(() => {
        onSettle?.();
        return schema.parse({ values: [], isLast: true });
      });
    },
  };
}

function changelogIssues(count: number): Array<{ id: string; key: string }> {
  return Array.from({ length: count }, (_, index) => ({
    id: String(10_000 + index),
    key: `POWER-${index}`,
  }));
}

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const mapped = mapWithConcurrency([0, 1, 2], 3, async (item) => {
      await gates[item]?.promise;
      return `item-${item}`;
    });

    gates[2]?.resolve();
    gates[0]?.resolve();
    gates[1]?.resolve();

    await expect(mapped).resolves.toEqual(["item-0", "item-1", "item-2"]);
  });

  it("never has more than `limit` calls in flight", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, index) => index),
      4,
      async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return item;
      },
    );

    expect(peak).toBe(4);
  });

  it("rejects and stops dispatching once the signal is aborted", async () => {
    const controller = new AbortController();
    const worker = vi.fn(async (item: number) => {
      if (item === 1) controller.abort();
      await Promise.resolve();
      return item;
    });

    await expect(
      mapWithConcurrency([0, 1, 2, 3, 4], 1, worker, controller.signal),
    ).rejects.toThrow();
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it("propagates the first rejection and stops dispatching", async () => {
    const worker = vi.fn(async (item: number) => {
      await Promise.resolve();
      if (item === 1) throw new Error("worker failed");
      return item;
    });

    await expect(mapWithConcurrency([0, 1, 2, 3, 4], 1, worker)).rejects.toThrow(
      "worker failed",
    );
    expect(worker).toHaveBeenCalledTimes(2);
  });
});

describe("getIssueChangelogs concurrency", () => {
  it("keeps at most MAX_CLIENT_CONCURRENCY transport calls outstanding", async () => {
    let outstanding = 0;
    let peak = 0;
    const client = createJiraClient(
      emptyChangelogTransport(
        () => {
          outstanding += 1;
          peak = Math.max(peak, outstanding);
        },
        () => {
          outstanding -= 1;
        },
      ),
      { baseUrl: "https://example.atlassian.net", deploymentType: "cloud" },
    );

    await client.getIssueChangelogs({ issues: changelogIssues(25) });

    expect(peak).toBe(MAX_CLIENT_CONCURRENCY);
  });

  it("reports progress as each issue completes", async () => {
    const client = createJiraClient(emptyChangelogTransport(), {
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
    });
    const onProgress = vi.fn();

    await client.getIssueChangelogs({ issues: changelogIssues(3), onProgress });

    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});
