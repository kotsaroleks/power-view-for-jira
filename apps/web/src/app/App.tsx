import {
  PRODUCT_NAME,
  type ConnectionState,
  type DiagnosticsSnapshot,
  type JiraPageContext,
  type SerializableAppError,
} from "@power-view/domain";
import {
  createContextGetRequest,
  createDiagnosticsGetRequest,
  sendExtensionRequest,
  type ExtensionRuntime,
} from "@power-view/extension-messaging";
import {
  createJiraClient,
  isJiraClientError,
  RuntimeJiraTransport,
  type JiraClient,
} from "@power-view/jira-client";
import { SettingsStore } from "@power-view/storage";
import { useEffect, useRef, useState } from "react";

import { GlobalErrorBoundary } from "./GlobalErrorBoundary";
import { GanttView } from "./gantt/GanttView";
import { BoardHealthReportView } from "./reports/BoardHealthReport";
import { SetupPanel, type ReadyGanttSchedule } from "./SetupPanel";
import { ReportsView } from "./reporting/ReportsView";

interface ClipboardWriter {
  writeText(value: string): Promise<void>;
}

type AppPage = "settings" | "chooser" | "reports" | "gantt" | "diagnostics";

export interface AppProps {
  runtime?: ExtensionRuntime;
  clipboard?: ClipboardWriter;
  settingsStore?: SettingsStore;
}

const browserSettingsStore =
  typeof chrome !== "undefined" && chrome.storage?.local
    ? new SettingsStore(chrome.storage.local)
    : undefined;

const UNKNOWN_CONNECTION_ERROR: SerializableAppError = {
  code: "UNKNOWN",
  message: "Power View could not complete the Jira connection test.",
  details: "Retry the test. Open Diagnostics if the problem continues.",
  retryable: true,
};

function diagnosticsJson(
  diagnostics: DiagnosticsSnapshot,
  connection: ConnectionState,
): string {
  return JSON.stringify(
    {
      ...diagnostics,
      ...(connection.status === "authenticated"
        ? { authenticatedUser: connection.user.displayName }
        : {}),
    },
    undefined,
    2,
  );
}

