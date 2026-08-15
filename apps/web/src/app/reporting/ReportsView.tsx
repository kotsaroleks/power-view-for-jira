import {
  buildReportPeriod,
  localKyivDate,
  type BoardReportConfiguration,
  type GeneratedReportSnapshot,
  type JiraBoard,
  type ReportChangeEvent,
  type ReportingIssueSnapshot,
  type ReportLanguage,
  type ReportScope,
  type ReportType,
  type SprintProgressMode,
} from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import {
  IndexedDbJiraHistoryCache,
  IndexedDbReportHistoryStore,
  MemoryReportHistoryStore,
  type JiraHistoryCache,
  type ReportHistoryItem,
  type ReportHistoryStore,
} from "@power-view/storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildActivityLog,
  buildIssueTree,
  isIssueFinished,
  issueTypeAccentClass,
  pruneToChanged,
  type ActivityLogEntry,
  type IssueTreeNode,
} from "./activity-log";
import { ChevronIcon } from "../ChevronIcon";
import { createProgressThrottle, type ProgressThrottleHandle } from "./progress-throttle";
import { buildPrintableReportHtml, reportDateRange } from "./report-html";
import { generateReport, type ReportGenerationProgress } from "./reporting-generator";
import { renderStandupText } from "./standup";

export interface ReportsViewProps {
  client: JiraClient;
  baseUrl: string;
  deploymentType: "cloud" | "data-center" | "server" | "unknown";
  board: JiraBoard;
  jql: string;
  statusMapping: BoardReportConfiguration;
  historyStore?: ReportHistoryStore;
  historyCache?: JiraHistoryCache;
}

function defaultHistoryStore(): ReportHistoryStore {
  return typeof indexedDB === "undefined"
    ? new MemoryReportHistoryStore()
    : new IndexedDbReportHistoryStore();
}

