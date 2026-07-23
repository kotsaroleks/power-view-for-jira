import { describe, expect, it } from "vitest";

import { ContextStore, type StorageArea } from "./context-store";

class MemoryStorageArea implements StorageArea {
  readonly values: Record<string, unknown> = {};

  get(keys: string | string[]): Promise<Record<string, unknown>> {
    const selectedKeys = Array.isArray(keys) ? keys : [keys];
    return Promise.resolve(
      Object.fromEntries(selectedKeys.map((key) => [key, this.values[key]])),
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
    return Promise.resolve();
  }

  remove(keys: string | string[]): Promise<void> {
    const selectedKeys = Array.isArray(keys) ? keys : [keys];
    for (const key of selectedKeys) {
      delete this.values[key];
    }
    return Promise.resolve();
  }
}

const context = {
  baseUrl: "https://example.atlassian.net",
  pageUrl: "https://example.atlassian.net/browse/POWER-42",
  detectedAt: "2026-07-22T12:00:00.000Z",
  deploymentType: "cloud" as const,
  projectKey: "POWER",
  issueKey: "POWER-42",
  detectionSources: ["url" as const],
};

describe("ContextStore", () => {
  it("stores the latest context and a tab-specific context", async () => {
    const storage = new MemoryStorageArea();
    const store = new ContextStore(storage);

    await store.save(7, context);

    await expect(store.getLatest()).resolves.toMatchObject({ tabId: 7, context });
    await expect(store.getForTab(7)).resolves.toMatchObject({ tabId: 7, context });
  });

  it("ignores malformed external storage values", async () => {
    const storage = new MemoryStorageArea();
    storage.values["jira-context:latest"] = { schemaVersion: 1, context: "bad" };

    await expect(new ContextStore(storage).getLatest()).resolves.toBeUndefined();
  });
});
