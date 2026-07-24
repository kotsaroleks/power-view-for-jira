import type { StorageArea } from "@power-view/storage";
import { UpdateStore } from "@power-view/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorageArea implements StorageArea {
  private readonly values: Record<string, unknown> = {};

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

const localStorage = new MemoryStorageArea();
const setBadgeText = vi.fn().mockResolvedValue(undefined);
const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);
const alarmsCreate = vi.fn();
const alarmsOnAlarmAddListener = vi.fn();
const fetchMock = vi.fn();

vi.stubGlobal("chrome", {
  runtime: { getURL: (path: string) => `chrome-extension://test-extension-id/${path}` },
  storage: { local: localStorage },
  action: { setBadgeText, setBadgeBackgroundColor },
  alarms: { create: alarmsCreate, onAlarm: { addListener: alarmsOnAlarmAddListener } },
});
vi.stubGlobal("fetch", fetchMock);

const buildInfo = {
  schemaVersion: 1,
  commitSha: "abc1234abc1234abc1234abc1234abc1234abcd",
  commitShaShort: "abc1234",
  repoOwner: "kotsaroleks",
  repoName: "power-view-for-jira",
  builtAt: "2026-07-24T00:00:00.000Z",
  gitAvailable: true,
};

function buildInfoResponse(): Response {
  return new Response(JSON.stringify(buildInfo), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function commitResponse(sha: string): Response {
  return new Response(JSON.stringify({ sha }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

let runUpdateCheck: () => Promise<void>;
let registerUpdateChecks: () => void;

beforeEach(async () => {
  setBadgeText.mockClear();
  setBadgeBackgroundColor.mockClear();
  alarmsCreate.mockClear();
  alarmsOnAlarmAddListener.mockClear();
  fetchMock.mockReset();

  vi.resetModules();
  ({ runUpdateCheck, registerUpdateChecks } = await import("./update-checker-runner"));
});

describe("registerUpdateChecks", () => {
  it("registers an hourly alarm and an alarm listener", () => {
    registerUpdateChecks();

    expect(alarmsCreate).toHaveBeenCalledWith("power-view-update-check", {
      periodInMinutes: 60,
    });
    expect(alarmsOnAlarmAddListener).toHaveBeenCalledWith(expect.any(Function));
  });
});

describe("runUpdateCheck", () => {
  it("sets an update badge when a newer commit exists on main", async () => {
    const store = new UpdateStore(localStorage);
    fetchMock
      .mockResolvedValueOnce(buildInfoResponse())
      .mockResolvedValueOnce(commitResponse("newsha1234"));

    await runUpdateCheck();

    expect(setBadgeText).toHaveBeenCalledWith({ text: "●" });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#ae2a19" });
    await expect(store.getCheckResult()).resolves.toMatchObject({
      status: "update-available",
      latestCommitSha: "newsha1234",
    });
  });

  it("clears the badge when the build is up to date", async () => {
    fetchMock
      .mockResolvedValueOnce(buildInfoResponse())
      .mockResolvedValueOnce(commitResponse(buildInfo.commitSha));

    await runUpdateCheck();

    expect(setBadgeText).toHaveBeenCalledWith({ text: "" });
  });

  it("sets an attention badge when the check fails", async () => {
    fetchMock
      .mockResolvedValueOnce(buildInfoResponse())
      .mockResolvedValueOnce(new Response("", { status: 500 }));

    await runUpdateCheck();

    expect(setBadgeText).toHaveBeenCalledWith({ text: "!" });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#626f86" });
  });
});
