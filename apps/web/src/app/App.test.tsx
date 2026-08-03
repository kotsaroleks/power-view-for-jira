import type { ExtensionRuntime } from "@power-view/extension-messaging";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";

const context = {
  baseUrl: "https://example.atlassian.net",
  pageUrl: "https://example.atlassian.net/browse/POWER-42",
  detectedAt: "2026-07-22T12:00:00.000Z",
  deploymentType: "cloud",
  projectKey: "POWER",
  issueKey: "POWER-42",
  detectionSources: ["url"],
} as const;

const diagnostics = {
  extensionVersion: "0.1.0",
  browserVersion: "Chromium 140.0",
  jiraBaseUrl: "https://example.atlassian.net",
  deploymentType: "cloud",
  cacheStatus: "not-configured",
  loadedIssueCount: 0,
} as const;

function runtimeFor(
  jiraResponse?: (path: string, requestId: string) => unknown,
): ExtensionRuntime {
  return {
    sendMessage: vi.fn().mockImplementation((message: unknown) => {
      const request = message as {
        type: string;
        requestId: string;
        payload?: { path: string };
      };
      if (request.type === "CONTEXT_GET") {
        return Promise.resolve({
          type: "CONTEXT_RESULT",
          requestId: request.requestId,
          ok: true,
          context,
        });
      }
      if (request.type === "DIAGNOSTICS_GET") {
        return Promise.resolve({
          type: "DIAGNOSTICS_RESULT",
          requestId: request.requestId,
          ok: true,
          diagnostics,
        });
      }
      if (request.type === "JIRA_REQUEST" && request.payload) {
        return Promise.resolve(jiraResponse?.(request.payload.path, request.requestId));
      }
      return Promise.resolve({ type: "ACK", requestId: request.requestId, ok: true });
    }),
  };
}

describe("App", () => {
  it("displays the latest validated Jira context", async () => {
    render(<App runtime={runtimeFor()} />);

    expect(await screen.findByText("Context detected")).toBeInTheDocument();
    expect(screen.getByText("https://example.atlassian.net")).toBeInTheDocument();
    expect(screen.getByText("POWER-42")).toBeInTheDocument();
  });

  it("tests the current user and server info through JiraClient", async () => {
    const runtime = runtimeFor((path, requestId) => ({
      type: "JIRA_RESPONSE",
      requestId,
      ok: true,
      status: 200,
      durationMs: 25,
      retryCount: 0,
      data: path.endsWith("/myself")
        ? { accountId: "account-1", displayName: "Alex Rivera" }
        : {
            baseUrl: "https://example.atlassian.net",
            deploymentType: "Cloud",
            version: "1001.0.0",
            versionNumbers: [1001, 0, 0],
            serverTitle: "Example Jira",
          },
    }));
    render(<App runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Connect to Jira" }));

    expect(await screen.findByText("Connected as Alex Rivera")).toBeInTheDocument();
    expect(screen.getByText(/Example Jira · cloud · 1001\.0\.0/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project setup" })).toBeInTheDocument();
  });

  it.each([
    ["AUTH_REQUIRED", 401, "Jira did not accept the current browser session."],
    ["PERMISSION_DENIED", 403, "Jira denied access for the current user."],
    ["TIMEOUT", undefined, "The Jira request timed out."],
    [
      "UNSUPPORTED_DEPLOYMENT",
      404,
      "This Jira instance does not expose the required REST endpoint.",
    ],
  ] as const)("shows a distinct %s connection failure", async (code, status, message) => {
    const runtime = runtimeFor((path, requestId) =>
      path.endsWith("/myself")
        ? {
            type: "ERROR",
            requestId,
            ok: false,
            error: {
              code,
              message,
              retryable: code === "AUTH_REQUIRED" || code === "TIMEOUT",
              ...(status === undefined ? {} : { httpStatus: status }),
            },
          }
        : {
            type: "JIRA_RESPONSE",
            requestId,
            ok: true,
            status: 200,
            durationMs: 25,
            retryCount: 0,
            data: {
              baseUrl: "https://example.atlassian.net",
              versionNumbers: [],
            },
          },
    );
    render(<App runtime={runtime} />);

    fireEvent.click(await screen.findByRole("button", { name: "Connect to Jira" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText(`Error code: ${code}`)).toBeInTheDocument();
  });

  it("copies only the sanitized diagnostics snapshot", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    render(<App runtime={runtimeFor()} clipboard={{ writeText }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Open diagnostics" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy diagnostics" }));

    expect(await screen.findByText("Diagnostics copied.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledOnce();
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('"extensionVersion": "0.1.0"');
    expect(copied).not.toMatch(/cookie|authorization|session/i);
  });
});
