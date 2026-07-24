import type { ExtensionRuntime } from "@power-view/extension-messaging";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PopupApp } from "./PopupApp";

describe("PopupApp", () => {
  it("shows context detected on the active Jira tab", async () => {
    const runtime: ExtensionRuntime = {
      sendMessage: vi.fn().mockImplementation((message: unknown) => {
        const request = message as { requestId: string };
        return Promise.resolve({
          type: "CONTEXT_RESULT",
          requestId: request.requestId,
          ok: true,
          context: {
            baseUrl: "https://example.atlassian.net",
            pageUrl: "https://example.atlassian.net/browse/POWER-42",
            detectedAt: "2026-07-22T12:00:00.000Z",
            deploymentType: "cloud",
            projectKey: "POWER",
            issueKey: "POWER-42",
            detectionSources: ["url"],
          },
        });
      }),
    };

    render(
      <PopupApp
        runtime={runtime}
        containsHostPermission={vi.fn().mockResolvedValue(true)}
        getActiveTabUrl={vi
          .fn()
          .mockResolvedValue("https://example.atlassian.net/browse/POWER-42")}
        updatePanelProps={{
          getUpdateStatus: vi.fn().mockResolvedValue({ hasToken: false }),
        }}
      />,
    );

    expect(await screen.findByText("Jira detected")).toBeInTheDocument();
    expect(screen.getByText("POWER-42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Power View" })).toBeEnabled();
  });

  it("offers the exact Jira host permission when context is detected without access", async () => {
    const runtime: ExtensionRuntime = {
      sendMessage: vi.fn().mockImplementation((message: unknown) => {
        const request = message as { requestId: string };
        return Promise.resolve({
          type: "CONTEXT_RESULT",
          requestId: request.requestId,
          ok: true,
          context: {
            baseUrl: "https://example.atlassian.net",
            pageUrl: "https://example.atlassian.net/browse/POWER-42",
            detectedAt: "2026-07-22T12:00:00.000Z",
            deploymentType: "cloud",
            projectKey: "POWER",
            detectionSources: ["url"],
          },
        });
      }),
    };

    render(
      <PopupApp
        runtime={runtime}
        containsHostPermission={vi.fn().mockResolvedValue(false)}
        getActiveTabUrl={vi
          .fn()
          .mockResolvedValue("https://example.atlassian.net/browse/POWER-42")}
        updatePanelProps={{
          getUpdateStatus: vi.fn().mockResolvedValue({ hasToken: false }),
        }}
      />,
    );

    expect(await screen.findByText("Grant Jira access")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://example.atlassian.net")).toBeVisible();
    expect(screen.getByRole("button", { name: "Grant site access" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Open Power View" })).toBeDisabled();
  });
});
