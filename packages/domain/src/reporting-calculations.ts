import type {
  ExecutiveSummary,
  NormalizedReportUser,
  PercentageMetric,
  PersonReportBlock,
  ReportChangeEvent,
  ReportingIssueSnapshot,
  ReportResult,
  ReportScope,
  ReportType,
  ReportWorklog,
  SprintProgressMode,
  SprintReportResult,
  SprintScopeChange,
  UnassignedReportBlock,
  UnestimatedBreakdown,
} from "./reporting";
import type { BoardReportConfiguration, ReportPeriod } from "./reporting";

interface ScopeInput {
  issues: ReportingIssueSnapshot[];
  changes: ReportChangeEvent[];
  worklogs: ReportWorklog[];
  period: ReportPeriod;
  type: ReportType;
  scope: ReportScope;
  statusMapping: BoardReportConfiguration;
}

function completed(
  issue: ReportingIssueSnapshot,
  mapping: BoardReportConfiguration,
): boolean {
  return issue.status.id
    ? mapping.completedStatusIds.includes(issue.status.id)
    : mapping.completedStatusNames.includes(issue.status.name);
}

function inPeriod(value: string, period: ReportPeriod): boolean {
  const timestamp = new Date(value).getTime();
  return (
    timestamp >= new Date(period.start).getTime() &&
    timestamp < new Date(period.dataCutoff).getTime()
  );
}

function percentage(
  numerator: number,
  denominator: number,
  unit: PercentageMetric["unit"],
  estimatedIssueCount: number,
  unestimatedIssueCount: number,
): PercentageMetric {
  return {
    percentage: denominator > 0 ? (numerator / denominator) * 100 : null,
    numerator,
    denominator,
    unit,
    estimatedIssueCount,
    unestimatedIssueCount,
  };
}

export function buildUnestimatedBreakdown(
  issues: ReportingIssueSnapshot[],
  mapping: BoardReportConfiguration,
  hasEstimate: (issue: ReportingIssueSnapshot) => boolean,
): UnestimatedBreakdown {
  const unestimated = issues.filter((issue) => !hasEstimate(issue));
  return {
    total: unestimated.length,
    completed: unestimated.filter((issue) => completed(issue, mapping)).length,
    incomplete: unestimated.filter((issue) => !completed(issue, mapping)).length,
  };
}

export function calculateIssueCountCompletion(
  issues: ReportingIssueSnapshot[],
  mapping: BoardReportConfiguration,
): PercentageMetric {
  const numerator = issues.filter((issue) => completed(issue, mapping)).length;
  return percentage(numerator, issues.length, "issues", issues.length, 0);
}

export function calculateStoryPointsCompletion(
  issues: ReportingIssueSnapshot[],
  mapping: BoardReportConfiguration,
): PercentageMetric {
  const estimated = issues.filter(
    (issue) => issue.storyPoints !== undefined && issue.storyPoints >= 0,
  );
  const numerator = estimated
    .filter((issue) => completed(issue, mapping))
    .reduce((total, issue) => total + (issue.storyPoints ?? 0), 0);
  const denominator = estimated.reduce(
    (total, issue) => total + (issue.storyPoints ?? 0),
    0,
  );
  return percentage(
    numerator,
    denominator,
    "story-points",
    estimated.length,
    issues.length - estimated.length,
  );
}

export function calculateEstimateCompletion(
  issues: ReportingIssueSnapshot[],
  mapping: BoardReportConfiguration,
): PercentageMetric {
  const estimated = issues.filter((issue) => (issue.originalEstimateSeconds ?? 0) > 0);
  const numerator = estimated
    .filter((issue) => completed(issue, mapping))
    .reduce((total, issue) => total + (issue.originalEstimateSeconds ?? 0), 0);
  const denominator = estimated.reduce(
    (total, issue) => total + (issue.originalEstimateSeconds ?? 0),
    0,
  );
  return percentage(
    numerator,
    denominator,
    "seconds",
    estimated.length,
    issues.length - estimated.length,
  );
}

export function calculateTimeUtilization(
  issues: ReportingIssueSnapshot[],
): PercentageMetric {
  const estimated = issues.filter((issue) => (issue.originalEstimateSeconds ?? 0) > 0);
  const numerator = estimated.reduce(
    (total, issue) => total + (issue.timeSpentSeconds ?? 0),
    0,
  );
  const denominator = estimated.reduce(
    (total, issue) => total + (issue.originalEstimateSeconds ?? 0),
    0,
  );
  return percentage(
    numerator,
    denominator,
    "seconds",
    estimated.length,
    issues.length - estimated.length,
  );
}

export function calculateSprintProgress(
  issues: ReportingIssueSnapshot[],
  mapping: BoardReportConfiguration,
  mode: SprintProgressMode,
): PercentageMetric {
  if (mode === "issue-count") {
    return calculateIssueCountCompletion(issues, mapping);
  }
  return mode === "story-points"
    ? calculateStoryPointsCompletion(issues, mapping)
    : calculateEstimateCompletion(issues, mapping);
}

