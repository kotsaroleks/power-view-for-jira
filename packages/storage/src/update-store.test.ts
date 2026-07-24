import type { UpdateCheckResult } from "@power-view/update-checker";
import { describe, expect, it } from "vitest";

import type { StorageArea } from "./context-store";
import { UpdateStore } from "./update-store";

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

const checkResult: UpdateCheckResult = {
  schemaVersion: 1,
  status: "update-available",
  checkedAt: "2026-07-24T12:00:00.000Z",
  currentCommitSha: "abc1234",
  latestCommitSha: "def5678",
};

describe("UpdateStore", () => {
  it("stores a token and derives a masked hint", async () => {
    const store = new UpdateStore(new MemoryStorage());

    await store.saveToken("github_pat_abcdefgh1234");

    await expect(store.getToken()).resolves.toBe("github_pat_abcdefgh1234");
    await expect(store.getTokenHint()).resolves.toBe("…1234");
  });

  it("stores and reads a check result", async () => {
    const store = new UpdateStore(new MemoryStorage());

    await store.saveCheckResult(checkResult);

    await expect(store.getCheckResult()).resolves.toEqual(checkResult);
  });

  it("clears the token, hint, and cached result together", async () => {
    const store = new UpdateStore(new MemoryStorage());
    await store.saveToken("github_pat_abcdefgh1234");
    await store.saveCheckResult(checkResult);

    await store.clearToken();

    await expect(store.getToken()).resolves.toBeUndefined();
    await expect(store.getTokenHint()).resolves.toBeUndefined();
    await expect(store.getCheckResult()).resolves.toBeUndefined();
  });

  it("ignores malformed external storage values", async () => {
    const storage = new MemoryStorage();
    await storage.set({
      "update:token": 12_345,
      "update:check-result": { status: "unknown-status" },
    });
    const store = new UpdateStore(storage);

    await expect(store.getToken()).resolves.toBeUndefined();
    await expect(store.getCheckResult()).resolves.toBeUndefined();
  });
});
