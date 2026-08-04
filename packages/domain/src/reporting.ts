import type { JiraDeploymentType } from "./jira-context";

export type ReportType = "daily" | "weekly" | "sprint";
export type ReportLanguage = "en" | "uk";
export type SprintProgressMode = "issue-count" | "story-points" | "original-estimate";
export type ReportScope = { kind: "team" } | { kind: "assignee"; userId: string };

export interface ReportPeriod {
  timeZone: "Europe/Kyiv";
  start: string;
  end: string;
  dataCutoff: string;
}

export interface NormalizedReportUser {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

export interface JiraBoard {
  id: string;
  name: string;
  type: "scrum" | "kanban" | "simple" | "unknown";
  projectKeys: string[];
}

export interface JiraSprint {
  id: string;
  name: string;
  state: "future" | "active" | "closed" | "unknown";
  originBoardId?: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
}

export interface BoardReportConfiguration {
  schemaVersion: 1;
  jiraBaseUrl: string;
  boardId: string;
  completedStatusIds: string[];
  completedStatusNames: string[];
  storyPointsFieldId?: string;
  sprintFieldId?: string;
  updatedAt: string;
}

export interface ReportingIssueSnapshot {
  id: string;
  key: string;
  browseUrl: string;
  summary: string;
  issueType: { id: string; name: string };
  status: { id?: string; name: string };
  assignee?: NormalizedReportUser;
  createdAt?: string;
  resolvedAt?: string;
  updatedAt?: string;
  storyPoints?: number;
  originalEstimateSeconds?: number;
  timeSpentSeconds?: number;
  sprintIds: string[];
}

export type ReportChangeType =
  | "issue-created"
  | "issue-completed"
  | "issue-reopened"
  | "status-changed"
  | "assignee-changed"
  | "story-points-changed"
  | "original-estimate-changed"
  | "sprint-added"
  | "sprint-removed";

export interface ReportChangeEvent {
  id: string;
  issueId: string;
  issueKey: string;
  type: ReportChangeType;
  occurredAt: string;
  actor?: NormalizedReportUser;
  fieldId?: string;
  from?: string | number | null;
  to?: string | number | null;
  sprintId?: string;
}

export interface ReportWorklog {
  id: string;
  issueId: string;
  issueKey: string;
  author: NormalizedReportUser;
  startedAt: string;
  timeSpentSeconds: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SprintScopeChange {
  issue: ReportingIssueSnapshot;
  events: ReportChangeEvent[];
}

export interface PercentageMetric {
  percentage: number | null;
  numerator: number;
  denominator: number;
  unit: "issues" | "story-points" | "seconds";
  estimatedIssueCount: number;
  unestimatedIssueCount: number;
}

export interface UnestimatedBreakdown {
  total: number;
  completed: number;
  incomplete: number;
}

export interface ExecutiveSummary {
  totalIssues: number;
  completedIssues: number;
  incompleteIssues: number;
  createdIssues: number;
  completedDuringPeriod: number;
  reopenedDuringPeriod: number;
  totalTimeSpentSeconds: number;
  worklogSeconds: number;
  unassignedIssues: number;
}

export interface PersonReportBlock {
  user: NormalizedReportUser;
  assignedIssues: ReportingIssueSnapshot[];
  createdIssues: string[];
  completedIssues: string[];
  reopenedIssues: string[];
  changes: ReportChangeEvent[];
  authoredWorklogs: ReportWorklog[];
  worklogSeconds: number;
}

export interface UnassignedReportBlock {
  issues: ReportingIssueSnapshot[];
  changes: ReportChangeEvent[];
}

export interface SprintReportResult {
  progressMode: SprintProgressMode;
  completion: PercentageMetric;
  timeUtilization: PercentageMetric;
  addedAfterStart: SprintScopeChange[];
  removedAfterStart: SprintScopeChange[];
  unestimated: UnestimatedBreakdown;
}

export interface ReportResult {
  executiveSummary: ExecutiveSummary;
  people: PersonReportBlock[];
  unassigned: UnassignedReportBlock;
  activity: ReportChangeEvent[];
  sprint?: SprintReportResult;
}

export type ReportWarningCode =
  | "ISSUES_TRUNCATED"
  | "CHANGELOG_UNAVAILABLE"
  | "WORKLOG_UNAVAILABLE"
  | "SPRINT_SCOPE_HISTORY_PARTIAL"
  | "STORY_POINTS_FIELD_UNAVAILABLE"
  | "TIME_TRACKING_UNAVAILABLE"
  | "STATUS_MAPPING_STALE"
  | "MALFORMED_JIRA_VALUE";

export interface ReportCompleteness {
  complete: boolean;
  issueCount: number;
  truncated: boolean;
  warnings: Array<{
    code: ReportWarningCode;
    message: string;
    affectedIssueKeys?: string[];
  }>;
}

export interface GeneratedReportSnapshot {
  schemaVersion: 1;
  id: string;
  generatedAt: string;
  generatorVersion: string;
  jira: { baseUrl: string; deploymentType: JiraDeploymentType };
  request: {
    type: ReportType;
    boardId: string;
    jql?: string;
    sprintId?: string;
    scope: ReportScope;
    period: ReportPeriod;
    progressMode?: SprintProgressMode;
  };
  board: JiraBoard;
  sprint?: JiraSprint;
  statusMapping: BoardReportConfiguration;
  issues: ReportingIssueSnapshot[];
  changes: ReportChangeEvent[];
  worklogs: ReportWorklog[];
  result: ReportResult;
  completeness: ReportCompleteness;
}
