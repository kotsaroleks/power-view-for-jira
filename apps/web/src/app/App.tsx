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
  CloudTimesheetClient,
  CloudTeamsClient,
  createJiraClient,
  isJiraClientError,
  RuntimeJiraTransport,
  type JiraClient,
} from "@power-view/jira-client";
import {
  DEFAULT_APP_SECTIONS,
  SettingsStore,
  type AppSection,
} from "@power-view/storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SectionSettings } from "./SectionSettings";
import { useAppSections } from "./use-app-sections";
import { EstimationBoard } from "./estimation/EstimationBoard";
import { GlobalErrorBoundary } from "./GlobalErrorBoundary";
import { GanttV2Service } from "./gantt-v2/GanttV2Service";
import { Timesheet } from "./timesheet/Timesheet";
import { TimeReportPanel } from "./time-report/TimeReportPanel";
import { ReportsService } from "./reports/ReportsService";
import { BoardStatusReport } from "./status/BoardStatusReport";
import { WorkspaceSettingsService } from "./workspace/WorkspaceSettingsService";
import type { WorkspaceContext } from "./workspace/WorkspaceContext";

interface ClipboardWriter {
  writeText(value: string): Promise<void>;
}

type AppPage =
  | "settings"
  | "chooser"
  | "reports"
  | "gantt"
  | "status"
  | "estimation"
  | "diagnostics"
  | "timesheet";

