export const PRODUCT_NAME = "Power View for Jira";
export const PRODUCT_VERSION = "0.1.0";

export type { AppErrorCode, SerializableAppError } from "./errors";
export type {
  ContextDetectionSource,
  JiraDeploymentType,
  JiraPageContext,
} from "./jira-context";
export type { JiraServerInfo } from "./jira-server-info";
export type { JiraUser } from "./jira-user";
export type { PaginatedResult } from "./pagination";
export type { JiraProject, ProjectSearchOptions } from "./jira-project";
export {
  DEFAULT_MAX_ISSUES,
  MAX_CONFIGURABLE_ISSUES,
  type IssueSearchResult,
  type JiraIssueType,
  type JiraStatusCategory,
  type NormalizedIssue,
  type NormalizedIssueLink,
  type PageProgress,
  type SearchIssuesRequest,
} from "./jira-issue";
export {
  rankDateFieldCandidates,
  validateFieldMapping,
  type DateFieldPurpose,
  type FieldCandidate,
  type FieldMapping,
  type JiraField,
  type JiraFieldSchema,
} from "./jira-field";
export {
  buildDefaultProjectJql,
  validateJqlInput,
  type SetupConfiguration,
} from "./setup";
export {
  buildGanttScheduleModel,
  buildIssueHierarchy,
  DEFAULT_DURATION_DAYS,
  normalizeDefaultDurations,
  type CalculatedProgressSource,
  type DefaultDurationDays,
  type DependencyRelationshipType,
  type EndDateSource,
  type GanttDependency,
  type GanttScheduleModel,
  type GanttTask,
  type IssueTreeNode,
  type ScheduleModelOptions,
  type ScheduleWarning,
  type ScheduleWarningCode,
  type StartDateSource,
} from "./schedule";
export {
  classifyIssueLinkRelationship,
  type IssueLinkRelationshipKind,
} from "./link-classification";
export type { DiagnosticsSnapshot, RequestDiagnostic } from "./diagnostics";
export type { ConnectionState } from "./connection";
export {
  DEFAULT_GANTT_FILTERS,
  filterGanttTasks,
  ganttDateQuality,
  isGanttFilterActive,
  NO_LABEL_FILTER_VALUE,
  NO_PRIORITY_FILTER_VALUE,
  UNASSIGNED_FILTER_VALUE,
  type GanttDateFilter,
  type GanttDateQuality,
  type GanttFilterLogic,
  type GanttFilterResult,
  type GanttFilters,
  type GanttRiskFilter,
} from "./filters";

export type ProductModule =
  | "gantt"
  | "workload"
  | "timeline"
  | "executive-dashboard"
  | "dependency-graph"
  | "risk-analysis"
  | "ai-insights"
  | "reporting";
