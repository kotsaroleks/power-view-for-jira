import type { JiraPageContext } from "@power-view/domain";
import type { ExtensionRuntime } from "@power-view/extension-messaging";
import { SettingsStore, type StorageArea } from "@power-view/storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SetupPanel, type ReadyGanttSchedule } from "./SetupPanel";

const context: JiraPageContext = {
  baseUrl: "https://example.atlassian.net",
  pageUrl: "https://example.atlassian.net/browse/POWER-42",
  detectedAt: "2026-07-23T01:00:00.000Z",
  deploymentType: "cloud",
  projectKey: "POWER",
  issueKey: "POWER-42",
  detectionSources: ["url"],
};

const projects = {
  values: [{ id: "10000", key: "POWER", name: "Power View" }],
  startAt: 0,
  maxResults: 25,
  total: 1,
  isLast: true,
};

const fields = [
  {
    id: "customfield_10010",
    name: "Planned Start",
    custom: true,
    schema: { type: "date" },
  },
  {
    id: "duedate",
    name: "Due date",
    custom: false,
    schema: { type: "date", system: "duedate" },
  },
  {
    id: "customfield_10014",
    name: "Epic Link",
    custom: true,
    schema: { type: "string" },
  },
] as const;

const issueSearchPage = {
  issues: [
    {
      id: "20001",
      key: "POWER-1",
      fields: {
        summary: "Prepare sanitized release plan",
        issuetype: { id: "10000", name: "Task", subtask: false },
        status: {
          id: "1",
          name: "To Do",
          statusCategory: { key: "new" },
        },
        project: { id: "10000", key: "POWER", name: "Power View" },
        customfield_10010: "2026-07-24",
        duedate: "2026-07-30",
      },
    },
    {
      id: "20002",
      key: "POWER-2",
      fields: {
        summary: "Review sanitized timeline",
        issuetype: { id: "10000", name: "Task", subtask: false },
        status: {
          id: "2",
          name: "In Progress",
          statusCategory: { key: "indeterminate" },
        },
        project: { id: "10000", key: "POWER", name: "Power View" },
        customfield_10010: "2026-07-26",
        duedate: "2026-08-01",
      },
    },
  ],
  isLast: true,
} as const;

const boardPage = {
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
};

const boardConfiguration = {
  id: 7,
  name: "Power Delivery Board",
  filter: { id: 9001 },
  columnConfig: {
    columns: [{ statuses: [{ id: "1" }, { id: "2" }, { id: "4" }, { id: "3" }] }],
  },
};

const projectStatuses = [
  {
    id: "10000",
    name: "Task",
    statuses: [
      { id: "1", name: "To Do" },
      { id: "2", name: "In Progress" },
      { id: "4", name: "In Review" },
      { id: "3", name: "Done" },
    ],
  },
];

const jiraStatuses = [
  { id: "1", name: "To Do" },
  { id: "2", name: "In Progress" },
  { id: "4", name: "In Review" },
  { id: "3", name: "Done" },
];

const boardIssuePage = {
  issues: [
    issueSearchPage.issues[0],
    issueSearchPage.issues[1],
    {
      ...issueSearchPage.issues[0],
      id: "20003",
      key: "POWER-3",
      fields: {
        ...issueSearchPage.issues[0].fields,
        summary: "Completed release",
        status: {
          id: "3",
          name: "Done",
          statusCategory: { key: "done" },
        },
      },
    },
  ],
  isLast: true,
};

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

function setupRuntime(options: { invalidJql?: boolean } = {}): ExtensionRuntime {
  return {
    sendMessage: vi.fn().mockImplementation((message: unknown) => {
      const request = message as {
        type: string;
        requestId: string;
        payload?: { path: string };
      };
      if (request.type === "JIRA_REQUEST" && request.payload) {
        if (options.invalidJql && request.payload.path.endsWith("/search/jql")) {
          return Promise.resolve({
            type: "ERROR",
            requestId: request.requestId,
            ok: false,
            error: {
              code: "INVALID_JQL",
              message: "Jira rejected the JQL query.",
              details: "The status value is not valid for this project.",
              retryable: false,
              httpStatus: 400,
            },
          });
        }
        const path = request.payload.path;
        const data = path.endsWith("/field")
          ? fields
          : path.endsWith("/status")
            ? jiraStatuses
            : path.endsWith("/project/POWER/statuses")
              ? projectStatuses
              : path === "/rest/agile/1.0/board"
                ? boardPage
                : path.endsWith("/board/7/configuration")
                  ? boardConfiguration
                  : path.endsWith("/board/7/issue")
                    ? boardIssuePage
                    : path.endsWith("/search/jql")
                      ? issueSearchPage
                      : projects;
        return Promise.resolve({
          type: "JIRA_RESPONSE",
          requestId: request.requestId,
          ok: true,
          status: 200,
          data,
          durationMs: 12,
          retryCount: 0,
        });
      }
      return Promise.resolve({
        type: "ACK",
        requestId: request.requestId,
        ok: true,
      });
    }),
  };
}

