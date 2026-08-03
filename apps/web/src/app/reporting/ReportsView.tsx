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
  ReportSettingsStore,
  type ReportHistoryItem,
  type ReportHistoryStore,
} from "@power-view/storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { loadReportBoards } from "./load-report-boards";
import { generateReport } from "./reporting-generator";
import { renderStandupText } from "./standup";

interface StatusOption {
  id: string;
  name: string;
}

export interface ReportsViewProps {
  client: JiraClient;
  baseUrl: string;
  deploymentType: "cloud" | "data-center" | "server" | "unknown";
  projectKeyOrId?: string;
  currentBoardId?: string;
  settingsStore?: ReportSettingsStore;
  historyStore?: ReportHistoryStore;
}

function defaultSettingsStore(): ReportSettingsStore | undefined {
  return typeof chrome !== "undefined" && chrome.storage?.local
    ? new ReportSettingsStore(chrome.storage.local)
    : undefined;
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

export function ReportsView({
  client,
  baseUrl,
  deploymentType,
  projectKeyOrId,
  currentBoardId,
  settingsStore = defaultSettingsStore(),
  historyStore = defaultHistoryStore(),
}: ReportsViewProps) {
  const [boards, setBoards] = useState<JiraBoard[]>([]);
  const [boardId, setBoardId] = useState("");
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([]);
  const [assigneeOptions, setAssigneeOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [completedStatusIds, setCompletedStatusIds] = useState<string[]>([]);
  const [storedMapping, setStoredMapping] = useState<BoardReportConfiguration>();
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

  const selectedBoard = boards.find((board) => board.id === boardId);
  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await historyStore.list({ jiraBaseUrl: baseUrl }));
    } catch {
      setHistory([]);
    }
  }, [baseUrl, historyStore]);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const loadedBoards = await loadReportBoards(
          client,
          projectKeyOrId,
          currentBoardId,
        );
        if (!current) return;
        setBoards(loadedBoards);
        const initialBoard =
          loadedBoards.find((board) => board.id === currentBoardId) ?? loadedBoards[0];
        if (initialBoard) setBoardId(initialBoard.id);
      } catch (cause) {
        if (current)
          setError(
            cause instanceof Error ? cause.message : "Could not load Jira boards.",
          );
      }
      await refreshHistory();
    })();
    return () => {
      current = false;
    };
  }, [client, currentBoardId, projectKeyOrId, refreshHistory]);

  useEffect(() => {
    if (!boardId) return;
    let current = true;
    void (async () => {
      setError(undefined);
      try {
        const [board, boardConfiguration, issuePage] = await Promise.all([
          client.getBoard(boardId),
          client.getBoardConfiguration(boardId),
          client.getBoardIssues({ boardId, pageSize: 100 }),
        ]);
        if (!current) return;
        const statuses = [
          ...new Map(
            issuePage.values.map((issue) => {
              const id = issue.status.id ?? issue.status.name;
              return [id, { id, name: issue.status.name }];
            }),
          ).values(),
        ].sort((left, right) => left.name.localeCompare(right.name));
        setStatusOptions(statuses);
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
        const stored = await settingsStore?.getBoardConfiguration(baseUrl, boardId);
        if (!current) return;
        setStoredMapping(stored);
        setCompletedStatusIds(
          stored?.completedStatusIds ??
            statuses
              .filter((status) => status.name === "Done" || status.name === "In Review")
              .map((status) => status.id),
        );
        const sprintPage =
          board.type === "scrum"
            ? await client.getBoardSprints({ boardId, maxResults: 50 })
            : undefined;
        if (!current) return;
        setSprints(sprintPage?.values ?? []);
        if (sprintPage?.values[0]) setSprintId(sprintPage.values[0].id);
        void boardConfiguration;
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
  }, [baseUrl, boardId, client, settingsStore]);

  const saveMapping = async () => {
    if (!boardId || !selectedBoard) return;
    const names = statusOptions
      .filter((status) => completedStatusIds.includes(status.id))
      .map((status) => status.name);
    const mapping: BoardReportConfiguration = {
      schemaVersion: 1,
      jiraBaseUrl: baseUrl,
      boardId,
      completedStatusIds,
      completedStatusNames: names,
      ...(storedMapping?.storyPointsFieldId
        ? { storyPointsFieldId: storedMapping.storyPointsFieldId }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    await settingsStore?.saveBoardConfiguration(mapping);
    setStoredMapping(mapping);
    setStatusMessage("Status mapping saved locally.");
  };

  const generate = async () => {
    if (!boardId || completedStatusIds.length === 0) {
      setError("Select at least one completed status before generating a report.");
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
      const names = statusOptions
        .filter((status) => completedStatusIds.includes(status.id))
        .map((status) => status.name);
      const mapping: BoardReportConfiguration = {
        schemaVersion: 1,
        jiraBaseUrl: baseUrl,
        boardId,
        completedStatusIds,
        completedStatusNames: names,
        ...(storedMapping?.storyPointsFieldId
          ? { storyPointsFieldId: storedMapping.storyPointsFieldId }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      const nextSnapshot = await generateReport({
        client,
        baseUrl,
        deploymentType,
        request: {
          type,
          boardId,
          ...(type === "sprint" ? { sprintId } : {}),
          localDate,
          scope,
          language,
          ...(type === "sprint" ? { progressMode } : {}),
          statusMapping: mapping,
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
            <span>Board</span>
            <select value={boardId} onChange={(event) => setBoardId(event.target.value)}>
              <option value="">Select board</option>
              {boards.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name}
                </option>
              ))}
            </select>
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
        <fieldset className="reporting-status-fieldset">
          <legend>Completed statuses</legend>
          <p className="field-help">
            Choose exact Jira statuses treated as completed for this board. The mapping is
            stored only in this browser.
          </p>
          <div className="reporting-status-list">
            {statusOptions.map((status) => (
              <label key={status.id}>
                <input
                  type="checkbox"
                  checked={completedStatusIds.includes(status.id)}
                  onChange={() =>
                    setCompletedStatusIds((current) =>
                      current.includes(status.id)
                        ? current.filter((id) => id !== status.id)
                        : [...current, status.id],
                    )
                  }
                />
                <span>{status.name}</span>
              </label>
            ))}
          </div>
          <div className="setup-save-row">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void saveMapping()}
              disabled={!selectedBoard || completedStatusIds.length === 0}
            >
              Save mapping
            </button>
            {storedMapping ? (
              <span>Saved locally {formatDate(storedMapping.updatedAt)}</span>
            ) : null}
          </div>
        </fieldset>
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
            disabled={loading || !boardId || completedStatusIds.length === 0}
            onClick={() => void generate()}
          >
            {loading ? `Generating… ${loadingMessage}` : "Generate report"}
          </button>
        </div>
      </div>

      {snapshot ? (
        <div className="reporting-output" aria-live="polite">
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
