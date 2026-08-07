import {
  buildBoardHealthReport,
  buildSprintHealthReport,
  boardHealthStatusCategory,
  MAX_CONFIGURABLE_ISSUES,
  reportPercentage,
  type GanttScheduleModel,
  type JiraIssueSprint,
  type NormalizedIssue,
  type SprintMeasureBuckets,
} from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { ChevronIcon } from "../ChevronIcon";

export interface BoardHealthReportProps {
  client?: JiraClient;
  boardId?: string;
  issues: NormalizedIssue[];
  model: GanttScheduleModel;
  projectKey: string;
  projectName: string;
  jql: string;
  loadedAt: string;
  truncated: boolean;
  sprintDataAvailable: boolean;
  storyPointsDataAvailable: boolean;
  completedStatusIds?: string[];
  completedStatusNames?: string[];
  preferredBoardId?: string;
  preferredSprintId?: string;
}

interface Segment {
  label: string;
  value: number;
  className: string;
}

function SegmentBar({
  label,
  total,
  segments,
  issueDetails,
}: {
  label: string;
  total: number;
  segments: Segment[];
  issueDetails?: Record<string, NormalizedIssue[]>;
}) {
  const [expandedSegment, setExpandedSegment] = useState<string>();
  const expandedIssues = expandedSegment ? (issueDetails?.[expandedSegment] ?? []) : [];

  return (
    <div className="report-segment-group">
      <div
        className="report-segment-bar"
        role="img"
        aria-label={`${label}: ${segments
          .map(
            (segment) =>
              `${segment.label} ${segment.value} (${reportPercentage(segment.value, total)}%)`,
          )
          .join(", ")}`}
      >
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span
              key={segment.label}
              className={`report-segment ${segment.className}`}
              style={{ "--segment-size": segment.value } as CSSProperties}
            />
          ))}
      </div>
      <div className="report-legend">
        {segments.map((segment) => {
          const details = issueDetails?.[segment.label];
          const content = (
            <>
              <i className={segment.className} aria-hidden="true" />
              {segment.label}
              <strong>{reportPercentage(segment.value, total)}%</strong>
              <small>{segment.value}</small>
            </>
          );
          return details ? (
            <button
              className="report-legend-toggle"
              type="button"
              key={segment.label}
              aria-expanded={expandedSegment === segment.label}
              onClick={() =>
                setExpandedSegment((current) =>
                  current === segment.label ? undefined : segment.label,
                )
              }
            >
              {content}
            </button>
          ) : (
            <span key={segment.label}>{content}</span>
          );
        })}
      </div>
      {expandedSegment ? (
        <div className="report-segment-details">
          <div className="report-segment-details-heading">
            <strong>
              {expandedSegment} · {expandedIssues.length} issues
            </strong>
            <span>Click an issue to open it in Jira</span>
          </div>
          {expandedIssues.length > 0 ? (
            <div className="report-segment-issues">
              {expandedIssues.map((issue) => (
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
                    className={`gantt-status status-${issue.status.category ?? "unknown"}`}
                  >
                    {issue.status.name}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="report-segment-empty">No issues in this status.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  note: string;
  tone?: "neutral" | "success" | "warning";
}) {
  return (
    <article className={`report-metric report-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown refresh time"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function formatSprintRange(sprint: JiraIssueSprint): string {
  const format = (value?: string) => {
    if (!value) {
      return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? undefined
      : new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(date);
  };
  const start = format(sprint.startDate);
  const end = format(sprint.endDate);
  return start && end ? `${start} – ${end}` : "Sprint dates unavailable";
}

function sprintTimeNote(sprint: JiraIssueSprint): string {
  if (!sprint.endDate) {
    return "End date unavailable";
  }
  const end = new Date(sprint.endDate);
  if (Number.isNaN(end.getTime())) {
    return "End date unavailable";
  }
  const days = Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1_000));
  if (days === 0) {
    return "Ends today";
  }
  return days > 0
    ? `${days} calendar day${days === 1 ? "" : "s"} remaining`
    : `Ended ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
}

function personSegments(buckets: SprintMeasureBuckets): Segment[] {
  return [
    { label: "Done", value: buckets.done, className: "segment-done" },
    {
      label: "In progress",
      value: buckets.inProgress,
      className: "segment-progress",
    },
    {
      label: "Not started",
      value: buckets.notStarted,
      className: "segment-todo",
    },
    { label: "Unknown", value: buckets.unknown, className: "segment-unknown" },
  ];
}

function issueAssigneeKey(issue: NormalizedIssue): string {
  return (
    issue.assignee?.accountId ??
    issue.assignee?.username ??
    issue.assignee?.displayName ??
    "__unassigned__"
  );
}

// Stable references for omitted array props — a `= []` default parameter
// creates a new array every render, which would otherwise invalidate the
// `report` useMemo below on every render and cascade into an infinite loop
// via the sprint-issue-fetching effect (its deps include the memo's output).
const EMPTY_STATUS_LIST: string[] = [];

export function BoardHealthReportView({
  client,
  boardId,
  issues,
  model,
  projectKey,
  projectName,
  jql,
  loadedAt,
  truncated,
  sprintDataAvailable,
  storyPointsDataAvailable,
  completedStatusIds = EMPTY_STATUS_LIST,
  completedStatusNames = EMPTY_STATUS_LIST,
  preferredBoardId,
  preferredSprintId,
}: BoardHealthReportProps) {
  const report = useMemo(
    () =>
      buildBoardHealthReport(issues, {
        sprintDataAvailable,
        completedStatusIds,
        completedStatusNames,
        ...(preferredBoardId ? { preferredBoardId } : {}),
        ...(preferredSprintId ? { preferredSprintId } : {}),
      }),
    [
      completedStatusIds,
      completedStatusNames,
      issues,
      preferredBoardId,
      preferredSprintId,
      sprintDataAvailable,
    ],
  );
  const [boardActiveSprints, setBoardActiveSprints] = useState<JiraIssueSprint[]>();
  const [boardSprintsLoading, setBoardSprintsLoading] = useState(
    Boolean(client && boardId && typeof client.getBoardSprints === "function"),
  );
  useEffect(() => {
    if (!client || !boardId || typeof client.getBoardSprints !== "function") {
      setBoardActiveSprints(undefined);
      setBoardSprintsLoading(false);
      return;
    }
    const controller = new AbortController();
    setBoardSprintsLoading(true);
    void client
      .getBoardSprints({ boardId, state: ["active"], maxResults: 50 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) {
          setBoardActiveSprints(
            page.values.filter((sprint) => sprint.state === "active"),
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setBoardActiveSprints(undefined);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBoardSprintsLoading(false);
      });
    return () => controller.abort();
  }, [boardId, client]);
  const availableSprints = boardActiveSprints ?? report.activeSprints;
  const [selectedSprintId, setSelectedSprintId] = useState(preferredSprintId ?? "");
  const selectedSprint = boardSprintsLoading
    ? undefined
    : (availableSprints.find((sprint) => sprint.id === selectedSprintId) ??
      availableSprints[0]);
  const [sprintIssueIdsById, setSprintIssueIdsById] = useState<
    Record<string, Set<string>>
  >({});
  const [sprintIssueLoading, setSprintIssueLoading] = useState(false);
  const [sprintIssueLoadError, setSprintIssueLoadError] = useState(false);
  useEffect(() => {
    if (boardSprintsLoading || !client || !boardId || availableSprints.length === 0) {
      setSprintIssueIdsById({});
      setSprintIssueLoading(false);
      setSprintIssueLoadError(false);
      return;
    }
    const controller = new AbortController();
    setSprintIssueLoading(true);
    setSprintIssueIdsById({});
    setSprintIssueLoadError(false);
    void (async () => {
      try {
        const entries = await Promise.all(
          availableSprints.map(async (sprint) => {
            const issueIds = new Set<string>();
            let cursor: string | number | undefined;
            let isLast = false;
            while (!isLast) {
              const page = await client.getSprintIssues(
                {
                  boardId,
                  sprintId: sprint.id,
                  pageSize: 100,
                  // Only issue.id is kept below, so skip the standard field payload.
                  fieldsOverride: ["id"],
                  ...(cursor === undefined ? {} : { cursor }),
                },
                controller.signal,
              );
              page.values.forEach((issue) => issueIds.add(issue.id));
              cursor = page.nextCursor;
              isLast = page.isLast || cursor === undefined;
            }
            return [sprint.id, issueIds] as const;
          }),
        );
        if (!controller.signal.aborted)
          setSprintIssueIdsById(Object.fromEntries(entries));
      } catch {
        if (!controller.signal.aborted) {
          setSprintIssueIdsById({});
          setSprintIssueLoadError(true);
        }
      } finally {
        if (!controller.signal.aborted) setSprintIssueLoading(false);
      }
    })();
    return () => controller.abort();
  }, [availableSprints, boardId, boardSprintsLoading, client]);
  const sprintScopedIssues = useMemo(
    () =>
      selectedSprint && Object.keys(sprintIssueIdsById).length > 0
        ? issues.filter((issue) => sprintIssueIdsById[selectedSprint.id]?.has(issue.id))
        : client && boardId
          ? []
          : selectedSprint
            ? issues.filter((issue) =>
                issue.sprints?.some((candidate) => candidate.id === selectedSprint.id),
              )
            : [],
    [boardId, client, issues, selectedSprint, sprintIssueIdsById],
  );
  const blockedIssueIds = useMemo(
    () => new Set(model.tasks.filter((task) => task.isBlocked).map((task) => task.id)),
    [model.tasks],
  );
  const sprintReport = useMemo(
    () =>
      selectedSprint
        ? buildSprintHealthReport(sprintScopedIssues, selectedSprint, blockedIssueIds, {
            completedStatusIds,
            completedStatusNames,
          })
        : undefined,
    [
      blockedIssueIds,
      completedStatusIds,
      completedStatusNames,
      selectedSprint,
      sprintScopedIssues,
    ],
  );
  const activeSprintReports = useMemo(
    () =>
      availableSprints.map((sprint) => {
        const sprintIssues =
          Object.keys(sprintIssueIdsById).length > 0
            ? issues.filter((issue) => sprintIssueIdsById[sprint.id]?.has(issue.id))
            : client && boardId
              ? []
              : issues.filter((issue) =>
                  issue.sprints?.some((candidate) => candidate.id === sprint.id),
                );
        return {
          sprint,
          report: buildSprintHealthReport(sprintIssues, sprint, blockedIssueIds, {
            completedStatusIds,
            completedStatusNames,
          }),
        };
      }),
    [
      availableSprints,
      boardId,
      blockedIssueIds,
      client,
      completedStatusIds,
      completedStatusNames,
      issues,
      sprintIssueIdsById,
    ],
  );
  const sprintIssuesByPerson = useMemo(() => {
    const grouped = new Map<string, NormalizedIssue[]>();
    if (!selectedSprint) return grouped;
    for (const issue of sprintScopedIssues) {
      const key = issueAssigneeKey(issue);
      grouped.set(key, [...(grouped.get(key) ?? []), issue]);
    }
    return grouped;
  }, [selectedSprint, sprintScopedIssues]);
  const sprintIssuesByStatus = useMemo(() => {
    const grouped: Record<string, NormalizedIssue[]> = {};
    if (!selectedSprint) return grouped;
    for (const issue of sprintScopedIssues) {
      const category = boardHealthStatusCategory(issue, {
        completedStatusIds,
        completedStatusNames,
      });
      const label =
        category === "done"
          ? "Done"
          : category === "in-progress"
            ? "In progress"
            : category === "to-do"
              ? "Not started"
              : "Unknown";
      grouped[label] = [...(grouped[label] ?? []), issue];
    }
    return grouped;
  }, [completedStatusIds, completedStatusNames, selectedSprint, sprintScopedIssues]);
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set());
  const [showFinishedByPerson, setShowFinishedByPerson] = useState<Set<string>>(
    new Set(),
  );
  const planning = report.planning;
  const planned = planning ? planning.currentSprint + planning.futureSprint : undefined;

  return (
    <section
      id="board-health"
      className="report-workspace"
      aria-labelledby="report-title"
    >
      <header className="report-titlebar">
        <div>
          <p className="report-eyebrow">BOARD HEALTH</p>
          <h2 id="report-title">{projectName}</h2>
          <p>
            {projectKey} · Loaded JQL scope · Updated {formatTimestamp(loadedAt)}
          </p>
        </div>
        <details className="report-scope">
          <summary>View scope</summary>
          <code>{jql}</code>
        </details>
      </header>

      {truncated ? (
        <div className="report-alert report-alert-warning" role="alert">
          This report uses up to {MAX_CONFIGURABLE_ISSUES.toLocaleString()} matching
          issues. Narrow the JQL before using percentages for decisions.
        </div>
      ) : null}

      <div className="report-kpis" aria-label="Board health summary">
        <MetricCard
          label="Open now"
          value={report.open}
          note={`${reportPercentage(report.open, report.total)}% of loaded scope`}
        />
        <MetricCard
          label="Done"
          value={report.done}
          note={`${report.recentDone} completed in the last 30 days`}
          tone="success"
        />
        <MetricCard
          label="Planned"
          value={planned ?? "—"}
          note={
            planning && planned !== undefined
              ? `${reportPercentage(planned, planning.totalOpen)}% of open work`
              : "Sprint field is not mapped"
          }
        />
        <MetricCard
          label="Unscheduled"
          value={planning?.unscheduled ?? "—"}
          note={
            planning
              ? `${reportPercentage(planning.unscheduled, planning.totalOpen)}% of open work`
              : "Planning data unavailable"
          }
          tone={planning?.unscheduled ? "warning" : "neutral"}
        />
        <MetricCard
          label="Unassigned"
          value={report.unassignedOpen}
          note="Open issues without an owner"
          tone={report.unassignedOpen ? "warning" : "neutral"}
        />
      </div>

      <div className="report-panels">
        <article className="report-panel">
          <div className="report-panel-heading">
            <div>
              <h3>Work status</h3>
              <p>Current Jira status category across the loaded scope.</p>
            </div>
            <strong>{report.total} issues</strong>
          </div>
          <SegmentBar
            label="Work status"
            total={report.statuses.total}
            segments={[
              {
                label: "To do",
                value: report.statuses.toDo,
                className: "segment-todo",
              },
              {
                label: "In progress",
                value: report.statuses.inProgress,
                className: "segment-progress",
              },
              {
                label: "Done",
                value: report.statuses.done,
                className: "segment-done",
              },
              {
                label: "Unknown",
                value: report.statuses.unknown,
                className: "segment-unknown",
              },
            ]}
          />
        </article>

        <article className="report-panel">
          <div className="report-panel-heading">
            <div>
              <h3>Planning coverage</h3>
              <p>Active and future sprint allocation among open issues only.</p>
            </div>
            {planning ? <strong>{planning.totalOpen} open</strong> : null}
          </div>
          {planning ? (
            <SegmentBar
              label="Planning coverage"
              total={planning.totalOpen}
              segments={[
                {
                  label: "Current sprint",
                  value: planning.currentSprint,
                  className: "segment-current",
                },
                {
                  label: "Future sprint",
                  value: planning.futureSprint,
                  className: "segment-future",
                },
                {
                  label: "Unscheduled",
                  value: planning.unscheduled,
                  className: "segment-unscheduled",
                },
              ]}
            />
          ) : (
            <div className="report-unavailable">
              <strong>Sprint data unavailable</strong>
              <p>
                Map the Jira Sprint field in Project setup, then reload the issue scope.
              </p>
            </div>
          )}
        </article>
      </div>

      {availableSprints.length > 0 && !boardSprintsLoading ? (
        <section
          className="active-sprints-overview"
          aria-labelledby="active-sprints-title"
        >
          <div className="people-report-heading">
            <div>
              <p className="report-eyebrow">ACTIVE SPRINTS</p>
              <h3 id="active-sprints-title">Sprint statistics</h3>
              <p>Every sprint Jira currently reports as active on this board.</p>
            </div>
            <span>{activeSprintReports.length} active sprints</span>
          </div>
          {sprintIssueLoading ? (
            <div className="reporting-loading" role="status" aria-live="polite">
              <span className="reporting-spinner" aria-hidden="true" />
              <span>Loading sprint issues…</span>
            </div>
          ) : (
            <div className="active-sprints-overview-grid">
              {activeSprintReports.map(({ sprint, report: sprintSummary }) => (
                <article className="active-sprint-overview-card" key={sprint.id}>
                  <div className="active-sprint-overview-heading">
                    <strong>{sprint.name}</strong>
                    <span>{sprintSummary.issues.total} issues</span>
                  </div>
                  <div className="active-sprint-overview-metrics">
                    <span>
                      <strong>
                        {reportPercentage(
                          sprintSummary.issues.done,
                          sprintSummary.issues.total,
                        )}
                        %
                      </strong>
                      Done
                    </span>
                    <span>
                      <strong>{sprintSummary.issues.inProgress}</strong>
                      In progress
                    </span>
                    <span>
                      <strong>{sprintSummary.issues.notStarted}</strong>
                      Not started
                    </span>
                    <span>
                      <strong>{sprintSummary.unassigned}</strong>
                      Unassigned
                    </span>
                    <span>
                      <strong>{sprintSummary.blocked}</strong>
                      Blocked
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="sprint-report" aria-labelledby="sprint-report-title">
        <header className="sprint-report-heading">
          <div>
            <p className="report-eyebrow">CURRENT SPRINT</p>
            <h3 id="sprint-report-title">
              {selectedSprint?.name ?? "No active sprint in this scope"}
            </h3>
            <p>
              {selectedSprint
                ? `${formatSprintRange(selectedSprint)} · ${sprintTimeNote(selectedSprint)}`
                : "The report will appear when the loaded issues contain an active sprint."}
            </p>
          </div>
          {availableSprints.length > 1 ? (
            <label className="sprint-selector">
              <span>Active sprint</span>
              <select
                value={selectedSprint?.id ?? ""}
                onChange={(event) => setSelectedSprintId(event.target.value)}
              >
                {availableSprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </header>

        {!sprintDataAvailable ? (
          <div className="report-unavailable report-unavailable-large">
            <strong>Current-sprint data is unavailable</strong>
            <p>
              Configure the Sprint field in Project setup. The UI intentionally does not
              replace missing data with zeroes.
            </p>
          </div>
        ) : sprintIssueLoading ? (
          <div className="report-unavailable report-unavailable-large">
            <strong>Loading current-sprint issues</strong>
            <p>Jira is verifying the issues currently assigned to this sprint.</p>
          </div>
        ) : sprintIssueLoadError ? (
          <div className="report-unavailable report-unavailable-large">
            <strong>Current-sprint issues could not be loaded</strong>
            <p>
              Refresh the report to retry. Sprint metrics are intentionally not estimated.
            </p>
          </div>
        ) : sprintReport && sprintReport.issues.total > 0 ? (
          <>
            <div className="sprint-summary">
              <MetricCard
                label="Completed"
                value={`${reportPercentage(sprintReport.issues.done, sprintReport.issues.total)}%`}
                note={`${sprintReport.issues.done} of ${sprintReport.issues.total} issues`}
                tone="success"
              />
              <MetricCard
                label="Not completed"
                value={`${reportPercentage(
                  sprintReport.issues.total - sprintReport.issues.done,
                  sprintReport.issues.total,
                )}%`}
                note={`${sprintReport.issues.total - sprintReport.issues.done} issues remain`}
              />
              <MetricCard
                label="Unassigned"
                value={sprintReport.unassigned}
                note="Needs an owner"
                tone={sprintReport.unassigned ? "warning" : "neutral"}
              />
              <MetricCard
                label="Blocked"
                value={sprintReport.blocked}
                note="Blocked by status or dependency"
                tone={sprintReport.blocked ? "warning" : "neutral"}
              />
            </div>

            <article className="report-panel sprint-progress-panel">
              <div className="report-panel-heading">
                <div>
                  <h3>Sprint progress</h3>
                  <p>Done, in progress, and not started within this sprint only.</p>
                </div>
                <strong>{sprintReport.issues.total} issues</strong>
              </div>
              <SegmentBar
                label="Sprint progress"
                total={sprintReport.issues.total}
                segments={personSegments(sprintReport.issues)}
                issueDetails={sprintIssuesByStatus}
              />
            </article>

            <div className="people-report-heading">
              <div>
                <h3>Team breakdown</h3>
                <p>Current assignee and status, restricted to this sprint.</p>
              </div>
              {storyPointsDataAvailable ? (
                <span>
                  Story-point coverage:{" "}
                  {Math.round(sprintReport.storyPointsCoverage * 100)}%
                </span>
              ) : null}
            </div>

            <div
              className="people-report-table"
              role="table"
              aria-label="Sprint team breakdown"
            >
              <div className="people-report-row people-report-header" role="row">
                <span role="columnheader">Person</span>
                <span role="columnheader">Distribution</span>
                <span role="columnheader">Done</span>
                <span role="columnheader">In progress</span>
                <span role="columnheader">Not started</span>
                <span role="columnheader">Total</span>
              </div>
              {sprintReport.people.map((person) => (
                <div className="people-report-person" key={person.key}>
                  <div className="people-report-row" role="row">
                    <button
                      className="people-report-expand"
                      type="button"
                      aria-expanded={expandedPeople.has(person.key)}
                      aria-controls={`person-issues-${person.key}`}
                      onClick={() =>
                        setExpandedPeople((current) => {
                          const next = new Set(current);
                          if (next.has(person.key)) next.delete(person.key);
                          else next.add(person.key);
                          return next;
                        })
                      }
                    >
                      <span className="people-report-chevron" aria-hidden="true">
                        <ChevronIcon expanded={expandedPeople.has(person.key)} />
                      </span>
                      <strong>{person.name}</strong>
                    </button>
                    <div className="people-mini-bar" role="cell">
                      {personSegments(person.issues)
                        .filter((segment) => segment.value > 0)
                        .map((segment) => (
                          <span
                            key={segment.label}
                            className={segment.className}
                            style={{ "--segment-size": segment.value } as CSSProperties}
                            title={`${segment.label}: ${segment.value}`}
                          />
                        ))}
                    </div>
                    <span role="cell">{person.issues.done}</span>
                    <span role="cell">{person.issues.inProgress}</span>
                    <span role="cell">{person.issues.notStarted}</span>
                    <strong role="cell">{person.issues.total}</strong>
                  </div>
                  {expandedPeople.has(person.key)
                    ? (() => {
                        const personIssues = sprintIssuesByPerson.get(person.key) ?? [];
                        const showFinished = showFinishedByPerson.has(person.key);
                        const isFinished = (issue: NormalizedIssue) =>
                          boardHealthStatusCategory(issue, {
                            completedStatusIds,
                            completedStatusNames,
                          }) === "done";
                        const visibleIssues = showFinished
                          ? personIssues
                          : personIssues.filter((issue) => !isFinished(issue));
                        const finishedCount = personIssues.length - visibleIssues.length;
                        return (
                          <div
                            className="people-report-detail"
                            id={`person-issues-${person.key}`}
                            role="region"
                            aria-label={`${person.name} issues`}
                          >
                            <div className="people-report-detail-heading">
                              <strong>
                                {person.name} · {visibleIssues.length} issues
                              </strong>
                              <label className="report-show-finished">
                                <input
                                  type="checkbox"
                                  checked={showFinished}
                                  onChange={() =>
                                    setShowFinishedByPerson((current) => {
                                      const next = new Set(current);
                                      if (next.has(person.key)) next.delete(person.key);
                                      else next.add(person.key);
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
                                    className={`gantt-status status-${issue.status.category ?? "unknown"}`}
                                  >
                                    {issue.status.name}
                                  </span>
                                </a>
                              ))}
                            </div>
                          </div>
                        );
                      })()
                    : null}
                </div>
              ))}
            </div>

            {sprintReport.issues.unknown > 0 ||
            (storyPointsDataAvailable && sprintReport.storyPointsCoverage < 1) ? (
              <div className="report-alert report-alert-warning">
                {sprintReport.issues.unknown > 0 ? (
                  <span>
                    {sprintReport.issues.unknown} issue(s) use an unknown Jira status
                    category.
                  </span>
                ) : null}
                {storyPointsDataAvailable && sprintReport.storyPointsCoverage < 1 ? (
                  <span>
                    Story points are incomplete, so issue counts remain the primary
                    metric.
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="report-unavailable report-unavailable-large">
            <strong>No active sprint issues found</strong>
            <p>
              Confirm that the loaded JQL includes the active sprint and that the Sprint
              field is mapped correctly.
            </p>
          </div>
        )}
      </section>
    </section>
  );
}
