import type { StorageArea } from "./context-store";
import { DiagnosticsStore } from "./diagnostics-store";
import { describe, expect, it } from "vitest";

class MemoryStorage implements StorageArea {
  private readonly values = new Map<string, unknown>();

  get(keys: string | string[]): Promise<Record<string, unknown>> {
    const selected = Array.isArray(keys) ? keys : [keys];
    return Promise.resolve(
      Object.fromEntries(selected.map((key) => [key, this.values.get(key)])),
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.entries(items).forEach(([key, value]) => this.values.set(key, value));
    return Promise.resolve();
  }

  remove(keys: string | string[]): Promise<void> {
    const selected = Array.isArray(keys) ? keys : [keys];
    selected.forEach((key) => this.values.delete(key));
    return Promise.resolve();
  }
}

describe("DiagnosticsStore", () => {
  it("stores only sanitized request metadata and connection time", async () => {
    const store = new DiagnosticsStore(new MemoryStorage());
    const completedAt = "2026-07-22T12:00:00.000Z";

    await store.recordRequest(
      {
        endpoint: "myself",
        durationMs: 83,
        retryCount: 0,
        completedAt,
        httpStatus: 200,
      },
      { connectionSucceeded: true },
    );

    expect(await store.getState()).toEqual({
      lastSuccessfulConnectionAt: completedAt,
      lastRequest: {
        endpoint: "myself",
        durationMs: 83,
        retryCount: 0,
        completedAt,
        httpStatus: 200,
      },
    });
  });

  it("records the latest typed error code", async () => {
    const store = new DiagnosticsStore(new MemoryStorage());

    await store.recordRequest({
      endpoint: "myself",
      durationMs: 20,
      retryCount: 0,
      completedAt: "2026-07-22T12:00:00.000Z",
      transport: "jira-page-bridge",
      failureStage: "bridge-unavailable",
      httpStatus: 401,
      errorCode: "AUTH_REQUIRED",
    });

    expect(await store.getState()).toMatchObject({
      lastErrorCode: "AUTH_REQUIRED",
      lastRequest: {
        errorCode: "AUTH_REQUIRED",
        failureStage: "bridge-unavailable",
        httpStatus: 401,
        transport: "jira-page-bridge",
      },
    });
  });

  it("records issue cache status without issue content", async () => {
    const store = new DiagnosticsStore(new MemoryStorage());

    await store.recordIssueLoad(1_000, "ready");

    expect(await store.getState()).toEqual({
      cacheStatus: "ready",
      loadedIssueCount: 1_000,
    });
  });
});
