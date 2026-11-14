import { AppReloadStore, ContextStore, type StorageArea } from "@power-view/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import { restoreAppReload } from "./restore-app-reload";

function memoryStorage(): StorageArea {
  const values: Record<string, unknown> = {};
  return {
    get: (keys) =>
      Promise.resolve(
        Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).map((key) => [key, values[key]]),
        ),
      ),
    set: (items) => {
      Object.assign(values, items);
      return Promise.resolve();
    },
    remove: (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
      return Promise.resolve();
    },
  };
}

const context = {
  baseUrl: "https://fixture.atlassian.net",
  pageUrl: "https://fixture.atlassian.net/browse/POWER-1",
  detectedAt: "2026-11-10T10:00:00.000Z",
  deploymentType: "cloud",
  projectKey: "POWER",
  detectionSources: ["url"],
} as const;
const appUrl = "chrome-extension://fixture/app/index.html";

async function platformWithPendingReload() {
  const local = memoryStorage();
  const session = memoryStorage();
  const savedContext = { ...context, detectionSources: [...context.detectionSources] };
  await new AppReloadStore(local).save({
    requestedAt: new Date().toISOString(),
    tabId: 42,
    context: { schemaVersion: 1, tabId: 7, context: savedContext },
  });
  const platform = {
    storage: { local, session },
    runtime: { getURL: vi.fn(() => appUrl) },
    permissions: { contains: vi.fn().mockResolvedValue(true) },
    tabs: {
      get: vi.fn().mockResolvedValue({ id: 7, url: context.pageUrl }),
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 43 }),
      reload: vi.fn().mockResolvedValue(undefined),
    },
  };
  vi.stubGlobal("chrome", platform);
  return platform;
}

afterEach(() => vi.unstubAllGlobals());

describe("restoreAppReload", () => {
  it("restores the verified Jira tab context and reopens the app after a requested reload", async () => {
    const platform = await platformWithPendingReload();
    platform.tabs.create.mockImplementation(async () => {
      await expect(
        new ContextStore(platform.storage.session).getLatest(),
      ).resolves.toMatchObject({ tabId: 7, context });
      return { id: 43 };
    });
    await expect(restoreAppReload()).resolves.toBe(true);
    expect(platform.tabs.create).toHaveBeenCalledWith({ url: appUrl, active: true });
    await expect(
      new AppReloadStore(platform.storage.local).take(),
    ).resolves.toBeUndefined();
  });

  it("refreshes a surviving app tab without opening a duplicate", async () => {
    const platform = await platformWithPendingReload();
    platform.tabs.query.mockResolvedValue([{ id: 41 }, { id: 42 }]);
    await expect(restoreAppReload()).resolves.toBe(true);
    expect(platform.tabs.reload).toHaveBeenCalledWith(42);
    expect(platform.tabs.create).not.toHaveBeenCalled();
  });

  it.each(["closed", "different site", "revoked access"])(
    "reopens safely without restoring a Jira context after %s",
    async (state) => {
      const platform = await platformWithPendingReload();
      if (state === "closed") platform.tabs.get.mockRejectedValue(new Error("No tab"));
      if (state === "different site")
        platform.tabs.get.mockResolvedValue({ id: 7, url: "https://other.example/" });
      if (state === "revoked access")
        platform.permissions.contains.mockResolvedValue(false);
      await expect(restoreAppReload()).resolves.toBe(true);
      await expect(
        new ContextStore(platform.storage.session).getLatest(),
      ).resolves.toBeUndefined();
      expect(platform.tabs.create).toHaveBeenCalledOnce();
    },
  );

  it("does not open tabs on an ordinary background startup", async () => {
    const platform = await platformWithPendingReload();
    await new AppReloadStore(platform.storage.local).take();
    await expect(restoreAppReload()).resolves.toBe(false);
    expect(platform.tabs.create).not.toHaveBeenCalled();
    expect(platform.tabs.query).not.toHaveBeenCalled();
  });
});
