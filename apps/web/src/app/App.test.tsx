import type { ExtensionRuntime } from "@power-view/extension-messaging";
import { SettingsStore, type StorageArea } from "@power-view/storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";

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

    expect(await screen.findByText("Connected as Alex Rivera")).toBeInTheDocument();
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

  it("opens the workspace chooser after automatic board setup", async () => {
    const jiraRequest = vi.fn((path: string, requestId: string) => {
      const common = {
        type: "JIRA_RESPONSE" as const,
        requestId,
        ok: true as const,
        status: 200,
        durationMs: 10,
        retryCount: 0,
      };
      if (path.endsWith("/myself")) {
        return { ...common, data: { accountId: "alex", displayName: "Alex" } };
      }
      if (path.endsWith("/serverInfo")) {
        return {
          ...common,
          data: {
            baseUrl: context.baseUrl,
            deploymentType: "Cloud",
            versionNumbers: [1001, 0, 0],
          },
        };
      }
      if (path.endsWith("/project/search")) {
        return {
          ...common,
          data: {
            values: [{ id: "10000", key: "POWER", name: "Power View" }],
            startAt: 0,
            maxResults: 25,
            total: 1,
            isLast: true,
          },
        };
      }
      if (path.endsWith("/field")) {
        return {
          ...common,
          data: [
            { id: "duedate", name: "Due date", custom: false, schema: { type: "date" } },
            {
              id: "customfield_10020",
              name: "Sprint",
              custom: true,
              schema: { type: "array", custom: "com.pyxis.greenhopper.jira:gh-sprint" },
            },
          ],
        };
      }
      if (path === "/rest/agile/1.0/board") {
        return {
          ...common,
          data: {
            values: [
              {
                id: 7,
                name: "Power Delivery Board",
                type: "scrum",
                location: { projectKey: "POWER" },
              },
            ],
            startAt: 0,
            maxResults: 50,
            total: 1,
          },
        };
      }
      if (path.endsWith("/board/7/configuration")) {
        return {
          ...common,
          data: {
            id: 7,
            name: "Power Delivery Board",
            filter: { id: 9001 },
            columnConfig: { columns: [{ statuses: [{ id: "3" }] }] },
          },
        };
      }
      if (path.endsWith("/status")) {
        return { ...common, data: [{ id: "3", name: "Done" }] };
      }
      if (path.endsWith("/project/POWER/statuses")) {
        return {
          ...common,
          data: [{ id: "1", statuses: [{ id: "3", name: "Done" }] }],
        };
      }
      if (path.endsWith("/board/7/sprint")) {
        return {
          ...common,
          data: {
            values: [{ id: 101, name: "Sprint 101", state: "active", originBoardId: 7 }],
            startAt: 0,
            maxResults: 50,
            total: 1,
            isLast: true,
          },
        };
      }
      const rawIssue = {
        id: "20001",
        key: "POWER-1",
        fields: {
          summary: "Release task",
          issuetype: { id: "1", name: "Task", subtask: false },
          status: { id: "3", name: "Done", statusCategory: { key: "done" } },
          project: { id: "10000", key: "POWER", name: "Power View" },
          sprint: [{ id: 101, name: "Sprint 101", state: "active", boardId: 7 }],
        },
      };
      if (path.endsWith("/board/7/issue") || path.endsWith("/sprint/101/issue")) {
        return {
          ...common,
          data: { issues: [rawIssue], startAt: 0, maxResults: 100, total: 1 },
        };
      }
      if (path.endsWith("/search/jql")) {
        return { ...common, data: { issues: [rawIssue], isLast: true } };
      }
      return { ...common, data: {} };
    });
    const store = new SettingsStore(new MemoryStorage());
    render(<App runtime={runtimeFor(jiraRequest)} settingsStore={store} />);

    await screen.findByText("Connected as Alex");
    expect(
      await screen.findByRole("heading", { name: "What do you want to open?" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Gantt" })).toBeNull();

    fireEvent.click(
      screen
        .getByText("See every Jira status across the selected board.")
        .closest("button")!,
    );
    expect(
      await screen.findByRole("heading", { name: "Status chart" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Power Delivery Board: Done 1, 100%/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    fireEvent.click(
      screen
        .getByText("Explore schedule, dependencies, risks, and delivery dates.")
        .closest("button")!,
    );
    expect(await screen.findByRole("heading", { name: "Gantt" })).toBeInTheDocument();
    expect(await screen.findByRole("grid", { name: "Gantt tasks" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(
      await screen.findByRole("option", { name: "Power Delivery Board · scrum" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "Done" })).toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "JQL query" })).toHaveValue(
        "filter = 9001 ORDER BY Rank ASC",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    const reportsButton = await screen.findByRole("button", { name: "Reports" });
    jiraRequest.mockClear();
    fireEvent.click(reportsButton);

    expect(await screen.findByRole("heading", { name: "Reports" })).toBeInTheDocument();
    expect(await screen.findAllByText("Power Delivery Board")).not.toHaveLength(0);
    expect(screen.queryByRole("combobox", { name: "Board" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save mapping" }),
    ).not.toBeInTheDocument();
    expect(jiraRequest).not.toHaveBeenCalled();
    await expect(store.getSetup(context.baseUrl, "POWER", "7")).resolves.toMatchObject({
      board: { id: "7", name: "Power Delivery Board" },
      reporting: { completedStatusIds: ["3"], completedStatusNames: ["Done"] },
      jql: "filter = 9001 ORDER BY Rank ASC",
    });
  });
});
