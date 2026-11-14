import { AppReloadStore, ContextStore, type StorageArea } from "@power-view/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reloadApp, updateApp } from "./reload-app";

function storage(): StorageArea {
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

afterEach(() => vi.unstubAllGlobals());

describe("reloadApp", () => {
  it("preserves the app tab and Jira context when Chrome has an update", async () => {
    const local = storage();
    const session = storage();
    await new ContextStore(session).save(7, {
      baseUrl: "https://fixture.atlassian.net",
      pageUrl: "https://fixture.atlassian.net/browse/POWER-1",
      detectedAt: new Date().toISOString(),
      deploymentType: "cloud",
      detectionSources: ["url"],
    });
    const runtime = {
      sendMessage: vi.fn(),
      reload: vi.fn(),
      getURL: (path: string) => new URL(path, "chrome-extension://power-view/").href,
      requestUpdateCheck: vi.fn().mockResolvedValue({ status: "update_available" }),
    };
    vi.stubGlobal("chrome", {
      runtime,
      management: { getSelf: vi.fn().mockResolvedValue({ installType: "admin" }) },
      storage: { local, session },
      tabs: { getCurrent: vi.fn().mockResolvedValue({ id: 42 }) },
    });
    await updateApp(runtime);
    expect(runtime.requestUpdateCheck).toHaveBeenCalledOnce();
    expect(runtime.reload).toHaveBeenCalledOnce();
    await expect(new AppReloadStore(local).take()).resolves.toMatchObject({
      tabId: 42,
      context: { tabId: 7, context: { baseUrl: "https://fixture.atlassian.net" } },
    });
  });

  it.each([
    ["no_update", "Chrome found no update for Power View 0.3.2."],
    ["throttled", "Chrome is limiting update checks. Try again in a few minutes."],
  ])("reports the %s result without reloading the app", async (status, message) => {
    const runtime = {
      sendMessage: vi.fn(),
      reload: vi.fn(),
      getURL: (path: string) => new URL(path, "chrome-extension://power-view/").href,
      requestUpdateCheck: vi.fn().mockResolvedValue({ status }),
    };
    vi.stubGlobal("chrome", {
      runtime,
      management: {
        getSelf: vi.fn().mockResolvedValue({ installType: "admin", version: "0.3.2" }),
      },
    });

    await expect(updateApp(runtime)).resolves.toBe(message);
    expect(runtime.reload).not.toHaveBeenCalled();
  });

  it("keeps the app open if the reload handoff cannot be saved", async () => {
    const local = storage();
    vi.spyOn(local, "set").mockRejectedValue(new Error("Storage unavailable"));
    const runtime = { sendMessage: vi.fn(), reload: vi.fn() };
    vi.stubGlobal("chrome", {
      runtime,
      storage: { local, session: storage() },
      tabs: { getCurrent: vi.fn().mockResolvedValue({ id: 42 }) },
    });
    await expect(reloadApp(runtime)).rejects.toThrow("Storage unavailable");
    expect(runtime.reload).not.toHaveBeenCalled();
  });
});
