import {
  buildBoardHealthReport,
  buildSprintHealthReport,
  reportPercentage,
  type GanttScheduleModel,
  type JiraIssueSprint,
  type NormalizedIssue,
  type SprintMeasureBuckets,
} from "@power-view/domain";
import { useMemo, useState, type CSSProperties } from "react";

export interface BoardHealthReportProps {
  issues: NormalizedIssue[];
  model: GanttScheduleModel;
  projectKey: string;
  projectName: string;
  jql: string;
  loadedAt: string;
  truncated: boolean;
  sprintDataAvailable: boolean;
  storyPointsDataAvailable: boolean;
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
}: {
  label: string;
  total: number;
  segments: Segment[];
}) {
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
        {segments.map((segment) => (
          <span key={segment.label}>
            <i className={segment.className} aria-hidden="true" />
            {segment.label}
            <strong>{reportPercentage(segment.value, total)}%</strong>
            <small>{segment.value}</small>
          </span>
        ))}
      </div>
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

export function BoardHealthReportView({
  issues,
  model,
  projectKey,
  projectName,
  jql,
  loadedAt,
  truncated,
  sprintDataAvailable,
  storyPointsDataAvailable,
  preferredBoardId,
  preferredSprintId,
}: BoardHealthReportProps) {
  const report = useMemo(
    () =>
      buildBoardHealthReport(issues, {
        sprintDataAvailable,
        ...(preferredBoardId ? { preferredBoardId } : {}),
        ...(preferredSprintId ? { preferredSprintId } : {}),
      }),
    [issues, preferredBoardId, preferredSprintId, sprintDataAvailable],
  );
  const [selectedSprintId, setSelectedSprintId] = useState(preferredSprintId ?? "");
  const selectedSprint =
    report.activeSprints.find((sprint) => sprint.id === selectedSprintId) ??
    report.activeSprints[0];
  const blockedIssueIds = useMemo(
    () => new Set(model.tasks.filter((task) => task.isBlocked).map((task) => task.id)),
    [model.tasks],
  );
  const sprintReport = useMemo(
    () =>
      selectedSprint
        ? buildSprintHealthReport(issues, selectedSprint, blockedIssueIds)
        : undefined,
    [blockedIssueIds, issues, selectedSprint],
  );
  const planning = report.planning;
  const planned = planning ? planning.currentSprint + planning.futureSprint : undefined;

  return (
    <section id="board-health" className="report-workspace" aria-labelledby="report-title">
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
          This report uses the first 1,000 matching issues. Narrow the JQL before using
          percentages for decisions.
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
          {report.activeSprints.length > 1 ? (
            <label className="sprint-selector">
              <span>Active sprint</span>
              <select
                value={selectedSprint?.id ?? ""}
                onChange={(event) => setSelectedSprintId(event.target.value)}
              >
                {report.activeSprints.map((sprint) => (
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
                <div className="people-report-row" role="row" key={person.key}>
                  <strong role="cell">{person.name}</strong>
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