function AppContent({
  runtime = chrome.runtime,
  clipboard = navigator.clipboard,
  settingsStore = browserSettingsStore,
}: AppProps) {
  const [context, setContext] = useState<JiraPageContext>();
  const [contextError, setContextError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionState>({ status: "idle" });
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>();
  const [diagnosticsError, setDiagnosticsError] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<string>();
  const [readySchedule, setReadySchedule] = useState<ReadyGanttSchedule>();
  const [jiraClient, setJiraClient] = useState<JiraClient>();
  const [page, setPage] = useState<AppPage>("settings");
  const connectionAbort = useRef<AbortController | undefined>(undefined);

  const loadDiagnostics = async (): Promise<DiagnosticsSnapshot | undefined> => {
    try {
      const response = await sendExtensionRequest(runtime, createDiagnosticsGetRequest());
      if (response.type === "DIAGNOSTICS_RESULT") {
        setDiagnostics(response.diagnostics);
        setDiagnosticsError(undefined);
        return response.diagnostics;
      }
      setDiagnosticsError(
        response.type === "ERROR"
          ? response.error.message
          : "Power View returned an unexpected diagnostics response.",
      );
    } catch {
      setDiagnosticsError("Power View could not load diagnostics.");
    }
    return undefined;
  };

  useEffect(() => {
    let isCurrent = true;

    const loadContext = async () => {
      try {
        const response = await sendExtensionRequest(runtime, createContextGetRequest());
        if (!isCurrent) {
          return;
        }
        if (response.type === "CONTEXT_RESULT") {
          setContext(response.context);
          setContextError(undefined);
        } else if (response.type === "ERROR") {
          setContextError(response.error.message);
        } else {
          setContextError("Power View returned an unexpected context response.");
        }
      } catch {
        if (isCurrent) {
          setContextError("Power View could not read the latest Jira context.");
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    void loadContext();
    return () => {
      isCurrent = false;
      connectionAbort.current?.abort();
    };
  }, [runtime]);

  const testConnection = async () => {
    if (!context) {
      return;
    }

    connectionAbort.current?.abort();
    const controller = new AbortController();
    connectionAbort.current = controller;
    setConnection({ status: "checking" });
    setCopyStatus(undefined);

    const transport = new RuntimeJiraTransport({ runtime });
    const client = createJiraClient(transport, {
      baseUrl: context.baseUrl,
      deploymentType: context.deploymentType,
    });

    try {
      const [serverInfo, user] = await Promise.all([
        client.getServerInfo(controller.signal),
        client.getCurrentUser(controller.signal),
      ]);
      if (controller.signal.aborted) {
        return;
      }
      setConnection({
        status: "authenticated",
        serverInfo,
        user,
        connectedAt: new Date().toISOString(),
      });
      setJiraClient(client);
      void loadDiagnostics();
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      controller.abort();
      setConnection({
        status: "error",
        error: isJiraClientError(error) ? error.appError : UNKNOWN_CONNECTION_ERROR,
      });
      setJiraClient(undefined);
      void loadDiagnostics();
    }
  };

  const copyDiagnostics = async () => {
    setCopyStatus(undefined);
    const snapshot = diagnostics ?? (await loadDiagnostics());
    if (!snapshot) {
      return;
    }

    try {
      await clipboard.writeText(diagnosticsJson(snapshot, connection));
      setCopyStatus("Diagnostics copied.");
    } catch {
      setCopyStatus("Browser clipboard access was unavailable.");
    }
  };

  const navigate = (nextPage: AppPage) => {
    setPage(nextPage);
    if (!navigator.userAgent.toLowerCase().includes("jsdom")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const authenticated = context && connection.status === "authenticated";
  const workspaceReady = authenticated && Boolean(readySchedule);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          type="button"
          aria-label={`${PRODUCT_NAME} home`}
          onClick={() => navigate(workspaceReady ? "chooser" : "settings")}
        >
          <span className="brand-mark" aria-hidden="true">
            PV
          </span>
          <span className="brand-copy">
            <strong>{PRODUCT_NAME}</strong>
            <small>
              {readySchedule?.projectKey ?? context?.projectKey ?? "Jira workspace"}
            </small>
          </span>
        </button>
        {workspaceReady ? (
          <nav className="top-navigation" aria-label="Power View navigation">
            <button
              type="button"
              aria-current={page === "chooser" ? "page" : undefined}
              onClick={() => navigate("chooser")}
            >
              Workspace
            </button>
            <button
              type="button"
              aria-current={page === "reports" ? "page" : undefined}
              onClick={() => navigate("reports")}
            >
              Reports
            </button>
            <button
              type="button"
              aria-current={page === "gantt" ? "page" : undefined}
              onClick={() => navigate("gantt")}
            >
              Gantt
            </button>
          </nav>
        ) : null}
        <div className="topbar-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Open diagnostics"
            title="Diagnostics"
            onClick={() => {
              navigate("diagnostics");
              void loadDiagnostics();
            }}
          >
            ?
          </button>
          <button
            className="settings-button"
            type="button"
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            Settings
          </button>
        </div>
      </header>

      <main className="app-main">
        {page === "settings" ? (
          <section className="page-frame settings-page" aria-labelledby="settings-title">
            <div className="page-heading">
              <div>
                <p className="eyebrow">STEP 1 · WORKSPACE SETUP</p>
                <h1 id="settings-title">Configure your Jira workspace</h1>
                <p>
                  Connect your current Jira session, choose the project data, and save
                  once. Power View will prepare Reports and Gantt for you.
                </p>
              </div>
              <span className="step-badge">1 of 2</span>
            </div>

            <div className="settings-grid">
              <section className="connection-panel" aria-label="Jira connection">
                <div className="section-heading">
                  <span className="section-icon">01</span>
                  <div>
                    <h2>Jira connection</h2>
                    <p>Uses your active browser session. No credentials are stored.</p>
                  </div>
                </div>

                {isLoading ? (
                  <div className="notice" role="status">
                    <span className="notice-icon" aria-hidden="true">
                      i
                    </span>
                    <strong>Reading Jira context…</strong>
                  </div>
                ) : context ? (
                  <div className="app-context-card" aria-label="Current Jira context">
                    <div className="app-context-heading">
                      <span className="app-status-dot" aria-hidden="true" />
                      Context detected
                    </div>
                    <dl>
                      <div>
                        <dt>Project</dt>
                        <dd>{context.projectKey ?? "Not detected"}</dd>
                      </div>
                      {context.boardId ? (
                        <div>
                          <dt>Board</dt>
                          <dd>{context.boardId}</dd>
                        </div>
                      ) : null}
                      {context.issueKey ? (
                        <div>
                          <dt>Issue</dt>
                          <dd>{context.issueKey}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Jira</dt>
                        <dd>{context.baseUrl}</dd>
                      </div>
                    </dl>
                    <div className="connection-actions">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={connection.status === "checking"}
                        onClick={() => void testConnection()}
                      >
                        {connection.status === "checking"
                          ? "Connecting…"
                          : authenticated
                            ? "Reconnect"
                            : "Connect to Jira"}
                      </button>
                    </div>
                    {connection.status === "authenticated" ? (
                      <div className="connection-result connection-success" role="status">
                        <strong>Connected as {connection.user.displayName}</strong>
                        <p>
                          {connection.serverInfo.serverTitle ?? "Jira"} ·{" "}
                          {connection.serverInfo.deploymentType}
                          {connection.serverInfo.version
                            ? ` · ${connection.serverInfo.version}`
                            : ""}
                        </p>
                      </div>
                    ) : null}
                    {connection.status === "error" ? (
                      <div className="connection-result connection-error" role="alert">
                        <strong>{connection.error.message}</strong>
                        <p>{connection.error.details ?? "Retry the connection."}</p>
                        <span>Error code: {connection.error.code}</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="notice notice-warning" role="alert">
                    <span className="notice-icon" aria-hidden="true">
                      !
                    </span>
                    <div>
                      <strong>{contextError ?? "No Jira context is available."}</strong>
                      <p>Return to Jira and open Power View again from the board.</p>
                    </div>
                  </div>
                )}
              </section>

              <section className="configuration-panel" aria-label="Project configuration">
                <div className="section-heading section-heading-inline">
                  <span className="section-icon">02</span>
                  <div>
                    <h2>Project configuration</h2>
                    <p>Define the data source and date mapping used by your tools.</p>
                  </div>
                </div>
                {authenticated ? (
                  <SetupPanel
                    context={context}
                    runtime={runtime}
                    {...(settingsStore ? { settingsStore } : {})}
                    onDiagnosticsChanged={() => void loadDiagnostics()}
                    onScheduleReady={setReadySchedule}
                    onSetupComplete={(schedule) => {
                      setReadySchedule(schedule);
                      navigate("chooser");
                    }}
                  />
                ) : (
                  <div className="locked-panel">
                    <span aria-hidden="true">↗</span>
                    <strong>Connect Jira to continue</strong>
                    <p>Project fields and JQL become available after connection.</p>
                  </div>
                )}
              </section>
            </div>
          </section>
        ) : null}

        {page === "chooser" && workspaceReady ? (
          <section className="page-frame chooser-page" aria-labelledby="chooser-title">
            <div className="chooser-heading">
              <span className="success-orb" aria-hidden="true">
                ✓
              </span>
              <p className="eyebrow">WORKSPACE READY</p>
              <h1 id="chooser-title">What do you want to open?</h1>
              <p>Your Jira connection and project settings are ready.</p>
            </div>
            <div className="tool-grid">
              <button
                className="tool-card tool-card-reports"
                type="button"
                onClick={() => navigate("reports")}
              >
                <span className="tool-icon" aria-hidden="true">
                  R
                </span>
                <span className="tool-card-copy">
                  <small>COMMUNICATION</small>
                  <strong>Reports</strong>
                  <span>Create Daily, Weekly, and Sprint summaries for your team.</span>
                </span>
                <span className="tool-arrow" aria-hidden="true">
                  →
                </span>
              </button>
              <button
                className="tool-card tool-card-gantt"
                type="button"
                onClick={() => navigate("gantt")}
              >
                <span className="tool-icon" aria-hidden="true">
                  G
                </span>
                <span className="tool-card-copy">
                  <small>PLANNING</small>
                  <strong>Gantt</strong>
                  <span>Explore schedule, dependencies, risks, and delivery dates.</span>
                </span>
                <span className="tool-arrow" aria-hidden="true">
                  →
                </span>
              </button>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => navigate("settings")}
            >
              Edit workspace settings
            </button>
          </section>
        ) : null}

        {page === "reports" && authenticated && readySchedule ? (
          <section className="page-frame tool-page">
            <div className="tool-page-heading">
              <button
                className="back-button"
                type="button"
                onClick={() => navigate("chooser")}
              >
                ← Workspace
              </button>
              <div>
                <p className="eyebrow">REPORTING</p>
                <h1>Reports</h1>
                <p>Generate decision-ready team updates from live Jira data.</p>
              </div>
            </div>
            <BoardHealthReportView
              client={jiraClient!}
              boardId={readySchedule.board.id}
              issues={readySchedule.issues}
              model={readySchedule.model}
              projectKey={readySchedule.projectKey}
              projectName={readySchedule.projectName}
              jql={readySchedule.jql}
              loadedAt={readySchedule.loadedAt}
              truncated={readySchedule.truncated}
              sprintDataAvailable={readySchedule.sprintDataAvailable}
              storyPointsDataAvailable={readySchedule.storyPointsDataAvailable}
              completedStatusIds={readySchedule.reporting.completedStatusIds}
              completedStatusNames={readySchedule.reporting.completedStatusNames}
              preferredBoardId={readySchedule.board.id}
              {...(context.boardId === readySchedule.board.id && context.sprintId
                ? { preferredSprintId: context.sprintId }
                : {})}
            />
            <ReportsView
              client={jiraClient!}
              baseUrl={context.baseUrl}
              deploymentType={context.deploymentType}
              board={readySchedule.board}
              jql={readySchedule.jql}
              statusMapping={{
                schemaVersion: 1,
                jiraBaseUrl: context.baseUrl,
                boardId: readySchedule.board.id,
                completedStatusIds: readySchedule.reporting.completedStatusIds,
                completedStatusNames: readySchedule.reporting.completedStatusNames,
                ...(readySchedule.editing.fieldMapping.storyPointsFieldId
                  ? {
                      storyPointsFieldId:
                        readySchedule.editing.fieldMapping.storyPointsFieldId,
                    }
                  : {}),
                updatedAt: readySchedule.loadedAt,
              }}
            />
          </section>
        ) : null}

        {page === "gantt" && authenticated ? (
          <section className="page-frame tool-page tool-page-wide">
            <div className="tool-page-heading">
              <button
                className="back-button"
                type="button"
                onClick={() => navigate("chooser")}
              >
                ← Workspace
              </button>
              <div>
                <p className="eyebrow">PLANNING</p>
                <h1>Gantt</h1>
                <p>Review schedule health, dependencies, and delivery risk.</p>
              </div>
            </div>
            {readySchedule ? (
              <GanttView
                key={readySchedule.queryKey}
                model={readySchedule.model}
                editing={readySchedule.editing}
                {...(settingsStore
                  ? {
                      filterPersistence: {
                        store: settingsStore,
                        jiraBaseUrl: readySchedule.jiraBaseUrl,
                        workspaceKey: `${readySchedule.projectKey}:${readySchedule.board.id}`,
                      },
                    }
                  : {})}
              />
            ) : (
              <div className="empty-tool-state">
                <span aria-hidden="true">G</span>
                <h2>Gantt data is not prepared yet</h2>
                <p>
                  Return to Settings and choose Save and continue to load the schedule.
                </p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => navigate("settings")}
                >
                  Open Settings
                </button>
              </div>
            )}
          </section>
        ) : null}

        {page === "diagnostics" ? (
          <section
            className="page-frame diagnostics-page"
            aria-labelledby="diagnostics-title"
          >
            <div className="tool-page-heading">
              <button
                className="back-button"
                type="button"
                onClick={() => navigate(workspaceReady ? "chooser" : "settings")}
              >
                ← Back
              </button>
              <div>
                <p className="eyebrow">SUPPORT</p>
                <h1 id="diagnostics-title">Diagnostics</h1>
                <p>Sanitized technical information for troubleshooting Power View.</p>
              </div>
            </div>
            <aside className="diagnostics-card" aria-label="Connection diagnostics">
              <div className="preview-header">
                <span>Connection diagnostics</span>
                <span className="coming-soon">SANITIZED</span>
              </div>
              {diagnostics ? (
                <div className="diagnostics-content">
                  <dl>
                    <div>
                      <dt>Extension</dt>
                      <dd>{diagnostics.extensionVersion}</dd>
                    </div>
                    <div>
                      <dt>Browser</dt>
                      <dd>{diagnostics.browserVersion}</dd>
                    </div>
                    <div>
                      <dt>Jira</dt>
                      <dd>{diagnostics.jiraBaseUrl ?? "Not detected"}</dd>
                    </div>
                    <div>
                      <dt>Deployment</dt>
                      <dd>{diagnostics.deploymentType ?? "Unknown"}</dd>
                    </div>
                    <div>
                      <dt>Jira tab</dt>
                      <dd>{diagnostics.contextTabStatus ?? "Unknown"}</dd>
                    </div>
                    <div>
                      <dt>Host access</dt>
                      <dd>
                        {diagnostics.hostPermissionGranted === undefined
                          ? "Unknown"
                          : diagnostics.hostPermissionGranted
                            ? "Granted"
                            : "Missing"}
                      </dd>
                    </div>
                    <div>
                      <dt>Last request</dt>
                      <dd>
                        {diagnostics.lastRequest
                          ? `${diagnostics.lastRequest.endpoint} · ${diagnostics.lastRequest.httpStatus ?? diagnostics.lastRequest.errorCode ?? "unknown"} · ${diagnostics.lastRequest.durationMs} ms`
                          : "No request yet"}
                      </dd>
                    </div>
                    <div>
                      <dt>Cache</dt>
                      <dd>{diagnostics.cacheStatus}</dd>
                    </div>
                    <div>
                      <dt>Issues</dt>
                      <dd>{diagnostics.loadedIssueCount}</dd>
                    </div>
                  </dl>
                  <p>
                    Cookies, authorization headers, session values, and issue content are
                    never included.
                  </p>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void copyDiagnostics()}
                  >
                    Copy diagnostics
                  </button>
                  {copyStatus ? <span className="copy-status">{copyStatus}</span> : null}
                </div>
              ) : (
                <div className="diagnostics-empty">
                  <p>Load a sanitized diagnostics snapshot.</p>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void loadDiagnostics()}
                  >
                    Load diagnostics
                  </button>
                  {diagnosticsError ? <span role="alert">{diagnosticsError}</span> : null}
                </div>
              )}
            </aside>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export function App(props: AppProps) {
  return (
    <GlobalErrorBoundary>
      <AppContent {...props} />
    </GlobalErrorBoundary>
  );
}
