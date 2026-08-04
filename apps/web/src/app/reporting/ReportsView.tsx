import {
  buildReportPeriod,
  localKyivDate,
  type BoardReportConfiguration,
  type GeneratedReportSnapshot,
  type JiraBoard,
  type ReportLanguage,
  type ReportScope,
  type ReportType,
  type SprintProgressMode,
} from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import {
  IndexedDbReportHistoryStore,
  MemoryReportHistoryStore,
  type ReportHistoryItem,
  type ReportHistoryStore,
} from "@power-view/storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { generateReport } from "./reporting-generator";
import { renderStandupText } from "./standup";

export interface ReportsViewProps {
  client: JiraClient;
  baseUrl: string;
  deploymentType: "cloud" | "data-center" | "server" | "unknown";
  board: JiraBoard;
  jql: string;
  statusMapping: BoardReportConfiguration;
  historyStore?: ReportHistoryStore;
}

function defaultHistoryStore(): ReportHistoryStore {
  return typeof indexedDB === "undefined"
    ? new MemoryReportHistoryStore()
    : new IndexedDbReportHistoryStore();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function percentage(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

function printableReport(
  snapshot: GeneratedReportSnapshot,
  language: ReportLanguage,
): void {
  const text = renderStandupText(snapshot, language);
  const escapeHtml = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const printWindow = window.open("", "power-view-report-print", "width=900,height=700");
  if (!printWindow) return;
  printWindow.document.write(
    `<!doctype html><html lang="${escapeHtml(language)}"><head><title>${escapeHtml(snapshot.board.name)} report</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#172b4d}pre{white-space:pre-wrap;font:14px/1.6 Arial,sans-serif}h1{font-size:24px}</style></head><body><h1>${escapeHtml(snapshot.board.name)} · ${escapeHtml(snapshot.request.type.toUpperCase())}</h1><pre>${escapeHtml(text)}</pre></body></html>`,
  );
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function reportDateRange(snapshot: GeneratedReportSnapshot): string {
  return `${formatDate(snapshot.request.period.start)} — ${formatDate(snapshot.request.period.end)}`;
}

function activityLabel(type: GeneratedReportSnapshot["changes"][number]["type"]): string {
  return {
    "issue-created": "Created",
    "issue-completed": "Completed",
    "issue-reopened": "Reopened",
    "status-changed": "Status changed",
    "assignee-changed": "Assignment changed",
    "story-points-changed": "Story points changed",
    "original-estimate-changed": "Estimate changed",
    "sprint-added": "Added to sprint",
    "sprint-removed": "Removed from sprint",
  }[type];
}

function DailyWeeklyOutput({
  snapshot,
  language,
  setStatusMessage,
}: {
  snapshot: GeneratedReportSnapshot;
  language: ReportLanguage;
  setStatusMessage: (message: string) => void;
}) {
  const summary = snapshot.result.executiveSummary;
  const activity = Object.entries(
    snapshot.result.activity.reduce<Record<string, number>>((counts, event) => {
      const label = activityLabel(event.type);
      counts[label] = (counts[label] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort((left, right) => right[1] - left[1]);
  const maxActivity = Math.max(...activity.map(([, count]) => count), 1);

  return (
    <div className="daily-weekly-workspace">
      <header className="reporting-output-header">
        <div>
          <p className="report-eyebrow">{snapshot.request.type.toUpperCase()} REPORT</p>
          <h3>{snapshot.board.name}</h3>
          <p>
            {reportDateRange(snapshot)} · Data as of{" "}
            {formatDate(snapshot.request.period.dataCutoff)}
          </p>
        </div>
        <div className="connection-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(renderStandupText(snapshot, language))
                .then(() => setStatusMessage("Stand-up text copied."))
            }
          >
            Copy stand-up
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => printableReport(snapshot, language)}
          >
            Generate PDF
          </button>
        </div>
      </header>

      {snapshot.completeness.warnings.length > 0 ? (
        <div className="report-alert report-alert-warning" role="alert">
          <strong>Data quality needs attention</strong>
          <ul>
            {snapshot.completeness.warnings.map((warning) => (
              <li key={warning.code}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="report-kpis" aria-label={`${snapshot.request.type} report summary`}>
        <article className="report-metric">
          <span>Issues in scope</span>
          <strong>{summary.totalIssues}</strong>
          <small>{summary.incompleteIssues} still open</small>
        </article>
        <article className="report-metric report-metric-success">
          <span>Completed</span>
          <strong>{summary.completedDuringPeriod}</strong>
          <small>{summary.completedIssues} completed in scope</small>
        </article>
        <article className="report-metric">
          <span>Created</span>
          <strong>{summary.createdIssues}</strong>
          <small>Added during this period</small>
        </article>
        <article className="report-metric">
          <span>Worklog</span>
          <strong>{(summary.worklogSeconds / 3600).toFixed(1)}h</strong>
          <small>Logged during this period</small>
        </article>
        <article
          className={`report-metric ${summary.unassignedIssues ? "report-metric-warning" : ""}`}
        >
          <span>Unassigned</span>
          <strong>{summary.unassignedIssues}</strong>
          <small>Issues without an owner</small>
        </article>
      </div>

      <div className="report-panels">
        <article className="report-panel">
          <div className="report-panel-heading">
            <div>
              <h3>Period activity</h3>
              <p>Changes recorded in Jira during the selected period.</p>
            </div>
            <strong>{snapshot.result.activity.length} events</strong>
          </div>
          {activity.length ? (
            <div className="report-activity-list">
              {activity.map(([label, count]) => (
                <div className="report-activity-row" key={label}>
                  <div>
                    <span>{label}</span>
                    <strong>{count}</strong>
                  </div>
                  <span className="report-activity-track">
                    <i style={{ width: `${(count / maxActivity) * 100}%` }} />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="report-unavailable">
              <strong>No activity recorded</strong>
              <p>There were no tracked changes in this period.</p>
            </div>
          )}
        </article>
        <article className="report-panel">
          <div className="report-panel-heading">
            <div>
              <h3>Delivery pulse</h3>
              <p>How work moved through the period.</p>
            </div>
          </div>
          <div className="report-pulse-list">
            <div>
              <span>Completed</span>
              <strong>{summary.completedDuringPeriod}</strong>
            </div>
            <div>
              <span>Reopened</span>
              <strong>{summary.reopenedDuringPeriod}</strong>
            </div>
            <div>
              <span>Created</span>
              <strong>{summary.createdIssues}</strong>
            </div>
            <div>
              <span>Time spent</span>
              <strong>{(summary.totalTimeSpentSeconds / 3600).toFixed(1)}h</strong>
            </div>
          </div>
        </article>
      </div>

      <section className="reporting-people daily-weekly-people">
        <div className="people-report-heading">
          <div>
            <h3>People</h3>
            <p>Ownership and contribution for this report.</p>
          </div>
          <span>{snapshot.result.people.length} contributors</span>
        </div>
        <div
          className="people-report-table"
          role="table"
          aria-label="Report contributors"
        >
          <div className="people-report-row people-report-header" role="row">
            <span>Person</span>
            <span>Assigned work</span>
            <span>Completed</span>
            <span>Worklog</span>
          </div>
          {snapshot.result.people.map((person) => (
            <div className="people-report-row" role="row" key={person.user.id}>
              <strong>{person.user.displayName}</strong>
              <span>{person.assignedIssues.length}</span>
              <span>{person.completedIssues.length}</span>
              <span>{(person.worklogSeconds / 3600).toFixed(1)}h</span>
            </div>
          ))}
          <div className="people-report-row" role="row">
            <strong>Unassigned</strong>
            <span>{snapshot.result.unassigned.issues.length}</span>
            <span>—</span>
            <span>—</span>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ReportsView({
  client,
  baseUrl,
  deploymentType,
  board,
  jql,
  statusMapping,
  historyStore = defaultHistoryStore(),
}: ReportsViewProps) {
  const [assigneeOptions, setAssigneeOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [sprints, setSprints] = useState<
    Array<{ id: string; name: string; state: string }>
  >([]);
  const [sprintId, setSprintId] = useState("");
  const [type, setType] = useState<ReportType>("daily");
  const [localDate, setLocalDate] = useState(localKyivDate());
  const [scope, setScope] = useState<ReportScope>({ kind: "team" });
  const [progressMode, setProgressMode] = useState<SprintProgressMode>("issue-count");
  const [language, setLanguage] = useState<ReportLanguage>("uk");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [snapshot, setSnapshot] = useState<GeneratedReportSnapshot>();
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await historyStore.list({ jiraBaseUrl: baseUrl, boardId: board.id }));
    } catch {
      setHistory([]);
    }
  }, [baseUrl, board.id, historyStore]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    let current = true;
    void (async () => {
      setError(undefined);
      try {
        const [issuePage, sprintPage] = await Promise.all([
          client.getBoardIssues({ boardId: board.id, pageSize: 100 }),
          board.type === "scrum"
            ? client.getBoardSprints({ boardId: board.id, maxResults: 50 })
            : Promise.resolve(undefined),
        ]);
        if (!current) return;
        setAssigneeOptions(
          [
            ...new Map(
              issuePage.values.flatMap((issue) =>
                issue.assignee
                  ? [
                      [
                        issue.assignee.id,
                        { id: issue.assignee.id, name: issue.assignee.displayName },
                      ],
                    ]
                  : [],
              ),
            ).values(),
          ].sort((left, right) => left.name.localeCompare(right.name)),
        );
        setSprints(sprintPage?.values ?? []);
        if (sprintPage?.values[0]) setSprintId(sprintPage.values[0].id);
      } catch (cause) {
        if (current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load board configuration.",
          );
      }
    })();
    return () => {
      current = false;
    };
  }, [board.id, board.type, client]);

  const generate = async () => {
    if (statusMapping.completedStatusIds.length === 0) {
      setError("Configure at least one completed status in Workspace Settings.");
      return;
    }
    if (type === "sprint" && !sprintId) {
      setError("Select a sprint before generating a Sprint Report.");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    setStatusMessage(undefined);
    try {
      const nextSnapshot = await generateReport({
        client,
        baseUrl,
        deploymentType,
        request: {
          type,
          boardId: board.id,
          jql,
          ...(type === "sprint" ? { sprintId } : {}),
          localDate,
          scope,
          language,
          ...(type === "sprint" ? { progressMode } : {}),
          statusMapping,
        },
        onProgress: (progress) => setLoadingMessage(progress.stage),
        signal: controller.signal,
      });
      await historyStore.save(nextSnapshot);
      setSnapshot(nextSnapshot);
      setStatusMessage("Report generated and saved to local history.");
      await refreshHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Report generation failed.");
    } finally {
      setLoading(false);
      setLoadingMessage("");
    }
  };

  const openHistory = async (id: string) => {
    const item = await historyStore.get(id);
    if (item) setSnapshot(item);
  };

  const deleteHistory = async (id: string) => {
    if (!window.confirm("Delete this local report snapshot?")) return;
    await historyStore.delete(id);
    if (snapshot?.id === id) setSnapshot(undefined);
    await refreshHistory();
  };

  const periodPreview = useMemo(() => {
    if (type === "sprint") return undefined;
    try {
      return buildReportPeriod(type, localDate);
    } catch {
      return undefined;
    }
  }, [localDate, type]);

  return (
    <section id="reports" className="reporting-card" aria-labelledby="reports-title">
      <div className="reporting-header">
        <div>
          <p className="setup-step">REPORTING</p>
          <h2 id="reports-title">Daily, Weekly and Sprint reports</h2>
        </div>
        <span className="setup-state">LOCAL HISTORY</span>
      </div>
      <div className="reporting-builder">
        <div className="reporting-grid">
          <label>
            <span>Report type</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as ReportType)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="sprint">Sprint</option>
            </select>
          </label>
          <label>
            <span>Workspace board</span>
            <output className="reporting-context-value">{board.name}</output>
          </label>
          <label>
            <span>Scope</span>
            <select
              value={scope.kind === "team" ? "team" : scope.userId}
              onChange={(event) =>
                setScope(
                  event.target.value === "team"
                    ? { kind: "team" }
                    : { kind: "assignee", userId: event.target.value },
                )
              }
            >
              <option value="team">Team</option>
              {assigneeOptions.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>
                  {assignee.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{type === "weekly" ? "Week date" : "Report date"}</span>
            <input
              type="date"
              value={localDate}
              onChange={(event) => setLocalDate(event.target.value)}
            />
          </label>
          {type === "sprint" ? (
            <label>
              <span>Sprint</span>
              <select
                value={sprintId}
                onChange={(event) => setSprintId(event.target.value)}
              >
                <option value="">Select sprint</option>
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.name} · {sprint.state}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>Output language</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as ReportLanguage)}
            >
              <option value="uk">Українська</option>
              <option value="en">English</option>
            </select>
          </label>
          {type === "sprint" ? (
            <label>
              <span>Completion basis</span>
              <select
                value={progressMode}
                onChange={(event) =>
                  setProgressMode(event.target.value as SprintProgressMode)
                }
              >
                <option value="issue-count">Issue count</option>
                <option value="story-points">Story Points</option>
                <option value="original-estimate">Original Estimate</option>
              </select>
            </label>
          ) : null}
        </div>
        {periodPreview ? (
          <p className="field-help">
            Period: {formatDate(periodPreview.start)} — {formatDate(periodPreview.end)}
          </p>
        ) : null}
        <p className="field-help">
          Board and completed statuses are inherited from Workspace Settings:{" "}
          {statusMapping.completedStatusNames.join(", ")}.
        </p>
        {error ? (
          <div className="setup-errors" role="alert">
            {error}
          </div>
        ) : null}
        {statusMessage ? (
          <p className="reporting-status-message" role="status">
            {statusMessage}
          </p>
        ) : null}
        <div className="setup-save-row">
          <button
            className="primary-button"
            type="button"
            disabled={loading || statusMapping.completedStatusIds.length === 0}
            onClick={() => void generate()}
          >
            {loading ? `Generating… ${loadingMessage}` : "Generate report"}
          </button>
        </div>
      </div>

      {snapshot ? (
        <div className="reporting-output" aria-live="polite">
          {snapshot.request.type !== "sprint" ? (
            <DailyWeeklyOutput
              snapshot={snapshot}
              language={language}
              setStatusMessage={setStatusMessage}
            />
          ) : null}
          {snapshot.request.type === "sprint" ? (
            <div className="reporting-output-header">
              <div>
                <p className="setup-step">GENERATED {formatDate(snapshot.generatedAt)}</p>
                <h3>
                  {snapshot.board.name} · {snapshot.request.type.toUpperCase()}
                </h3>
              </div>
              <div className="connection-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(renderStandupText(snapshot, language))
                      .then(() => setStatusMessage("Stand-up text copied."))
                  }
                >
                  Copy stand-up
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => printableReport(snapshot, language)}
                >
                  Generate PDF
                </button>
              </div>
            </div>
          ) : null}
          {snapshot.request.type === "sprint" ? (
            <>
              <div className="reporting-summary-grid">
                <div>
                  <span>Issues</span>
                  <strong>{snapshot.result.executiveSummary.totalIssues}</strong>
                </div>
                <div>
                  <span>Completed</span>
                  <strong>{snapshot.result.executiveSummary.completedIssues}</strong>
                </div>
                <div>
                  <span>Worklog</span>
                  <strong>
                    {(snapshot.result.executiveSummary.worklogSeconds / 3600).toFixed(1)}h
                  </strong>
                </div>
                <div>
                  <span>Unassigned</span>
                  <strong>{snapshot.result.executiveSummary.unassignedIssues}</strong>
                </div>
                {snapshot.result.sprint ? (
                  <div>
                    <span>Sprint completion</span>
                    <strong>
                      {percentage(snapshot.result.sprint.completion.percentage)}
                    </strong>
                  </div>
                ) : null}
              </div>
              {snapshot.result.sprint ? (
                <div className="reporting-scope">
                  <h4>Sprint scope changes</h4>
                  <p>
                    Added after start: {snapshot.result.sprint.addedAfterStart.length} ·
                    Removed after start: {snapshot.result.sprint.removedAfterStart.length}
                  </p>
                </div>
              ) : null}
              <div className="reporting-people">
                <h4>People</h4>
                {snapshot.result.people.map((person) => (
                  <article key={person.user.id}>
                    <strong>{person.user.displayName}</strong>
                    <span>
                      Tasks: {person.assignedIssues.length} · Completed:{" "}
                      {person.completedIssues.length} · Worklog:{" "}
                      {(person.worklogSeconds / 3600).toFixed(1)}h
                    </span>
                  </article>
                ))}
                <article>
                  <strong>Unassigned</strong>
                  <span>Tasks: {snapshot.result.unassigned.issues.length}</span>
                </article>
              </div>
              {snapshot.completeness.warnings.length > 0 ? (
                <div className="setup-errors">
                  <strong>Warnings</strong>
                  <ul>
                    {snapshot.completeness.warnings.map((warning) => (
                      <li key={warning.code}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="reporting-history">
        <div className="preview-header">
          <span>Report history</span>
          <span className="coming-soon">LOCAL</span>
        </div>
        {history.length === 0 ? (
          <p className="field-help">No generated reports yet.</p>
        ) : (
          history.map((item) => (
            <div className="reporting-history-row" key={item.id}>
              <button
                className="reporting-history-open"
                type="button"
                onClick={() => void openHistory(item.id)}
              >
                <strong>
                  {item.type.toUpperCase()} · {item.boardName}
                </strong>
                <span>
                  {formatDate(item.generatedAt)} ·{" "}
                  {item.complete ? "Complete" : "Partial"}
                </span>
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void deleteHistory(item.id)}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