function uniqueUsers(
  issues: ReportingIssueSnapshot[],
  worklogs: ReportWorklog[],
): NormalizedReportUser[] {
  const users = new Map<string, NormalizedReportUser>();
  for (const issue of issues) {
    if (issue.assignee) users.set(issue.assignee.id, issue.assignee);
  }
  for (const worklog of worklogs) users.set(worklog.author.id, worklog.author);
  return [...users.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function makePeopleBlocks(
  issues: ReportingIssueSnapshot[],
  changes: ReportChangeEvent[],
  worklogs: ReportWorklog[],
  mapping: BoardReportConfiguration,
  period: ReportPeriod,
  scope: ReportScope,
): PersonReportBlock[] {
  const scopedIssues =
    scope.kind === "team"
      ? issues
      : issues.filter((issue) => issue.assignee?.id === scope.userId);
  const scopedWorklogs =
    scope.kind === "team"
      ? worklogs
      : worklogs.filter((worklog) => worklog.author.id === scope.userId);
  return uniqueUsers(scopedIssues, scopedWorklogs).map((user) => {
    const assignedIssues = scopedIssues.filter((issue) => issue.assignee?.id === user.id);
    const userChanges = changes.filter(
      (change) =>
        assignedIssues.some((issue) => issue.id === change.issueId) ||
        change.actor?.id === user.id,
    );
    const userWorklogs = scopedWorklogs.filter(
      (worklog) => worklog.author.id === user.id && inPeriod(worklog.startedAt, period),
    );
    return {
      user,
      assignedIssues,
      createdIssues: userChanges
        .filter((change) => change.type === "issue-created")
        .map((change) => change.issueKey),
      completedIssues: userChanges
        .filter((change) => change.type === "issue-completed")
        .map((change) => change.issueKey),
      reopenedIssues: userChanges
        .filter((change) => change.type === "issue-reopened")
        .map((change) => change.issueKey),
      changes: userChanges,
      authoredWorklogs: userWorklogs,
      worklogSeconds: userWorklogs.reduce(
        (total, worklog) => total + worklog.timeSpentSeconds,
        0,
      ),
    };
  });
}

export function calculateReportResult(
  input: ScopeInput,
  progressMode?: SprintProgressMode,
): ReportResult {
  const selectedUserId = input.scope.kind === "assignee" ? input.scope.userId : undefined;
  const scopedIssues = selectedUserId
    ? input.issues.filter((issue) => issue.assignee?.id === selectedUserId)
    : input.issues;
  const scopedChanges = selectedUserId
    ? input.changes.filter(
        (change) =>
          scopedIssues.some((issue) => issue.id === change.issueId) ||
          change.actor?.id === selectedUserId,
      )
    : input.changes;
  const scopedWorklogs = selectedUserId
    ? input.worklogs.filter((worklog) => worklog.author.id === selectedUserId)
    : input.worklogs;
  const doneIssues = scopedIssues.filter((issue) =>
    completed(issue, input.statusMapping),
  );
  const people = makePeopleBlocks(
    scopedIssues,
    scopedChanges,
    scopedWorklogs,
    input.statusMapping,
    input.period,
    input.scope,
  );
  const unassignedIssues = scopedIssues.filter((issue) => !issue.assignee);
  const unassigned: UnassignedReportBlock = {
    issues: unassignedIssues,
    changes: scopedChanges.filter((change) =>
      unassignedIssues.some((issue) => issue.id === change.issueId),
    ),
  };
  const executiveSummary: ExecutiveSummary = {
    totalIssues: scopedIssues.length,
    completedIssues: doneIssues.length,
    incompleteIssues: scopedIssues.length - doneIssues.length,
    createdIssues: new Set(
      scopedChanges
        .filter((change) => change.type === "issue-created")
        .map((change) => change.issueId),
    ).size,
    completedDuringPeriod: new Set(
      scopedChanges
        .filter((change) => change.type === "issue-completed")
        .map((change) => change.issueId),
    ).size,
    reopenedDuringPeriod: new Set(
      scopedChanges
        .filter((change) => change.type === "issue-reopened")
        .map((change) => change.issueId),
    ).size,
    totalTimeSpentSeconds: scopedIssues.reduce(
      (total, issue) => total + (issue.timeSpentSeconds ?? 0),
      0,
    ),
    worklogSeconds: scopedWorklogs
      .filter((worklog) => inPeriod(worklog.startedAt, input.period))
      .reduce((total, worklog) => total + worklog.timeSpentSeconds, 0),
    unassignedIssues: unassignedIssues.length,
  };
  const result: ReportResult = {
    executiveSummary,
    people,
    unassigned,
    activity: [...scopedChanges].sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt),
    ),
  };
  if (input.type === "sprint" && progressMode) {
    const added = scopedChanges.filter((change) => change.type === "sprint-added");
    const removed = scopedChanges.filter((change) => change.type === "sprint-removed");
    const issueById = new Map(scopedIssues.map((issue) => [issue.id, issue]));
    const group = (events: ReportChangeEvent[]): SprintScopeChange[] => {
      const grouped = new Map<string, ReportChangeEvent[]>();
      for (const event of events)
        grouped.set(event.issueId, [...(grouped.get(event.issueId) ?? []), event]);
      return [...grouped.entries()].flatMap(([issueId, issueEvents]) => {
        const issue = issueById.get(issueId);
        return issue ? [{ issue, events: issueEvents }] : [];
      });
    };
    result.sprint = {
      progressMode,
      completion: calculateSprintProgress(
        scopedIssues,
        input.statusMapping,
        progressMode,
      ),
      timeUtilization: calculateTimeUtilization(scopedIssues),
      addedAfterStart: group(added),
      removedAfterStart: group(removed),
      unestimated: buildUnestimatedBreakdown(
        scopedIssues,
        input.statusMapping,
        progressMode === "story-points"
          ? (issue) => issue.storyPoints !== undefined
          : (issue) => (issue.originalEstimateSeconds ?? 0) > 0,
      ),
    } satisfies SprintReportResult;
  }
  return result;
}
