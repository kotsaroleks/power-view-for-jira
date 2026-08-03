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
} from "@power-view/jira-client";
import { SettingsStore } from "@power-view/storage";
import { useEffect, useRef, useState } from "react";

import { GlobalErrorBoundary } from "./GlobalErrorBoundary";
import { GanttView } from "./gantt/GanttView";
import { BoardHealthReportView } from "./reports/BoardHealthReport";
import { SetupPanel, type ReadyGanttSchedule } from "./SetupPanel";

interface ClipboardWriter {
  writeText(value: string): Promise<void>;
}

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

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label={`${PRODUCT_NAME} home`}>
          <span className="brand-mark" aria-hidden="true">
            PV
          </span>
          <span>{PRODUCT_NAME}</span>
        </a>
        <nav className="top-navigation" aria-label="Power View navigation">
          <a href="#setup">Setup</a>
          {readySchedule ? <a href="#reports">Reports</a> : null}
          {readySchedule ? <a href="#gantt">Gantt</a> : null}
          <a href="#diagnostics">Diagnostics</a>
        </nav>
        <span className="version-badge">Jira edit beta · v0.1.0</span>
      </header>

      <main className="workspace">
        <section className="hero" aria-labelledby="welcome-title">
          <p className="eyebrow">ADVANCED JIRA VISUALIZATION</p>
          <h1 id="welcome-title">
            {context ? "Test your Jira connection." : "Open Power View from Jira."}
          </h1>
          <p className="hero-copy">
            {context
              ? "Power View uses your existing browser session for allowlisted Jira REST requests. Jira changes require explicit Edit mode and confirmation."
              : "Open a Jira page and use the extension popup to detect its project or issue context."}
          </p>

          {isLoading ? (
            <div className="notice" role="status">
              <span className="notice-icon" aria-hidden="true">
                i
              </span>
              <div>
                <strong>Reading Jira context…</strong>
              </div>
            </div>
          ) : context ? (
            <section className="app-context-card" aria-label="Current Jira context">
              <div className="app-context-heading">
                <span className="app-status-dot" aria-hidden="true" />
                Context detected
              </div>
              <dl>
                <div>
                  <dt>Jira instance</dt>
                  <dd>{context.baseUrl}</dd>
                </div>
                <div>
                  <dt>Deployment</dt>
                  <dd>{context.deploymentType}</dd>
                </div>
                {context.projectKey ? (
                  <div>
                    <dt>Project</dt>
                    <dd>{context.projectKey}</dd>
                  </div>
                ) : null}
                {context.issueKey ? (
                  <div>
                    <dt>Issue</dt>
                    <dd>{context.issueKey}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="connection-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={connection.status === "checking"}
                  onClick={() => void testConnection()}
                >
                  {connection.status === "checking"
                    ? "Testing connection…"
                    : "Test Jira connection"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void loadDiagnostics()}
                >
                  Open diagnostics
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
                  <p>
                    {connection.error.details ??
                      "Retry the test. Open Diagnostics if the problem continues."}
                  </p>
                  <span>Error code: {connection.error.code}</span>
                </div>
              ) : null}
            </section>
          ) : (
            <div className="notice notice-warning" role="alert">
              <span className="notice-icon" aria-hidden="true">
                !
              </span>
              <div>
                <strong>{contextError ?? "No Jira context is available."}</strong>
                <p>Return to Jira, open the extension popup, then select Detect again.</p>
              </div>
            </div>
          )}
        </section>

        <div className="side-stack">
          {context && connection.status === "authenticated" ? (
            <SetupPanel
              context={context}
              runtime={runtime}
              {...(settingsStore ? { settingsStore } : {})}
              onDiagnosticsChanged={() => void loadDiagnostics()}
              onScheduleReady={setReadySchedule}
            />
          ) : null}

          <aside
            id="diagnostics"
            className="diagnostics-card"
            aria-label="Connection diagnostics"
          >
            <div className="preview-header">
              <span>Diagnostics</span>
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
                        ? `${diagnostics.lastRequest.endpoint} · ${diagnostics.lastRequest.httpStatus ?? diagnostics.lastRequest.errorCode ?? "unknown"} · ${diagnostics.lastRequest.transport ?? "unknown transport"}${diagnostics.lastRequest.failureStage ? `/${diagnostics.lastRequest.failureStage}` : ""} · ${diagnostics.lastRequest.durationMs} ms`
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
                <p>
                  Run the connection test or open diagnostics to inspect request status
                  without exposing Jira session data.
                </p>
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
        </div>

        {readySchedule ? (
          <BoardHealthReportView
            issues={readySchedule.issues}
            model={readySchedule.model}
            projectKey={readySchedule.projectKey}
            projectName={readySchedule.projectName}
            jql={readySchedule.jql}
            loadedAt={readySchedule.loadedAt}
            truncated={readySchedule.truncated}
            sprintDataAvailable={readySchedule.sprintDataAvailable}
            storyPointsDataAvailable={readySchedule.storyPointsDataAvailable}
            {...(context?.boardId ? { preferredBoardId: context.boardId } : {})}
            {...(context?.sprintId ? { preferredSprintId: context.sprintId } : {})}
          />
        ) : null}

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
                    projectKey: readySchedule.projectKey,
                  },
                }
              : {})}
          />
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
