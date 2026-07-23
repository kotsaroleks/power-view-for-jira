import type { DiagnosticsSnapshot, JiraPageContext } from "@power-view/domain";
import { describe, expect, it, vi } from "vitest";

import {
  createExtensionMessageHandler,
  type MessageHandlerDependencies,
} from "./message-handler";

const requestId = "38bd0c46-0316-4eca-9c4b-a18d270a7f31";
const context: JiraPageContext = {
  baseUrl: "https://example.atlassian.net",
  pageUrl: "https://example.atlassian.net/browse/POWER-42",
  detectedAt: "2026-07-22T12:00:00.000Z",
  deploymentType: "cloud",
  projectKey: "POWER",
  issueKey: "POWER-42",
  detectionSources: ["url"],
};
const diagnostics: DiagnosticsSnapshot = {
  extensionVersion: "0.1.0",
  browserVersion: "Chromium 140",
  cacheStatus: "not-configured",
  loadedIssueCount: 0,
};

function dependencies(): MessageHandlerDependencies {
  return {
    getLatestContext: vi.fn().mockResolvedValue(context),
    refreshContext: vi.fn().mockResolvedValue(context),
    storeDetectedContext: vi.fn().mockResolvedValue(undefined),
    openPowerView: vi.fn().mockResolvedValue(23),
    requestHostPermission: vi.fn().mockResolvedValue(false),
    executeJiraRequest: vi.fn().mockResolvedValue({
      status: 200,
      data: { displayName: "Alex" },
      durationMs: 42,
      retryCount: 0,
    }),
    cancelJiraRequest: vi.fn().mockResolvedValue(undefined),
    recordIssueLoad: vi.fn().mockResolvedValue(undefined),
    getDiagnostics: vi.fn().mockResolvedValue(diagnostics),
  };
}

describe("extension message handler", () => {
  it("rejects malformed messages before calling an operation", async () => {
    const operations = dependencies();
    const response = await createExtensionMessageHandler(operations)(
      { type: "ARBITRARY_PROXY", url: "https://evil.example" },
      {},
    );

    expect(response).toMatchObject({
      type: "ERROR",
      ok: false,
      error: { code: "INVALID_RESPONSE", retryable: false },
    });
    const getLatestContext = operations.getLatestContext;
    expect(getLatestContext).not.toHaveBeenCalled();
  });

  it("returns the validated latest context", async () => {
    const response = await createExtensionMessageHandler(dependencies())(
      { type: "CONTEXT_GET", requestId },
      { url: "chrome-extension://extension-id/app/index.html" },
    );

    expect(response).toEqual({
      type: "CONTEXT_RESULT",
      requestId,
      ok: true,
      context,
    });
  });

  it("reports a denied host permission without converting it to an error", async () => {
    const response = await createExtensionMessageHandler(dependencies())(
      {
        type: "HOST_PERMISSION_REQUEST",
        requestId,
        originPattern: "https://jira.example.com/*",
      },
      { url: "chrome-extension://extension-id/popup/index.html" },
    );

    expect(response).toMatchObject({
      type: "HOST_PERMISSION_RESULT",
      ok: true,
      granted: false,
    });
  });

  it("routes an allowlisted Jira request through the privileged operation", async () => {
    const operations = dependencies();
    const response = await createExtensionMessageHandler(operations)(
      {
        type: "JIRA_REQUEST",
        requestId,
        payload: {
          baseUrl: "https://example.atlassian.net",
          method: "GET",
          path: "/rest/api/3/myself",
        },
      },
      { url: "chrome-extension://extension-id/app/index.html" },
    );

    expect(response).toMatchObject({
      type: "JIRA_RESPONSE",
      ok: true,
      status: 200,
      retryCount: 0,
    });
    expect(operations.executeJiraRequest).toHaveBeenCalledWith(
      requestId,
      expect.objectContaining({ path: "/rest/api/3/myself" }),
      expect.any(Object),
    );
  });

  it("returns sanitized diagnostics through the typed protocol", async () => {
    const response = await createExtensionMessageHandler(dependencies())(
      { type: "DIAGNOSTICS_GET", requestId },
      { url: "chrome-extension://extension-id/app/index.html" },
    );

    expect(response).toEqual({
      type: "DIAGNOSTICS_RESULT",
      requestId,
      ok: true,
      diagnostics,
    });
  });

  it("records only issue count and cache status", async () => {
    const operations = dependencies();
    const response = await createExtensionMessageHandler(operations)(
      {
        type: "ISSUE_LOAD_REPORT",
        requestId,
        loadedIssueCount: 1_000,
        cacheStatus: "ready",
      },
      { url: "chrome-extension://extension-id/app/index.html" },
    );

    expect(response).toEqual({ type: "ACK", requestId, ok: true });
    expect(operations.recordIssueLoad).toHaveBeenCalledWith(
      1_000,
      "ready",
      expect.any(Object),
    );
  });
});