describe("SetupPanel", () => {
  it("loads metadata, ranks date fields, and persists a loadable setup", async () => {
    const store = new SettingsStore(new MemoryStorage());
    let readySchedule: ReadyGanttSchedule | undefined;
    render(
      <SetupPanel
        context={context}
        runtime={setupRuntime()}
        settingsStore={store}
        onScheduleReady={(schedule) => {
          readySchedule = schedule;
        }}
      />,
    );

    expect(
      await screen.findByRole("option", { name: "POWER · Power View" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Planned Start")).toBeInTheDocument();
    expect(screen.getByText("Due date")).toBeInTheDocument();
    expect(
      await screen.findByRole("option", { name: "Power Delivery Board · scrum" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("checkbox", { name: "Done" })).toBeChecked();
    expect(await screen.findByRole("checkbox", { name: "In Review" })).toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "JQL query" })).toHaveValue(
        "filter = 9001 ORDER BY Rank ASC",
      ),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Start date field" }), {
      target: { value: "customfield_10010" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "End date field" }), {
      target: { value: "duedate" },
    });
    fireEvent.click(screen.getByText("Default durations for inferred end dates"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Story default duration" }), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(
      await screen.findByText("Setup saved. Preparing your workspace…"),
    ).toBeInTheDocument();
    await expect(
      store.getSetup("https://example.atlassian.net", "POWER"),
    ).resolves.toMatchObject({
      project: { key: "POWER" },
      board: { id: "7", name: "Power Delivery Board", type: "scrum" },
      jql: "filter = 9001 ORDER BY Rank ASC",
      reporting: {
        completedStatusIds: ["3", "4"],
        completedStatusNames: ["Done", "In Review"],
      },
      fieldMapping: {
        startDateFieldId: "customfield_10010",
        endDateFieldId: "duedate",
      },
      defaultDurations: { story: 8 },
    });

    expect(await screen.findByText("2 normalized issues ready")).toBeInTheDocument();
    expect(screen.getByText("2 deterministic Gantt tasks")).toBeInTheDocument();
    await waitFor(() =>
      expect(readySchedule?.model.tasks.map((task) => task.issueKey)).toContain(
        "POWER-1",
      ),
    );
    expect(readySchedule?.queryKey).toContain("filter = 9001");
    expect(readySchedule?.board.id).toBe("7");
    expect(screen.getByRole("link", { name: "POWER-1" })).toHaveAttribute(
      "href",
      "https://example.atlassian.net/browse/POWER-1",
    );
  });

  it("blocks an invalid date mapping before storage", async () => {
    const store = new SettingsStore(new MemoryStorage());
    render(
      <SetupPanel context={context} runtime={setupRuntime()} settingsStore={store} />,
    );
    await screen.findByRole("option", { name: "POWER · Power View" });
    await screen.findByRole("checkbox", { name: "Done" });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "JQL query" })).not.toHaveValue(""),
    );

    for (const name of ["Start date field", "End date field"]) {
      fireEvent.change(screen.getByRole("combobox", { name }), {
        target: { value: "duedate" },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(
      await screen.findByText("Start and end dates must use different fields."),
    ).toBeInTheDocument();
    await expect(
      store.getSetup("https://example.atlassian.net", "POWER"),
    ).resolves.toBeUndefined();
  });

  it("displays Jira JQL validation errors", async () => {
    const store = new SettingsStore(new MemoryStorage());
    render(
      <SetupPanel
        context={context}
        runtime={setupRuntime({ invalidJql: true })}
        settingsStore={store}
      />,
    );
    await screen.findByRole("option", { name: "POWER · Power View" });
    await screen.findByRole("checkbox", { name: "Done" });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "JQL query" })).not.toHaveValue(""),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "JQL query" }), {
      target: { value: 'project = "POWER" AND status = MissingStatus' },
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview issues" }));

    expect(
      await screen.findByText("The status value is not valid for this project."),
    ).toBeInTheDocument();
  });
});
