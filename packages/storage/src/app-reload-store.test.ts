import { describe, expect, it, vi } from "vitest";

import { AppReloadStore } from "./app-reload-store";

function storageWith(value?: unknown) {
  let stored = value;
  return {
    get: vi.fn(() => Promise.resolve({ "app-reload:v1": stored })),
    set: vi.fn((items: Record<string, unknown>) => {
      stored = items["app-reload:v1"];
      return Promise.resolve();
    }),
    remove: vi.fn(() => {
      stored = undefined;
      return Promise.resolve();
    }),
  };
}

describe("AppReloadStore", () => {
  const requestedAt = "2026-11-10T10:00:00.000Z";
  const now = Date.parse(requestedAt);

  it("consumes a fresh reload request exactly once", async () => {
    const storage = storageWith();
    const store = new AppReloadStore(storage);
    await store.save({ requestedAt, tabId: 42 });
    await expect(store.take(now + 500)).resolves.toEqual({ requestedAt, tabId: 42 });
    await expect(store.take(now + 1000)).resolves.toBeUndefined();
    expect(storage.remove).toHaveBeenCalledOnce();
  });

  it.each([
    { requestedAt: "2026-11-10T09:59:00.000Z" },
    { requestedAt: "2026-11-10T10:00:01.000Z" },
    { requestedAt: "invalid" },
    { requestedAt, context: { tabId: 1, context: "invalid" } },
  ])("discards stale or invalid handoffs: %j", async (handoff) => {
    const storage = storageWith(handoff);
    const store = new AppReloadStore(storage);
    await expect(store.take(now)).resolves.toBeUndefined();
    expect(storage.remove).toHaveBeenCalledOnce();
  });

  it("does not touch storage when no reload was requested", async () => {
    const storage = storageWith();
    await expect(new AppReloadStore(storage).take(now)).resolves.toBeUndefined();
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
