import type { JiraSprint, NormalizedIssue } from "./jira-issue";

export interface ReportStatusBuckets {
  total: number;
  toDo: number;
  inProgress: number;
  done: number;
  unknown: number;
}

export interface PlanningBuckets {
  totalOpen: number;
  currentSprint: number;
  futureSprint: number;
  unscheduled: number;
}

export interface BoardHealthReport {
  total: number;
  open: number;
  done: number;
  recentDone: number;
  unassignedOpen: number;
  statuses: ReportStatusBuckets;
  planning?: PlanningBuckets;
  activeSprints: JiraSprint[];
}

export interface SprintMeasureBuckets {
  total: number;
  done: number;
  inProgress: number;
  notStarted: number;
  unknown: number;
}

export interface SprintPersonBreakdown {
  key: string;
  name: string;
  avatarUrl?: string;
  issues: SprintMeasureBuckets;
  storyPoints: SprintMeasureBuckets;
}

export interface SprintHealthReport {
  sprint: JiraSprint;
  issues: SprintMeasureBuckets;
  storyPoints: SprintMeasureBuckets;
  storyPointsCoverage: number;
  people: SprintPersonBreakdown[];
  unassigned: number;
  blocked: number;
}

export interface BoardHealthOptions {
  now?: Date;
  recentDoneDays?: number;
  sprintDataAvailable?: boolean;
  preferredBoardId?: string;
  preferredSprintId?: string;
}

function emptyBuckets(): SprintMeasureBuckets {
  return { total: 0, done: 0, inProgress: 0, notStarted: 0, unknown: 0 };
}

function addToBuckets(
  buckets: SprintMeasureBuckets,
  issue: NormalizedIssue,
  value: number,
): void {
  buckets.total += value;
  switch (issue.status.category ?? "unknown") {
    case "done":
      buckets.done += value;
      break;
    case "in-progress":
      buckets.inProgress += value;
      break;
    case "to-do":
      buckets.notStarted += value;
      break;
    case "unknown":
      buckets.unknown += value;
      break;
  }
}

function uniqueSprints(issues: NormalizedIssue[]): JiraSprint[] {
  const byId = new Map<string, JiraSprint>();
  for (const issue of issues) {
    for (const sprint of issue.sprints ?? []) {
      const existing = byId.get(sprint.id);
      if (!existing || existing.state === "unknown") {
        byId.set(sprint.id, sprint);
      }
    }
  }
  return [...byId.values()];
}

export function relevantActiveSprints(
  issues: NormalizedIssue[],
  options: Pick<BoardHealthOptions, "preferredBoardId" | "preferredSprintId"> = {},
): JiraSprint[] {
  const active = uniqueSprints(issues)
    .filter((sprint) => sprint.state === "active")
    .sort((left, right) => left.name.localeCompare(right.name));

  if (options.preferredSprintId) {
    const preferred = active.find((sprint) => sprint.id === options.preferredSprintId);
    if (preferred) {
      return [preferred];
    }
  }

  if (options.preferredBoardId) {
    const onBoard = active.filter(
      (sprint) => sprint.boardId === options.preferredBoardId,
    );
    if (onBoard.length > 0) {
      return onBoard;
    }
  }

  return active;
}

export function buildBoardHealthReport(
  issues: NormalizedIssue[],
  options: BoardHealthOptions = {},
): BoardHealthReport {
  const statuses: ReportStatusBuckets = {
    total: issues.length,
    toDo: 0,
    inProgress: 0,
    done: 0,
    unknown: 0,
  };
  const now = options.now ?? new Date();
  const recentDoneDays = options.recentDoneDays ?? 30;
  const recentThreshold = now.getTime() - recentDoneDays * 24 * 60 * 60 * 1_000;

  for (const issue of issues) {
    switch (issue.status.category ?? "unknown") {
      case "done":
        statuses.done += 1;
        break;
      case "in-progress":
        statuses.inProgress += 1;
        break;
      case "to-do":
        statuses.toDo += 1;
        break;
      case "unknown":
        statuses.unknown += 1;
        break;
    }
  }

  const openIssues = issues.filter((issue) => issue.status.category !== "done");
  const planning = options.sprintDataAvailable
    ? openIssues.reduce<PlanningBuckets>(
        (result, issue) => {
          const sprintStates = new Set(
            (issue.sprints ?? []).map((sprint) => sprint.state),
          );
          if (sprintStates.has("active")) {
            result.currentSprint += 1;
          } else if (sprintStates.has("future")) {
            result.futureSprint += 1;
          } else {
            result.unscheduled += 1;
          }
          return result;
        },
        {
          totalOpen: openIssues.length,
          currentSprint: 0,
          futureSprint: 0,
          unscheduled: 0,
        },
      )
    : undefined;

  return {
    total: issues.length,
    open: openIssues.length,
    done: statuses.done,
    recentDone: issues.filter((issue) => {
      if (issue.status.category !== "done" || !issue.resolvedAt) {
        return false;
      }
      const resolvedAt = Date.parse(issue.resolvedAt);
      return Number.isFinite(resolvedAt) && resolvedAt >= recentThreshold;
    }).length,
    unassignedOpen: openIssues.filter((issue) => !issue.assignee).length,
    statuses,
    ...(planning ? { planning } : {}),
    activeSprints: relevantActiveSprints(issues, options),
  };
}

export function buildSprintHealthReport(
  issues: NormalizedIssue[],
  sprint: JiraSprint,
  blockedIssueIds: ReadonlySet<string> = new Set(),
): SprintHealthReport {
  const sprintIssues = issues.filter((issue) =>
    issue.sprints?.some((candidate) => candidate.id === sprint.id),
  );
  const issueBuckets = emptyBuckets();
  const pointBuckets = emptyBuckets();
  const people = new Map<string, SprintPersonBreakdown>();
  let issuesWithStoryPoints = 0;

  for (const issue of sprintIssues) {
    addToBuckets(issueBuckets, issue, 1);
    const points = issue.storyPoints;
    if (points !== undefined) {
      issuesWithStoryPoints += 1;
      addToBuckets(pointBuckets, issue, points);
    }

    const key =
      issue.assignee?.accountId ??
      issue.assignee?.username ??
      issue.assignee?.displayName ??
      "__unassigned__";
    const current = people.get(key) ?? {
      key,
      name: issue.assignee?.displayName ?? "Unassigned",
      ...(issue.assignee?.avatarUrl ? { avatarUrl: issue.assignee.avatarUrl } : {}),
      issues: emptyBuckets(),
      storyPoints: emptyBuckets(),
    };
    addToBuckets(current.issues, issue, 1);
    if (points !== undefined) {
      addToBuckets(current.storyPoints, issue, points);
    }
    people.set(key, current);
  }

  return {
    sprint,
    issues: issueBuckets,
    storyPoints: pointBuckets,
    storyPointsCoverage:
      sprintIssues.length === 0 ? 0 : issuesWithStoryPoints / sprintIssues.length,
    people: [...people.values()].sort((left, right) => {
      if (left.key === "__unassigned__") {
        return 1;
      }
      if (right.key === "__unassigned__") {
        return -1;
      }
      return left.name.localeCompare(right.name);
    }),
    unassigned: sprintIssues.filter((issue) => !issue.assignee).length,
    blocked: sprintIssues.filter((issue) => blockedIssueIds.has(issue.id)).length,
  };
}

export function reportPercentage(value: number, total: number): number {
  return total <= 0 ? 0 : Math.round((value / total) * 100);
}
