export const PRODUCT_NAME = "Power View for Jira";
export const PRODUCT_VERSION = "0.3.0";

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
  type JiraIssueSprint,
  type JiraSprintState,
  type JiraStatusCategory,
  type NormalizedHierarchyReference,
  type NormalizedIssue,
  type NormalizedIssueLink,
  type PageProgress,
  type SearchIssuesRequest,
} from "./jira-issue";
export {
  buildBoardHealthReport,
  boardHealthStatusCategory,
  buildSprintHealthReport,
  relevantActiveSprints,
  reportPercentage,
  type BoardHealthOptions,
  type BoardHealthReport,
  type PlanningBuckets,
  type ReportStatusBuckets,
  type SprintHealthReport,
  type SprintMeasureBuckets,
  type SprintPersonBreakdown,
} from "./report";
export {
  rankDateFieldCandidates,
  inferDefaultDateFieldMapping,
  validateFieldMapping,
  type DateFieldPurpose,
  type FieldCandidate,
  type FieldMapping,
  type JiraField,
  type JiraFieldSchema,
} from "./jira-field";
export {
  buildDefaultBoardJql,
  buildDefaultProjectJql,
  validateJqlInput,
  type SetupConfiguration,
} from "./setup";
export {
  buildGanttScheduleModel,
  buildIssueHierarchy,
  applyGanttDrag,
  DEFAULT_DURATION_DAYS,
  DEFAULT_NON_WORKING_DAYS,
  WORKING_DAY_SECONDS,
  addWorkingDays,
  countNonWorkingDays,
  nextWorkingDay,
  normalizeDefaultDurations,
  isWorkingDay,
  type CalculatedProgressSource,
  type DefaultDurationDays,
  type DependencyRelationshipType,
  type EndDateSource,
  type GanttDependency,
  type GanttScheduleModel,
  type GanttTask,
  type GanttDragGesture,
  type GanttDragResult,
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
  type GanttSortOption,
  type GanttSortDirection,
  sortGanttTasks,
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
export {
  buildDailyPeriod,
  buildReportPeriod,
  buildSprintPeriod,
  buildWeeklyPeriod,
  localKyivDate,
} from "./reporting-period";
export {
  buildUnestimatedBreakdown,
  calculateEstimateCompletion,
  calculateIssueCountCompletion,
  calculateReportResult,
  calculateSprintProgress,
  calculateStoryPointsCompletion,
  calculateTimeUtilization,
} from "./reporting-calculations";
export type {
  BoardReportConfiguration,
  ExecutiveSummary,
  GeneratedReportSnapshot,
  JiraBoard,
  JiraSprint,
  NormalizedReportUser,
  PercentageMetric,
  PersonReportBlock,
  ReportChangeEvent,
  ReportChangeType,
  ReportCompleteness,
  ReportLanguage,
  ReportPeriod,
  ReportResult,
  ReportScope,
  ReportType,
  ReportingIssueSnapshot,
  ReportWarningCode,
  ReportWorklog,
  SprintProgressMode,
  SprintReportResult,
  SprintScopeChange,
  UnestimatedBreakdown,
  UnassignedReportBlock,
} from "./reporting";