export interface AppProps {
  connectionDescription?: string;
  runtime?: ExtensionRuntime & { reload?: () => void };
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
  connectionDescription = "Uses your active browser session. No credentials are stored.",
  runtime = chrome.runtime,
  clipboard = navigator.clipboard,
  settingsStore = browserSettingsStore,
}: AppProps) {
  const sections = useAppSections(settingsStore);
  const sectionEnabled = (section: AppSection) =>
    sections.ready && sections.visibility[section];
  const [context, setContext] = useState<JiraPageContext>();
  const [contextError, setContextError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionState>({ status: "idle" });
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>();
  const [diagnosticsError, setDiagnosticsError] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<string>();
  const [readySchedule, setReadySchedule] = useState<WorkspaceContext>();
  const [jiraClient, setJiraClient] = useState<JiraClient>();
  const [page, setPage] = useState<AppPage>("settings");
  const connectionAbort = useRef<AbortController | undefined>(undefined);
  const timesheetGuard = useRef<(() => boolean) | undefined>(undefined);
  const registerTimesheetGuard = useCallback((guard: (() => boolean) | undefined) => {
    timesheetGuard.current = guard;
  }, []);
  const connectedBaseUrl = context?.baseUrl;
  const timesheetApi = useMemo(
    () =>
      connectedBaseUrl
        ? new CloudTimesheetClient(
            new RuntimeJiraTransport({ runtime }),
            connectedBaseUrl,
          )
        : undefined,
    [connectedBaseUrl, runtime],
  );
  const teamsApi = useMemo(
    () =>
      connectedBaseUrl
        ? new CloudTeamsClient(new RuntimeJiraTransport({ runtime }), connectedBaseUrl)
        : undefined,
    [connectedBaseUrl, runtime],
  );

  const loadDiagnostics = useCallback(async (): Promise<
    DiagnosticsSnapshot | undefined
  > => {
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
  }, [runtime]);
  const refreshDiagnostics = useCallback(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

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

  const testConnection = useCallback(async () => {
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
  }, [context, runtime, loadDiagnostics]);

  const hasAutoConnected = useRef(false);
  useEffect(() => {
    if (!context || hasAutoConnected.current) return;
    hasAutoConnected.current = true;
    void testConnection();
  }, [context, testConnection]);

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

  // Distinguishes a genuine first-load landing on Settings (auto-continue is fine)
  // from any later, user-initiated visit to Settings (must not auto-bounce back) —
  // readySchedule alone can't tell these apart, since it resets on every fresh
  // mount (e.g. reopening the extension) just like a true first load would.
  const hasNavigatedRef = useRef(false);
  const navigate = (nextPage: AppPage) => {
    if (
      Object.hasOwn(DEFAULT_APP_SECTIONS, nextPage) &&
      !sectionEnabled(nextPage as AppSection)
    )
      return;
    if (
      page === "timesheet" &&
      nextPage !== page &&
      timesheetGuard.current &&
      !timesheetGuard.current()
    )
      return;
    hasNavigatedRef.current = true;
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
              {page === "timesheet"
                ? "Personal time"
                : (readySchedule?.projectKey ?? context?.projectKey ?? "Jira workspace")}
            </small>
          </span>
        </button>
        {authenticated ? (
          <nav className="top-navigation" aria-label="Power View navigation">
            <button
              type="button"
              disabled={!workspaceReady}
              aria-current={page === "chooser" ? "page" : undefined}
              onClick={() => navigate("chooser")}
            >
              Workspace
            </button>
            {sectionEnabled("reports") ? (
              <button
                type="button"
                disabled={!workspaceReady}
                aria-current={page === "reports" ? "page" : undefined}
                onClick={() => navigate("reports")}
              >
                Reports
              </button>
            ) : null}
            {sectionEnabled("timesheet") ? (
              <button
                type="button"
                disabled={context.deploymentType !== "cloud"}
                aria-current={page === "timesheet" ? "page" : undefined}
                onClick={() => navigate("timesheet")}
              >
                Timesheet
              </button>
            ) : null}
            {sectionEnabled("gantt") ? (
              <button
                type="button"
                disabled={!workspaceReady}
                aria-current={page === "gantt" ? "page" : undefined}
                onClick={() => navigate("gantt")}
              >
                Gantt
              </button>
            ) : null}
            {sectionEnabled("status") ? (
              <button
                type="button"
                disabled={!workspaceReady}
                aria-current={page === "status" ? "page" : undefined}
                onClick={() => navigate("status")}
              >
                Status
              </button>
            ) : null}
            {sectionEnabled("estimation") ? (
              <button
                type="button"
                disabled={!workspaceReady}
                aria-current={page === "estimation" ? "page" : undefined}
                onClick={() => navigate("estimation")}
              >
                Estimation
              </button>
            ) : null}
          </nav>
        ) : null}
        <div className="topbar-actions">
          <button
            className="settings-button"
            type="button"
            title="Reload Power View to apply the latest installed build"
            onClick={() => {
              if (
                page === "timesheet" &&
                timesheetGuard.current &&
                !timesheetGuard.current()
              )
                return;
              if ("reload" in runtime && typeof runtime.reload === "function") {
                runtime.reload();
              } else {
                window.location.reload();
              }
            }}
          >
            ↻ Update app
          </button>
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
        <section
          className="page-frame settings-page"
          aria-labelledby="settings-title"
          hidden={page !== "settings"}
        >
          <SectionSettings
            visibility={sections.visibility}
            ready={sections.ready}
            busy={sections.busy}
            disabled={sections.disabled}
            error={sections.error}
            onChange={sections.change}
          />
          <section className="setup-card" aria-labelledby="settings-title">
            <div className="setup-card-header">
              <div className="setup-card-heading">
                <span className="setup-icon" aria-hidden="true">
                  ⚙
                </span>
                <div>
                  <p className="report-eyebrow">WORKSPACE SETUP</p>
                  <h2 id="settings-title">Configure your Jira workspace</h2>
                  <p>{connectionDescription}</p>
                </div>
              </div>
              {context &&
              (connection.status === "authenticated" ||
                connection.status === "checking") ? (
                <div className={`connection-badge connection-badge-${connection.status}`}>
                  {connection.status === "checking" ? (
                    <>
                      <span className="reporting-spinner" aria-hidden="true" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <span className="app-status-dot" aria-hidden="true" />
                      Connected as {connection.user.displayName}
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {isLoading ? (
              <div className="notice" role="status">
                <span className="notice-icon" aria-hidden="true">
                  i
                </span>
                <strong>Reading Jira context…</strong>
              </div>
            ) : !context ? (
              <div className="notice notice-warning" role="alert">
                <span className="notice-icon" aria-hidden="true">
                  !
                </span>
                <div>
                  <strong>{contextError ?? "No Jira context is available."}</strong>
                  <p>Return to Jira and open Power View again from the board.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="app-context-summary">
                  <span className="app-status-dot" aria-hidden="true" />
                  <strong>Context detected</strong>
                  <span>{context.projectKey ?? "Not detected"}</span>
                  {context.boardId ? <span>Board {context.boardId}</span> : null}
                  {context.issueKey ? <span>{context.issueKey}</span> : null}
                  <span>{context.baseUrl}</span>
                </div>

                {connection.status === "error" ? (
                  <div className="notice notice-warning" role="alert">
                    <span className="notice-icon" aria-hidden="true">
                      !
                    </span>
                    <div>
                      <strong>{connection.error.message}</strong>
                      <p>{connection.error.details ?? "Retry the connection."}</p>
                      <span>Error code: {connection.error.code}</span>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void testConnection()}
                      >
                        Reconnect
                      </button>
                    </div>
                  </div>
                ) : authenticated ? (
                  <WorkspaceSettingsService
                    key={`${context.baseUrl}:${connection.user.accountId ?? connection.user.username ?? "user"}`}
                    context={context}
                    runtime={runtime}
                    {...(settingsStore ? { settingsStore } : {})}
                    autoContinue={!hasNavigatedRef.current}
                    active={page === "settings"}
                    onDiagnosticsChanged={refreshDiagnostics}
                    onWorkspaceReady={setReadySchedule}
                    onSetupComplete={(schedule) => {
                      setReadySchedule(schedule);
                      navigate("chooser");
                    }}
                    onQuickStart={(schedule) => {
                      setReadySchedule(schedule);
                      navigate("chooser");
                    }}
                  />
                ) : (
                  <div className="setup-loading" role="status">
                    <span className="reporting-spinner" aria-hidden="true" />
                    Connecting to Jira…
                  </div>
                )}
              </>
            )}
          </section>
        </section>

        {page === "chooser" && workspaceReady ? (
          <section className="page-frame chooser-page" aria-labelledby="chooser-title">
            <div className="chooser-heading">
              <span className="success-orb" aria-hidden="true">
                ✓
              </span>
              <p className="report-eyebrow">WORKSPACE READY</p>
              <h1 id="chooser-title">What do you want to open?</h1>
              <p>Your Jira connection and project settings are ready.</p>
            </div>
            {sections.ready && !Object.values(sections.visibility).some(Boolean) ? (
              <p className="notice">
                No sections are enabled. Open Settings to turn on the sections you need.
              </p>
            ) : null}
            <div className="tool-grid">
              {sectionEnabled("reports") ? (
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
              ) : null}
              {sectionEnabled("timesheet") ? (
                <button
                  className="tool-card tool-card-reports"
                  type="button"
                  onClick={() => navigate("timesheet")}
                >
                  <span className="tool-icon" aria-hidden="true">
                    T
                  </span>
                  <span className="tool-card-copy">
                    <small>TIME TRACKING</small>
                    <strong>Timesheet</strong>
                    <span>Review your logged time by issue and day.</span>
                  </span>
                  <span className="tool-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              ) : null}
              {sectionEnabled("gantt") ? (
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
                    <span>
                      Explore schedule, dependencies, risks, and delivery dates.
                    </span>
                  </span>
                  <span className="tool-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              ) : null}
              {sectionEnabled("status") ? (
                <button
                  className="tool-card tool-card-status"
                  type="button"
                  onClick={() => navigate("status")}
                >
                  <span className="tool-icon" aria-hidden="true">
                    S
                  </span>
                  <span className="tool-card-copy">
                    <small>OVERVIEW</small>
                    <strong>Status chart</strong>
                    <span>See every Jira status across the selected board.</span>
                  </span>
                  <span className="tool-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              ) : null}
              {sectionEnabled("estimation") ? (
                <button
                  className="tool-card tool-card-gantt"
                  type="button"
                  onClick={() => navigate("estimation")}
                >
                  <span className="tool-icon" aria-hidden="true">
                    E
                  </span>
                  <span className="tool-card-copy">
                    <small>RELEASE PREPARATION</small>
                    <strong>Estimation board</strong>
                    <span>
                      Estimate client scope, clarify requirements, and prepare QA
                      handoffs.
                    </span>
                  </span>
                  <span className="tool-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              ) : null}
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

        {page === "reports" &&
        sectionEnabled("reports") &&
        authenticated &&
        readySchedule ? (
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
                <p className="report-eyebrow">REPORTING</p>
                <h1>Reports</h1>
                <p>Generate decision-ready team updates from live Jira data.</p>
              </div>
            </div>
            <ReportsService
              workspace={readySchedule}
              pageContext={context}
              client={jiraClient!}
              {...(context.deploymentType === "cloud" &&
              timesheetApi &&
              teamsApi &&
              connection.user.accountId
                ? {
                    timeReport: (
                      <TimeReportPanel
                        key={`${context.baseUrl}:${connection.user.accountId}`}
                        api={timesheetApi}
                        teamsApi={teamsApi}
                        baseUrl={context.baseUrl}
                        accountId={connection.user.accountId}
                      />
                    ),
                  }
                : {})}
            />
          </section>
        ) : null}

        {page === "timesheet" &&
        sectionEnabled("timesheet") &&
        authenticated &&
        timesheetApi ? (
          <section className="timesheet-page">
            {context.deploymentType === "cloud" && connection.user.accountId ? (
              <Timesheet
                key={`${context.baseUrl}:${connection.user.accountId}`}
                api={timesheetApi}
                baseUrl={context.baseUrl}
                accountId={connection.user.accountId}
                userName={connection.user.displayName}
                {...(connection.user.timeZone
                  ? { jiraTimeZone: connection.user.timeZone }
                  : {})}
                {...(readySchedule?.jql ? { setupJql: readySchedule.jql } : {})}
                onGuardChange={registerTimesheetGuard}
              />
            ) : (
              <p role="alert">
                Timesheet requires a Jira Cloud connection with a stable account ID.
              </p>
            )}
          </section>
        ) : null}

        {page === "gantt" && sectionEnabled("gantt") && authenticated ? (
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
                <p className="report-eyebrow">PLANNING</p>
                <h1>Gantt</h1>
                <p>Review schedule health, dependencies, and delivery risk.</p>
              </div>
            </div>
            {readySchedule ? (
              <GanttV2Service
                workspace={readySchedule}
                {...(settingsStore ? { settingsStore } : {})}
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

        {page === "status" &&
        sectionEnabled("status") &&
        authenticated &&
        readySchedule ? (
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
                <p className="report-eyebrow">OVERVIEW</p>
                <h1>Status chart</h1>
                <p>Review the issue distribution for your selected Jira board.</p>
              </div>
            </div>
            <BoardStatusReport
              boardId={readySchedule.board.id}
              boardName={readySchedule.board.name}
              issues={readySchedule.issues}
              loadedAt={readySchedule.loadedAt}
              truncated={readySchedule.truncated}
            />
          </section>
        ) : null}

        {page === "estimation" &&
        sectionEnabled("estimation") &&
        authenticated &&
        readySchedule ? (
          <section className="page-frame tool-page tool-page-wide">
            <button
              className="back-button"
              type="button"
              onClick={() => navigate("chooser")}
            >
              ← Workspace
            </button>
            <EstimationBoard
              key={`${readySchedule.jiraBaseUrl}:${readySchedule.board.id}`}
              workspace={readySchedule}
            />
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
                <p className="report-eyebrow">SUPPORT</p>
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
