import type { JiraPageContext } from "@power-view/domain";
import type { JiraTransportRequest } from "@power-view/extension-messaging";
import { ContextStore, type StorageArea } from "@power-view/storage";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessageHandlerDependencies } from "./message-handler";

const EXTENSION_ID = "test-extension-id";
const TAB_ID = 7;

const context: JiraPageContext = {
  baseUrl: "https://example.atlassian.net",
  pageUrl: "https://example.atlassian.net/browse/POWER-42",
  detectedAt: "2026-07-22T12:00:00.000Z",
  deploymentType: "cloud",
  projectKey: "POWER",
  issueKey: "POWER-42",
  detectionSources: ["url"],
};

const getRequest: JiraTransportRequest = {
  baseUrl: context.baseUrl,
  method: "GET",
  path: "/rest/api/3/myself",
};

const sender = {
  tabId: TAB_ID,
  url: `chrome-extension://${EXTENSION_ID}/app/index.html`,
};

const jiraPageSender = {
  tabId: TAB_ID,
  url: context.pageUrl,
};

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

const sessionStorage = new MemoryStorageArea();
const contextStore = new ContextStore(sessionStorage);

const permissionsContains = vi.fn();
const permissionRemovedListeners: Array<() => void> = [];
const permissionAddedListeners: Array<() => void> = [];
const fetchMock = vi.fn();

vi.stubGlobal("chrome", {
  runtime: { id: EXTENSION_ID, getManifest: () => ({ version: "0.1.0" }) },
  storage: { session: sessionStorage },
  tabs: {
    sendMessage: vi.fn(),
    get: vi.fn().mockResolvedValue({ id: TAB_ID, url: context.pageUrl }),
  },
  permissions: {
    contains: permissionsContains,
    onRemoved: {
      addListener: (listener: () => void) => permissionRemovedListeners.push(listener),
    },
    onAdded: {
      addListener: (listener: () => void) => permissionAddedListeners.push(listener),
    },
  },
  scripting: { executeScript: vi.fn() },
});

vi.stubGlobal("fetch", fetchMock);

let executeJiraRequest: MessageHandlerDependencies["executeJiraRequest"];
let storeDetectedContext: MessageHandlerDependencies["storeDetectedContext"];

function jiraSuccessResponse(): Response {
  return new Response(JSON.stringify({ accountId: "abc" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(async () => {
  ({
    platformOperations: { executeJiraRequest, storeDetectedContext },
  } = await import("./platform-operations"));
  await contextStore.save(TAB_ID, context);
});

beforeEach(() => {
  // The context/permission memo is module-level state that outlives a single
  // test. Clear it before each test via the same listener production code
  // uses to invalidate it, so each test starts from a known "no memo" state.
  permissionRemovedListeners.forEach((listener) => listener());
  permissionsContains.mockReset().mockResolvedValue(true);
  fetchMock.mockReset().mockImplementation(() => Promise.resolve(jiraSuccessResponse()));
});

describe("requireActiveJiraContextWithPermission memoization", () => {
  it("registers permissions.onRemoved and permissions.onAdded listeners", () => {
    expect(permissionRemovedListeners.length).toBeGreaterThan(0);
    expect(permissionAddedListeners.length).toBeGreaterThan(0);
  });

  it("only calls chrome.permissions.contains once across two consecutive GET requests", async () => {
    await executeJiraRequest(crypto.randomUUID(), getRequest, sender);
    await executeJiraRequest(crypto.randomUUID(), getRequest, sender);

    expect(permissionsContains).toHaveBeenCalledTimes(1);
  });

  it("re-checks permissions after a contextStore save (e.g. via storeDetectedContext)", async () => {
    await executeJiraRequest(crypto.randomUUID(), getRequest, sender);
    expect(permissionsContains).toHaveBeenCalledTimes(1);

    await storeDetectedContext(context, jiraPageSender);

    await executeJiraRequest(crypto.randomUUID(), getRequest, sender);
    expect(permissionsContains).toHaveBeenCalledTimes(2);
  });

  it("re-checks permissions after the permissions.onRemoved listener fires", async () => {
    await executeJiraRequest(crypto.randomUUID(), getRequest, sender);
    expect(permissionsContains).toHaveBeenCalledTimes(1);

    permissionRemovedListeners.forEach((listener) => listener());

    await executeJiraRequest(crypto.randomUUID(), getRequest, sender);
    expect(permissionsContains).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failing permission gate: two consecutive failures both re-evaluate", async () => {
    permissionsContains.mockResolvedValue(false);

    await expect(
      executeJiraRequest(crypto.randomUUID(), getRequest, sender),
    ).rejects.toThrow();
    await expect(
      executeJiraRequest(crypto.randomUUID(), getRequest, sender),
    ).rejects.toThrow();

    expect(permissionsContains).toHaveBeenCalledTimes(2);
  });
});
