import type {
  BoardReportConfiguration,
  GeneratedReportSnapshot,
  ReportChangeEvent,
  ReportLanguage,
  ReportingIssueSnapshot,
} from "@power-view/domain";

import {
  buildActivityLog,
  buildIssueTree,
  isIssueFinished,
  issueTypeAccentClass,
  pruneToChanged,
  type ActivityLogEntry,
  type IssueTreeNode,
} from "./activity-log";

import tokensCss from "@power-view/ui/tokens.css?raw";
import globalCss from "../../styles/global.css?raw";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function reportDateRange(snapshot: GeneratedReportSnapshot): string {
  return `${formatDate(snapshot.request.period.start)} — ${formatDate(snapshot.request.period.end)}`;
}

function renderChangesTable(entries: ActivityLogEntry[]): string {
  if (entries.length === 0) return "";
  const rows = entries
    .map(
      (entry) => `<tr>
        <td>${escapeHtml(formatDate(entry.occurredAt))}</td>
        <td>${escapeHtml(entry.actorName)}</td>
        <td>${escapeHtml(entry.change)}</td>
      </tr>`,
    )
    .join("");
  return `<table class="report-issue-tree-changes">
    <thead>
      <tr><th scope="col">Time</th><th scope="col">Who did the change</th><th scope="col">What changed</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderTreeNode(
  node: IssueTreeNode,
  changedIds: Set<string>,
  entriesByIssueKey: Map<string, ActivityLogEntry[]>,
  statusMapping: BoardReportConfiguration,
  depth: number,
): string {
  const { issue, children } = node;
  const changed = changedIds.has(issue.id);
  const entries = entriesByIssueKey.get(issue.key) ?? [];
  const finished = isIssueFinished(issue, statusMapping);
  const rowClass = `report-issue-tree-row ${changed ? "" : "report-issue-tree-row-context"}`;
  const assignee = issue.assignee
    ? `<span class="report-issue-tree-assignee">${escapeHtml(issue.assignee.displayName)}</span>`
    : "";
  const childrenHtml = children.length
    ? `<ul class="report-issue-tree-children">${children
        .map((child) =>
          renderTreeNode(child, changedIds, entriesByIssueKey, statusMapping, depth + 1),
        )
        .join("")}</ul>`
    : "";
  return `<li${depth === 0 ? ' class="report-issue-tree-root"' : ""}>
    <div class="${rowClass}">
      <span class="report-issue-tree-type ${issueTypeAccentClass(issue.issueType.name)}">${escapeHtml(issue.issueType.name)}</span>
      <a class="report-issue-tree-key" href="${escapeHtml(issue.browseUrl)}" target="_blank" rel="noreferrer">${escapeHtml(issue.key)}</a>
      <span class="report-issue-tree-summary">${escapeHtml(issue.summary)}</span>
      <span class="report-issue-tree-status ${finished ? "report-issue-tree-status-done" : ""}">${escapeHtml(issue.status.name)}</span>
      ${assignee}
    </div>
    ${renderChangesTable(entries)}
    ${childrenHtml}
  </li>`;
}

function renderIssueScopeTree(
  issues: ReportingIssueSnapshot[],
  changes: ReportChangeEvent[],
  statusMapping: BoardReportConfiguration,
): string {
  const changedIds = new Set(changes.map((event) => event.issueId));
  const activityLog = buildActivityLog(changes);
  const entriesByIssueKey = new Map<string, ActivityLogEntry[]>();
  for (const entry of activityLog) {
    entriesByIssueKey.set(entry.issueKey, [
      ...(entriesByIssueKey.get(entry.issueKey) ?? []),
      entry,
    ]);
  }
  const tree = pruneToChanged(buildIssueTree(issues), changedIds);
  const body = tree.length
    ? `<ul class="report-issue-tree">${tree
        .map((node) => renderTreeNode(node, changedIds, entriesByIssueKey, statusMapping, 0))
        .join("")}</ul>`
    : `<div class="report-unavailable"><strong>No issues changed</strong><p>There were no tracked changes in this period.</p></div>`;
  return `<section class="reporting-people daily-weekly-people">
    <div class="people-report-heading">
      <div>
        <h3>Changed issues</h3>
        <p>Story → Task → Subtask/Bug hierarchy for issues that changed during this period, with who changed what and when. Faded rows are unchanged ancestors shown for context.</p>
      </div>
      <span>${changedIds.size} changed</span>
    </div>
    ${body}
  </section>`;
}

function renderKpis(snapshot: GeneratedReportSnapshot): string {
  const summary = snapshot.result.executiveSummary;
  return `<div class="report-kpis" aria-label="${escapeHtml(snapshot.request.type)} report summary">
    <article class="report-metric">
      <span>Issues in scope</span>
      <strong>${summary.totalIssues}</strong>
      <small>${summary.incompleteIssues} still open</small>
    </article>
    <article class="report-metric report-metric-success">
      <span>Completed</span>
      <strong>${summary.completedDuringPeriod}</strong>
      <small>${summary.completedIssues} completed in scope</small>
    </article>
    <article class="report-metric">
      <span>Created</span>
      <strong>${summary.createdIssues}</strong>
      <small>Added during this period</small>
    </article>
    <article class="report-metric">
      <span>Worklog</span>
      <strong>${(summary.worklogSeconds / 3600).toFixed(1)}h</strong>
      <small>Logged during this period</small>
    </article>
    <article class="report-metric ${summary.unassignedIssues ? "report-metric-warning" : ""}">
      <span>Unassigned</span>
      <strong>${summary.unassignedIssues}</strong>
      <small>Issues without an owner</small>
    </article>
  </div>`;
}

function renderPeopleTable(snapshot: GeneratedReportSnapshot): string {
  const rows = snapshot.result.people
    .map(
      (person) => `<div class="people-report-row" role="row">
        <strong>${escapeHtml(person.user.displayName)}</strong>
        <span>${person.assignedIssues.length}</span>
        <span>${person.completedIssues.length}</span>
        <span>${(person.worklogSeconds / 3600).toFixed(1)}h</span>
      </div>`,
    )
    .join("");
  return `<section class="reporting-people daily-weekly-people">
    <div class="people-report-heading">
      <div>
        <h3>People</h3>
        <p>Ownership and contribution for this report.</p>
      </div>
      <span>${snapshot.result.people.length} contributors</span>
    </div>
    <div class="people-report-table" role="table" aria-label="Report contributors">
      <div class="people-report-row people-report-header" role="row">
        <span role="columnheader">Person</span>
        <span role="columnheader">Assigned work</span>
        <span role="columnheader">Completed</span>
        <span role="columnheader">Worklog</span>
      </div>
      ${rows}
      <div class="people-report-row" role="row">
        <strong>Unassigned</strong>
        <span>${snapshot.result.unassigned.issues.length}</span>
        <span>—</span>
        <span>—</span>
      </div>
    </div>
  </section>`;
}

export function buildPrintableReportHtml(
  snapshot: GeneratedReportSnapshot,
  language: ReportLanguage,
): string {
  const scope = snapshot.request.scope;
  const scopedIssues =
    scope.kind === "assignee"
      ? snapshot.issues.filter((issue) => issue.assignee?.id === scope.userId)
      : snapshot.issues;
  const treeHtml = renderIssueScopeTree(
    scopedIssues,
    snapshot.result.activity,
    snapshot.statusMapping,
  );
  const kpisHtml = renderKpis(snapshot);
  const peopleHtml = renderPeopleTable(snapshot);
  const title = `${escapeHtml(snapshot.board.name)} · ${escapeHtml(snapshot.request.type.toUpperCase())}`;
  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(snapshot.board.name)} report</title>
<style>
${tokensCss}
${globalCss}
body { padding: 32px; max-width: 960px; margin: 0 auto; }
</style>
</head>
<body>
<header class="reporting-output-header">
  <div>
    <p class="report-eyebrow">${escapeHtml(snapshot.request.type.toUpperCase())} REPORT</p>
    <h3>${title}</h3>
    <p>${escapeHtml(reportDateRange(snapshot))} · Data as of ${escapeHtml(formatDate(snapshot.request.period.dataCutoff))}</p>
  </div>
</header>
${kpisHtml}
${treeHtml}
${peopleHtml}
</body>
</html>`;
}