// Without IndexedDB there is simply no cache: reports are generated as before, uncached.
function defaultHistoryCache(): JiraHistoryCache | undefined {
  return typeof indexedDB === "undefined" ? undefined : new IndexedDbJiraHistoryCache();
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

const progressNumberFormat = new Intl.NumberFormat("uk-UA");

const PROGRESS_STAGE_LABELS: Record<ReportGenerationProgress["stage"], string> = {
  board: "Loading board",
  sprint: "Loading sprint",
  issues: "Loading issues",
  changes: "Loading changes",
  worklogs: "Loading worklogs",
  calculating: "Calculating",
  saving: "Saving",
};

function formatProgressMessage(progress: ReportGenerationProgress): string {
  const label = PROGRESS_STAGE_LABELS[progress.stage];
  if (progress.loaded === undefined) return `${label}…`;
  const total =
    progress.total !== undefined
      ? ` / ${progressNumberFormat.format(progress.total)}`
      : "";
  const cached = progress.cached
    ? ` (${progressNumberFormat.format(progress.cached)} cached)`
    : "";
  return `${label}… ${progressNumberFormat.format(progress.loaded)}${total}${cached}`;
}
function printableReport(
  snapshot: GeneratedReportSnapshot,
  language: ReportLanguage,
): void {
  const printWindow = window.open("", "power-view-report-print", "width=900,height=700");
  if (!printWindow) return;
  printWindow.document.write(buildPrintableReportHtml(snapshot, language));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
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


function IssueTreeItem({
  node,
  changedIds,
  entriesByIssueKey,
  statusMapping,
  depth = 0,
}: {
  node: IssueTreeNode;
  changedIds: Set<string>;
  entriesByIssueKey: Map<string, ActivityLogEntry[]>;
  statusMapping: BoardReportConfiguration;
  depth?: number;
}) {
  const { issue, children } = node;
  const changed = changedIds.has(issue.id);
  const entries = entriesByIssueKey.get(issue.key) ?? [];
  const finished = isIssueFinished(issue, statusMapping);
  return (
    <li className={depth === 0 ? "report-issue-tree-root" : undefined}>
      <div
        className={`report-issue-tree-row ${changed ? "" : "report-issue-tree-row-context"}`}
      >
        <span
          className={`report-issue-tree-type ${issueTypeAccentClass(issue.issueType.name)}`}
        >
          {issue.issueType.name}
        </span>
        <a
          className="report-issue-tree-key"
          href={issue.browseUrl}
          target="_blank"
          rel="noreferrer"
        >
          {issue.key}
        </a>
        <span className="report-issue-tree-summary">{issue.summary}</span>
        <span
          className={`report-issue-tree-status ${finished ? "report-issue-tree-status-done" : ""}`}
        >
          {issue.status.name}
        </span>
        {issue.assignee ? (
          <span className="report-issue-tree-assignee">{issue.assignee.displayName}</span>
        ) : null}
      </div>
      {entries.length ? (
        <table className="report-issue-tree-changes">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Who did the change</th>
              <th scope="col">What changed</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.key}>
                <td>{formatDate(entry.occurredAt)}</td>
                <td>{entry.actorName}</td>
                <td>{entry.change}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {children.length ? (
        <ul className="report-issue-tree-children">
          {children.map((child) => (
            <IssueTreeItem
              key={child.issue.id}
              node={child}
              changedIds={changedIds}
              entriesByIssueKey={entriesByIssueKey}
              statusMapping={statusMapping}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function IssueScopeTree({
  issues,
  changes,
  activityLog,
  statusMapping,
}: {
  issues: ReportingIssueSnapshot[];
  changes: ReportChangeEvent[];
  activityLog: ActivityLogEntry[];
  statusMapping: BoardReportConfiguration;
}) {
  const changedIds = useMemo(
    () => new Set(changes.map((event) => event.issueId)),
    [changes],
  );
  const entriesByIssueKey = useMemo(() => {
    const map = new Map<string, ActivityLogEntry[]>();
    for (const entry of activityLog) {
      map.set(entry.issueKey, [...(map.get(entry.issueKey) ?? []), entry]);
    }
    return map;
  }, [activityLog]);
  const tree = useMemo(
    () => pruneToChanged(buildIssueTree(issues), changedIds),
    [issues, changedIds],
  );
  const changedCount = changedIds.size;
  return (
    <section className="reporting-people daily-weekly-people">
      <div className="people-report-heading">
        <div>
          <h3>Changed issues</h3>
          <p>
            Story → Task → Subtask/Bug hierarchy for issues that changed during this
            period, with who changed what and when. Faded rows are unchanged ancestors
            shown for context.
          </p>
        </div>
        <span>{changedCount} changed</span>
      </div>
      {tree.length ? (
        <ul className="report-issue-tree">
          {tree.map((node) => (
            <IssueTreeItem
              key={node.issue.id}
              node={node}
              changedIds={changedIds}
              entriesByIssueKey={entriesByIssueKey}
              statusMapping={statusMapping}
            />
          ))}
        </ul>
      ) : (
        <div className="report-unavailable">
          <strong>No issues changed</strong>
          <p>There were no tracked changes in this period.</p>
        </div>
      )}
    </section>
  );
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
  const activityLog = buildActivityLog(snapshot.result.activity);
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set());
  const [showFinishedByPerson, setShowFinishedByPerson] = useState<Set<string>>(
    new Set(),
  );
  const scope = snapshot.request.scope;
  const scopedIssues =
    scope.kind === "assignee"
      ? snapshot.issues.filter((issue) => issue.assignee?.id === scope.userId)
      : snapshot.issues;
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

      <IssueScopeTree
        issues={scopedIssues}
        changes={snapshot.result.activity}
        activityLog={activityLog}
        statusMapping={snapshot.statusMapping}
      />

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
            <span role="columnheader">Person</span>
            <span role="columnheader">Assigned work</span>
            <span role="columnheader">Completed</span>
            <span role="columnheader">Worklog</span>
          </div>
          {snapshot.result.people.map((person) => {
            const expanded = expandedPeople.has(person.user.id);
            const showFinished = showFinishedByPerson.has(person.user.id);
            const visibleIssues = showFinished
              ? person.assignedIssues
              : person.assignedIssues.filter(
                  (issue) => !isIssueFinished(issue, snapshot.statusMapping),
                );
            const finishedCount = person.assignedIssues.length - visibleIssues.length;
            return (
              <div className="people-report-person" key={person.user.id}>
                <div className="people-report-row" role="row">
                  <button
                    className="people-report-expand"
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`daily-person-issues-${person.user.id}`}
                    onClick={() =>
                      setExpandedPeople((current) => {
                        const next = new Set(current);
                        if (next.has(person.user.id)) next.delete(person.user.id);
                        else next.add(person.user.id);
                        return next;
                      })
                    }
                  >
                    <span className="people-report-chevron" aria-hidden="true">
                      <ChevronIcon expanded={expanded} />
                    </span>
                    <strong>{person.user.displayName}</strong>
                  </button>
                  <span className="people-report-assigned">
                    <strong>{visibleIssues.length}</strong>
                    {finishedCount > 0 ? (
                      <small>of {person.assignedIssues.length}</small>
                    ) : null}
                  </span>
                  <span className="people-report-completed">
                    {person.completedIssues.length}
                  </span>
                  <span>{(person.worklogSeconds / 3600).toFixed(1)}h</span>
                </div>
                {expanded ? (
                  <div
                    className="people-report-detail"
                    id={`daily-person-issues-${person.user.id}`}
                    role="region"
                    aria-label={`${person.user.displayName} issues`}
                  >
                    <div className="people-report-detail-heading">
                      <strong>
                        {person.user.displayName} · {visibleIssues.length} issues
                      </strong>
                      <label className="report-show-finished">
                        <input
                          type="checkbox"
                          checked={showFinished}
                          onChange={() =>
                            setShowFinishedByPerson((current) => {
                              const next = new Set(current);
                              if (next.has(person.user.id)) next.delete(person.user.id);
                              else next.add(person.user.id);
                              return next;
                            })
                          }
                        />
                        <span>
                          Show finished
                          {!showFinished && finishedCount > 0
                            ? ` (${finishedCount})`
                            : ""}
                        </span>
                      </label>
                      <span>Click an issue to open it in Jira</span>
                    </div>
                    <div className="people-report-issues">
                      {visibleIssues.map((issue) => (
                        <a
                          className="people-report-issue"
                          href={issue.browseUrl}
                          key={issue.id}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <span>
                            <strong>{issue.key}</strong>
                            <span>{issue.summary}</span>
                          </span>
                          <span
                            className={`report-issue-tree-status ${
                              isIssueFinished(issue, snapshot.statusMapping)
                                ? "report-issue-tree-status-done"
                                : ""
                            }`}
                          >
                            {issue.status.name}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
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
  historyCache = defaultHistoryCache(),
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
  const outputRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const progressThrottleRef = useRef<ProgressThrottleHandle | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      progressThrottleRef.current?.cancel();
    },
    [],
  );

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

  const generate = async (forceRefresh = false) => {
    if (statusMapping.completedStatusIds.length === 0) {
      setError("Configure at least one completed status in Workspace Settings.");
      return;
    }
    if (type === "sprint" && !sprintId) {
      setError("Select a sprint before generating a Sprint Report.");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const throttle = createProgressThrottle((progress) =>
      setLoadingMessage(formatProgressMessage(progress)),
    );
    progressThrottleRef.current = throttle;
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
        onProgress: throttle.onProgress,
        signal: controller.signal,
        ...(historyCache ? { historyCache } : {}),
        ...(forceRefresh ? { forceRefresh: true } : {}),
      });
      await historyStore.save(nextSnapshot);
      setSnapshot(nextSnapshot);
      setStatusMessage("Report generated and saved to local history.");
      await refreshHistory();
    } catch (cause) {
      if (controller.signal.aborted) {
        setStatusMessage("Report generation cancelled.");
      } else {
        setError(cause instanceof Error ? cause.message : "Report generation failed.");
      }
    } finally {
      throttle.cancel();
      if (progressThrottleRef.current === throttle) progressThrottleRef.current = null;
      if (controllerRef.current === controller) controllerRef.current = null;
      setLoading(false);
      setLoadingMessage("");
    }
  };

  const cancelGeneration = () => {
    controllerRef.current?.abort();
  };

  const openHistory = async (id: string) => {
    const item = await historyStore.get(id);
    if (item) {
      setSnapshot(item);
      setStatusMessage(undefined);
      setError(undefined);
    } else {
      setStatusMessage(undefined);
      setError("That report snapshot could not be found in local history.");
    }
  };

  useEffect(() => {
    if (!snapshot) return;
    const frame = requestAnimationFrame(() => {
      outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot]);

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
          <p className="report-eyebrow">REPORTING</p>
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
        <p className="field-help">
          Changelog and worklog history is cached per issue. Shift-click Generate report
          to re-read it from Jira — needed only when history was edited outside
          Jira&apos;s normal flow.
        </p>
        <div className="setup-save-row">
          <button
            className="primary-button"
            type="button"
            disabled={loading || statusMapping.completedStatusIds.length === 0}
            title="Shift-click to bypass the cached Jira history."
            onClick={(event) => void generate(event.shiftKey)}
          >
            {loading ? loadingMessage || "Generating…" : "Generate report"}
          </button>
          {loading ? (
            <button className="secondary-button" type="button" onClick={cancelGeneration}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="reporting-loading" role="status" aria-live="polite">
          <span className="reporting-spinner" aria-hidden="true" />
          <span>{loadingMessage || "Generating…"}</span>
        </div>
      ) : null}

      {!loading && snapshot ? (
        <div className="reporting-output" aria-live="polite" ref={outputRef}>
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
                <p className="report-eyebrow">
                  GENERATED {formatDate(snapshot.generatedAt)}
                </p>
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
                  {item.sprintName ? ` · ${item.sprintName}` : ""}
                </strong>
                <span>
                  {formatDate(item.periodStart)} – {formatDate(item.periodEnd)} ·{" "}
                  {item.scope.kind === "assignee"
                    ? (item.assigneeName ?? "Assignee")
                    : "Team"}{" "}
                  · {item.complete ? "Complete" : "Partial"}
                </span>
                <span>Generated {formatDate(item.generatedAt)}</span>
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
