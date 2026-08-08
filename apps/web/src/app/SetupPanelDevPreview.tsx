import type { JiraPageContext } from "@power-view/domain";
import type { ExtensionRuntime } from "@power-view/extension-messaging";
import { SettingsStore, type StorageArea } from "@power-view/storage";

import { SetupPanel } from "./SetupPanel";

export const previewContext: JiraPageContext = {
  baseUrl: "https://stryker-emergencycare.atlassian.net",
  pageUrl: "https://stryker-emergencycare.atlassian.net/browse/LBR-42",
  detectedAt: new Date().toISOString(),
  deploymentType: "cloud",
  projectKey: "LBR",
  issueKey: "LBR-42",
  detectionSources: ["url"],
};

const projects = {
  values: [{ id: "10000", key: "LBR", name: "LIFENET Block Release" }],
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
  {
    id: "customfield_10020",
    name: "Story Points",
    custom: true,
    schema: { type: "number" },
  },
  {
    id: "customfield_10021",
    name: "Sprint",
    custom: true,
    schema: { type: "array", custom: "com.pyxis.greenhopper.jira:gh-sprint" },
  },
] as const;

// The board's column configuration references status 11375, which is not
// present in the project's status catalog, the sampled board issues, or the
// full instance status catalog below — reproducing a genuinely orphaned
// board-workflow status (e.g. deleted/migrated in Jira) rather than a
// fetch failure.
const boardConfiguration = {
  id: 1296,
  name: "8.1 Aria",
  filter: { id: 18363 },
  columnConfig: {
    columns: [
      {
        statuses: [
          { id: "1" },
          { id: "2" },
          { id: "3" },
          { id: "4" },
          { id: "5" },
          { id: "6" },
          { id: "7" },
          { id: "11375" },
        ],
      },
    ],
  },
};

const projectStatuses = [
  {
    id: "10000",
    name: "Task",
    statuses: [
      { id: "1", name: "Backlog" },
      { id: "2", name: "To Do" },
      { id: "3", name: "In Progress" },
      { id: "4", name: "In Testing" },
      { id: "5", name: "In Review" },
      { id: "6", name: "Acceptance" },
      { id: "7", name: "Done" },
    ],
  },
];

const jiraStatuses = projectStatuses[0]!.statuses;

const boardPage = {
  values: [
    { id: 1296, name: "8.1 Aria", type: "scrum", location: { projectKey: "LBR" } },
  ],
  startAt: 0,
  maxResults: 50,
  total: 1,
};

const sampleIssues = [
  {
    id: "20001",
    key: "LBR-1",
    fields: {
      summary: "Prepare release checklist",
      issuetype: { id: "10000", name: "Task", subtask: false },
      status: { id: "7", name: "Done", statusCategory: { key: "done" } },
      project: { id: "10000", key: "LBR", name: "LIFENET Block Release" },
    },
  },
  {
    id: "20002",
    key: "LBR-2",
    fields: {
      summary: "Validate telemetry pipeline",
      issuetype: { id: "10001", name: "Story", subtask: false },
      status: { id: "5", name: "In Review", statusCategory: { key: "indeterminate" } },
      project: { id: "10000", key: "LBR", name: "LIFENET Block Release" },
    },
  },
];

// getBoardIssues (Agile REST API) uses offset-paginated {issues, startAt,
// maxResults, total}; search/jql uses a different, cursor-based shape.
const boardIssuePage = {
  issues: sampleIssues,
  startAt: 0,
  maxResults: 100,
  total: sampleIssues.length,
};

const issueSearchPage = {
  issues: sampleIssues,
  isLast: true,
};

const currentUser = { accountId: "user-1", displayName: "Riley Chen" };
const serverInfo = { baseUrl: previewContext.baseUrl, version: "9.12.0" };
const diagnosticsSnapshot = {
  extensionVersion: "0.2.1",
  browserVersion: "127.0.0.0",
  cacheStatus: "ready",
  loadedIssueCount: 2,
  jiraBaseUrl: previewContext.baseUrl,
  deploymentType: "cloud",
};

export function previewRuntime(): ExtensionRuntime {
  return {
    sendMessage: (message: unknown) => {
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
          context: previewContext,
        });
      }
      if (request.type === "DIAGNOSTICS_GET") {
        return Promise.resolve({
          type: "DIAGNOSTICS_RESULT",
          requestId: request.requestId,
          ok: true,
          diagnostics: diagnosticsSnapshot,
        });
      }
      if (request.type === "JIRA_REQUEST" && request.payload) {
        const path = request.payload.path;
        const data = path.endsWith("/field")
          ? fields
          : path.endsWith("/myself")
            ? currentUser
            : path.endsWith("/serverInfo")
              ? serverInfo
              : path.endsWith("/status")
                ? jiraStatuses
                : path.endsWith("/statuses")
                  ? projectStatuses
                  : path === "/rest/agile/1.0/board"
                    ? boardPage
                    : path.endsWith("/configuration")
                      ? boardConfiguration
                      : path.endsWith("/issue")
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
      return Promise.resolve({ type: "ACK", requestId: request.requestId, ok: true });
    },
  };
}

export class MemoryStorage implements StorageArea {
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

export function SetupPanelDevPreview() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button">
          <span className="brand-mark" aria-hidden="true">
            PV
          </span>
          <span className="brand-copy">
            <strong>Power View for Jira</strong>
            <small>LBR</small>
          </span>
        </button>
        <div className="topbar-actions">
          <button className="settings-button" type="button" aria-current="page">
            Settings
          </button>
        </div>
      </header>
      <main className="app-main">
        <section className="page-frame settings-page" aria-labelledby="settings-title">
          <section className="setup-card" aria-labelledby="settings-title">
            <div className="setup-card-header">
              <div>
                <p className="report-eyebrow">WORKSPACE SETUP</p>
                <h2 id="settings-title">Configure your Jira workspace</h2>
                <p>Uses your active browser session. No credentials are stored.</p>
              </div>
            </div>
            <div className="app-context-summary">
              <span className="app-status-dot" aria-hidden="true" />
              <strong>Context detected</strong>
              <span>LBR</span>
              <span>Board 1296</span>
              <span>{previewContext.baseUrl}</span>
            </div>
            <SetupPanel
              context={previewContext}
              runtime={previewRuntime()}
              settingsStore={new SettingsStore(new MemoryStorage())}
              autoContinue={false}
            />
          </section>
        </section>
      </main>
    </div>
  );
}
