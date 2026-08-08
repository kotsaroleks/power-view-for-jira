import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StorageArea } from "./context-store";
import { DiagnosticsStore } from "./diagnostics-store";

class MemoryStorage implements StorageArea {
  private readonly values = new Map<string, unknown>();
  setCallCount = 0;

  get(keys: string | string[]): Promise<Record<string, unknown>> {
    const selected = Array.isArray(keys) ? keys : [keys];
    return Promise.resolve(
      Object.fromEntries(selected.map((key) => [key, this.values.get(key)])),
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    this.setCallCount += 1;
    Object.entries(items).forEach(([key, value]) => this.values.set(key, value));
    return Promise.resolve();
  }

  remove(keys: string | string[]): Promise<void> {
    const selected = Array.isArray(keys) ? keys : [keys];
    selected.forEach((key) => this.values.delete(key));
    return Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DiagnosticsStore debounced recordRequest", () => {
  it("coalesces N rapid calls into exactly one storage write, holding the last value", async () => {
    const storage = new MemoryStorage();
    const store = new DiagnosticsStore(storage);

    void store.recordRequest({
      endpoint: "myself",
      durationMs: 1,
      retryCount: 0,
      completedAt: "2026-07-22T12:00:00.000Z",
    });
    void store.recordRequest({
      endpoint: "projects",
      durationMs: 2,
      retryCount: 0,
      completedAt: "2026-07-22T12:00:01.000Z",
    });
    void store.recordRequest({
      endpoint: "issues",
      durationMs: 3,
      retryCount: 0,
      completedAt: "2026-07-22T12:00:02.000Z",
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(storage.setCallCount).toBe(1);
    expect((await store.getState()).lastRequest).toMatchObject({
      endpoint: "issues",
      durationMs: 3,
    });
  });

  it("writes immediately when connectionSucceeded is set", async () => {
    const storage = new MemoryStorage();
    const store = new DiagnosticsStore(storage);

    await store.recordRequest(
      {
        endpoint: "myself",
        durationMs: 5,
        retryCount: 0,
        completedAt: "2026-07-22T12:00:00.000Z",
      },
      { connectionSucceeded: true },
    );

    expect(storage.setCallCount).toBe(1);
  });

  it("writes immediately when errorCode is set", async () => {
    const storage = new MemoryStorage();
    const store = new DiagnosticsStore(storage);

    await store.recordRequest({
      endpoint: "myself",
      durationMs: 5,
      retryCount: 0,
      completedAt: "2026-07-22T12:00:00.000Z",
      errorCode: "NETWORK_ERROR",
    });

    expect(storage.setCallCount).toBe(1);
  });

  it("getState observes a still-pending record", async () => {
    const storage = new MemoryStorage();
    const store = new DiagnosticsStore(storage);

    void store.recordRequest({
      endpoint: "myself",
      durationMs: 7,
      retryCount: 0,
      completedAt: "2026-07-22T12:00:00.000Z",
    });

    const state = await store.getState();

    expect(state.lastRequest).toMatchObject({ endpoint: "myself", durationMs: 7 });
  });

  it("keeps loadedIssueCount and lastRequest correct when recordIssueLoad interleaves with a pending flush", async () => {
    const storage = new MemoryStorage();
    const store = new DiagnosticsStore(storage);

    void store.recordRequest({
      endpoint: "myself",
      durationMs: 9,
      retryCount: 0,
      completedAt: "2026-07-22T12:00:00.000Z",
    });

    await store.recordIssueLoad(42, "ready");

    const state = await store.getState();

    expect(state.loadedIssueCount).toBe(42);
    expect(state.cacheStatus).toBe("ready");
    expect(state.lastRequest).toMatchObject({ endpoint: "myself", durationMs: 9 });
  });
});
