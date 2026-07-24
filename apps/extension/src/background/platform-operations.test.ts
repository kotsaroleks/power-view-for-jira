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

const mutationRequests: Record<string, JiraTransportRequest> = {
  "date update": {
    baseUrl: context.baseUrl,
    method: "PUT",
    path: "/rest/api/3/issue/POWER-42",
    body: { fields: { duedate: "2026-08-01" } },
  },
  "assignee change": {
    baseUrl: context.baseUrl,
    method: "PUT",
    path: "/rest/api/3/issue/POWER-42/assignee",
    body: { accountId: "5f8a1b2c3d4e5f6a7b8c9d0e" },
  },
  "issue link creation": {
    baseUrl: context.baseUrl,
    method: "POST",
    path: "/rest/api/3/issueLink",
    body: {
      type: { name: "Blocks" },
      inwardIssue: { key: "POWER-42" },
      outwardIssue: { key: "POWER-43" },
    },
  },
};

const sender = {
  tabId: TAB_ID,
  url: `chrome-extension://${EXTENSION_ID}/app/index.html`,
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
const tabsSendMessage = vi.fn();
const tabsGet = vi.fn();
const scriptingExecuteScript = vi.fn();
const permissionsContains = vi.fn();

vi.stubGlobal("chrome", {
  runtime: { id: EXTENSION_ID, getManifest: () => ({ version: "0.1.0" }) },
  storage: { session: sessionStorage },
  tabs: { sendMessage: tabsSendMessage, get: tabsGet },
  permissions: { contains: permissionsContains },
  scripting: { executeScript: scriptingExecuteScript },
});

let executeJiraRequest: MessageHandlerDependencies["executeJiraRequest"];

beforeAll(async () => {
  ({
    platformOperations: { executeJiraRequest },
  } = await import("./platform-operations"));
  await new ContextStore(sessionStorage).save(TAB_ID, context);
});

beforeEach(() => {
  tabsSendMessage.mockReset();
  tabsGet.mockReset();
  scriptingExecuteScript.mockReset();
  permissionsContains.mockReset().mockResolvedValue(true);
});

describe.each(Object.entries(mutationRequests))(
  "mutation transport fallback (%s)",
  (_label, mutationRequest) => {
    it("does not fall back to the main-world bridge when the page bridge fails after the request may already have reached Jira", async () => {
      const requestId = crypto.randomUUID();
      tabsSendMessage.mockResolvedValueOnce({
        type: "ERROR",
        requestId,
        ok: false,
        error: {
          code: "NETWORK_ERROR",
          message: "The Jira page could not complete the REST request.",
          retryable: true,
        },
      });

      await expect(
        executeJiraRequest(requestId, mutationRequest, sender),
      ).rejects.toThrow();

      expect(tabsSendMessage).toHaveBeenCalledTimes(1);
      expect(scriptingExecuteScript).not.toHaveBeenCalled();
    });

    it("falls back to the main-world bridge only when the page bridge itself is unreachable", async () => {
      const requestId = crypto.randomUUID();
      tabsSendMessage.mockRejectedValueOnce(
        new Error("Could not establish connection. Receiving end does not exist."),
      );
      tabsGet.mockResolvedValueOnce({ id: TAB_ID, url: context.pageUrl });
      scriptingExecuteScript.mockResolvedValueOnce([
        {
          result: {
            kind: "success",
            status: 200,
            data: { id: "POWER-42" },
            durationMs: 5,
          },
        },
      ]);

      const result = await executeJiraRequest(requestId, mutationRequest, sender);

      expect(result).toMatchObject({
        status: 200,
        data: { id: "POWER-42" },
        transport: "jira-main-world",
      });
      expect(tabsSendMessage).toHaveBeenCalledTimes(1);
      expect(scriptingExecuteScript).toHaveBeenCalledTimes(1);
    });
  },
);
