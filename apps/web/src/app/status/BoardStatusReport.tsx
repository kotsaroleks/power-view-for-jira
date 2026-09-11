import type { NormalizedIssue } from "@power-view/domain";
import { useId, type CSSProperties } from "react";

import { buildStatusDistribution } from "./status-distribution";

export interface BoardStatusReportProps {
  boardId: string;
  boardName: string;
  issues: readonly NormalizedIssue[];
  loadedAt: string;
  truncated: boolean;
}

function pointOnCircle(angle: number, radius: number): { x: number; y: number } {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: 100 + radius * Math.cos(radians),
    y: 100 + radius * Math.sin(radians),
  };
}

function slicePath(startAngle: number, endAngle: number): string {
  const start = pointOnCircle(startAngle, 88);
  const end = pointOnCircle(endAngle, 88);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    "M 100 100",
    `L ${start.x} ${start.y}`,
    `A 88 88 0 ${largeArc} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function formatPercentage(value: number): string {
  if (value === 0 || value === 100 || Number.isInteger(value)) {
    return `${value.toFixed(0)}%`;
  }
  return `${value.toFixed(1)}%`;
}

function formatLoadedAt(value: string): string {
  const loadedAt = new Date(value);
  return Number.isNaN(loadedAt.getTime())
    ? value
    : loadedAt.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function BoardStatusReport({
  boardId,
  boardName,
  issues,
  loadedAt,
  truncated,
}: BoardStatusReportProps) {
  const titleId = useId();
  const descriptionId = useId();
  const distribution = buildStatusDistribution(issues);
  let currentAngle = 0;
  const chartLabel =
    issues.length === 0
      ? `${boardName}: no issues`
      : `${boardName}: ${distribution
          .map(
            (status) =>
              `${status.label} ${status.count}, ${formatPercentage(status.percentage)}`,
          )
          .join("; ")}`;

  return (
    <section className="status-report-card" aria-labelledby={titleId}>
      <header className="status-report-header">
        <div>
          <p className="report-eyebrow">BOARD STATUS</p>
          <h2 id={titleId}>{boardName}</h2>
          <p id={descriptionId}>Issue distribution across every Jira status.</p>
        </div>
        <dl className="status-report-meta">
          <div>
            <dt>Board</dt>
            <dd>{boardId}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>
              <time dateTime={loadedAt}>{formatLoadedAt(loadedAt)}</time>
            </dd>
          </div>
        </dl>
      </header>

      {truncated ? (
        <div className="report-alert" role="status">
          This workspace reached its issue limit. The chart reflects the loaded issues
          only.
        </div>
      ) : null}

      {distribution.length === 0 ? (
        <div className="status-report-empty">
          <span aria-hidden="true">○</span>
          <h3>No issues to chart</h3>
          <p>The selected board did not return any issues for the configured JQL.</p>
        </div>
      ) : (
        <div className="status-report-layout">
          <figure className="status-chart-figure">
            <div className="status-chart-wrap">
              <svg
                className="status-pie-chart"
                viewBox="0 0 200 200"
                role="img"
                aria-label={chartLabel}
                aria-describedby={descriptionId}
              >
                {distribution.map((status) => {
                  const startAngle = currentAngle;
                  const endAngle = currentAngle + status.percentage * 3.6;
                  currentAngle = endAngle;
                  return status.percentage === 100 ? (
                    <circle key={status.key} cx="100" cy="100" r="88" fill={status.color}>
                      <title>{`${status.label}: ${status.count} issues (100%)`}</title>
                    </circle>
                  ) : (
                    <path
                      key={status.key}
                      d={slicePath(startAngle, endAngle)}
                      fill={status.color}
                    >
                      <title>{`${status.label}: ${status.count} issues (${formatPercentage(status.percentage)})`}</title>
                    </path>
                  );
                })}
              </svg>
              <div className="status-chart-total" aria-hidden="true">
                <strong>{issues.length}</strong>
                <span>{issues.length === 1 ? "issue" : "issues"}</span>
              </div>
            </div>
            <figcaption>
              {distribution.length} {distribution.length === 1 ? "status" : "statuses"}
            </figcaption>
          </figure>

          <ol className="status-legend" aria-label="Status breakdown">
            {distribution.map((status) => (
              <li
                key={status.key}
                style={{ "--status-color": status.color } as CSSProperties}
              >
                <span className="status-legend-swatch" aria-hidden="true" />
                <div className="status-legend-copy">
                  <strong>{status.label}</strong>
                  <span>
                    {status.count} {status.count === 1 ? "issue" : "issues"}
                  </span>
                </div>
                <strong className="status-legend-percentage">
                  {formatPercentage(status.percentage)}
                </strong>
                <span
                  className="status-legend-bar"
                  aria-hidden="true"
                  style={{ "--status-size": status.percentage } as CSSProperties}
                />
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
