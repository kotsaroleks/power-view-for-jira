import type { ExtensionRuntime } from "@power-view/extension-messaging";
import { SettingsStore, type StorageArea } from "@power-view/storage";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("hides optional sections by default, saves toggle changes, and restores them after reopening", async () => {
    const store = new SettingsStore(new MemoryStorage());
    const runtime = runtimeFor((path, requestId) => ({
      type: "JIRA_RESPONSE",
      requestId,
      ok: true,
      status: 200,
      durationMs: 1,
      retryCount: 0,
      data: path.endsWith("/myself")
        ? { accountId: "alex", displayName: "Alex" }
        : path.endsWith("/serverInfo")
          ? {
              baseUrl: context.baseUrl,
              deploymentType: "Cloud",
              versionNumbers: [1001, 0, 0],
            }
          : path.endsWith("/field")
            ? []
            : { values: [], total: 0, startAt: 0, maxResults: 50, isLast: true },
    }));
    const view = render(<App runtime={runtime} settingsStore={store} />);
    await screen.findByText("Connected as Alex");
    const reports = screen.getByRole("switch", { name: "Reports" });
    const estimation = screen.getByRole("switch", { name: "Estimation board" });
    await waitFor(() => expect(reports).toBeEnabled());
    expect(reports).not.toBeChecked();
    expect(estimation).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Reports" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Estimation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Timesheet" })).toBeVisible();
    fireEvent.click(reports);
    await waitFor(() => expect(reports).toBeChecked());
    expect(screen.getByRole("button", { name: "Reports" })).toBeVisible();
    fireEvent.click(estimation);
    await waitFor(() => expect(estimation).toBeChecked());
    expect(screen.getByRole("button", { name: "Estimation" })).toBeVisible();
    view.unmount();
    render(<App runtime={runtime} settingsStore={store} />);
    await screen.findByText("Connected as Alex");
    const restored = screen.getByRole("switch", { name: "Reports" });
    await waitFor(() => expect(restored).toBeChecked());
    expect(screen.getByRole("switch", { name: "Estimation board" })).toBeChecked();
    fireEvent.click(restored);
    await waitFor(() => expect(restored).not.toBeChecked());
    expect(screen.queryByRole("button", { name: "Reports" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Estimation board" })).toBeChecked();
  });

  it("retains the previous visibility and explains a failed settings write", async () => {
    const store = new SettingsStore(new MemoryStorage());
    vi.spyOn(store, "saveSectionVisibility").mockRejectedValue(
      new Error("Unavailable storage"),
    );
    render(<App runtime={runtimeFor()} settingsStore={store} />);
    const panel = screen.getByRole("region", { name: "App sections" });
    const toggle = within(panel).getByRole("switch", { name: "Reports" });
    await waitFor(() => expect(toggle).toBeEnabled());
    fireEvent.click(toggle);
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "could not be saved",
    );
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
  });

  it("reloads the extension from the workspace update button", async () => {
    const reload = vi.fn();
    render(<App runtime={{ ...runtimeFor(), reload }} />);
    await screen.findByText(context.baseUrl);
    fireEvent.click(screen.getByRole("button", { name: "↻ Update app" }));
    expect(reload).toHaveBeenCalledOnce();
  });

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

  it("opens the personal timesheet without selecting or loading a board", async () => {
    const requests: string[] = [];
    const runtime = runtimeFor((path, requestId) => {
      requests.push(path);
      const data = path.endsWith("/myself")
        ? { accountId: "alex", displayName: "Alex" }
        : path.endsWith("/serverInfo")
          ? {
              baseUrl: context.baseUrl,
              deploymentType: "Cloud",
              versionNumbers: [1001, 0, 0],
            }
          : path.endsWith("/search/jql")
            ? { issues: [], isLast: true }
            : path.endsWith("/field")
              ? []
              : { values: [], startAt: 0, maxResults: 50, total: 0, isLast: true };
      return {
        type: "JIRA_RESPONSE",
        requestId,
        ok: true,
        status: 200,
        durationMs: 1,
        retryCount: 0,
        data,
      };
    });
    render(<App runtime={runtime} />);
    await screen.findByText("Connected as Alex");
    fireEvent.click(screen.getByRole("button", { name: "Timesheet" }));
    expect(
      await screen.findByText("Choose a board to see your tasks"),
    ).toBeInTheDocument();
    expect(requests.some((path) => /\/board\/\d+\/issue$/.test(path))).toBe(false);
    expect(requests).toContain("/rest/api/3/search/jql");
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
      if (path.endsWith("/worklog")) {
        return {
          ...common,
          data: { worklogs: [], startAt: 0, maxResults: 100, total: 0 },
        };
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
    expect(
      screen.queryByText("Create Daily, Weekly, and Sprint summaries for your team."),
    ).toBeNull();
    expect(
      screen.queryByText(
        "Estimate client scope, clarify requirements, and prepare QA handoffs.",
      ),
    ).toBeNull();

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
      screen.getByText("Review your logged time by issue and day.").closest("button")!,
    );
    expect(await screen.findByRole("heading", { name: "Timesheet" })).toBeInTheDocument();
    expect(
      await screen.findByText("Choose a board to see your tasks"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timesheet" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    fireEvent.click(
      screen
        .getByText("Explore schedule, dependencies, risks, and delivery dates.")
        .closest("button")!,
    );
    expect(await screen.findByRole("heading", { name: "Gantt" })).toBeInTheDocument();
    expect(await screen.findByRole("grid", { name: "Gantt tasks" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    // Reopening Settings keeps the loaded workspace available; no second
    // Save and continue is needed just to enable another section.
    expect(screen.getByRole("button", { name: "Workspace" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Gantt" })).toBeEnabled();
    expect(
      await screen.findByRole("option", { name: "Power Delivery Board · scrum" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "Done" })).toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "JQL query" })).toHaveValue(
        "filter = 9001 ORDER BY Rank ASC",
      ),
    );

    const reportsToggle = screen.getByRole("switch", { name: "Reports" });
    expect(reportsToggle).not.toBeChecked();
    fireEvent.click(reportsToggle);
    await waitFor(() => expect(reportsToggle).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(
      await screen.findByText(
        "Create Daily, Weekly, and Sprint summaries for your team.",
      ),
    ).toBeVisible();
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
