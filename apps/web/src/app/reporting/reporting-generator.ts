import {
  buildReportPeriod,
  calculateReportResult,
  PRODUCT_VERSION,
  type BoardReportConfiguration,
  type GeneratedReportSnapshot,
  type JiraBoard,
  type JiraDeploymentType,
  type JiraSprint,
  type ReportChangeEvent,
  type ReportScope,
  type ReportType,
  type ReportingIssueSnapshot,
  type ReportLanguage,
  type ReportWorklog,
  type SprintProgressMode,
} from "@power-view/domain";
import type { JiraClient as ReportingClient } from "@power-view/jira-client";

export interface GenerateReportRequest {
  type: ReportType;
  boardId: string;
  jql: string;
  sprintId?: string;
  localDate: string;
  scope: ReportScope;
  language: ReportLanguage;
  progressMode?: SprintProgressMode;
  statusMapping: BoardReportConfiguration;
}

export interface ReportGenerationProgress {
  stage:
    "board" | "sprint" | "issues" | "changes" | "worklogs" | "calculating" | "saving";
  loaded?: number;
}

export interface GenerateReportOptions {
  client: ReportingClient;
  baseUrl: string;
  deploymentType: JiraDeploymentType;
  request: GenerateReportRequest;
  onProgress?: (progress: ReportGenerationProgress) => void;
  signal?: AbortSignal;
}

const MAX_REPORT_ISSUES = 5_000;

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("Report generation was cancelled.", "AbortError");
}

async function loadAllIssues(
  options: GenerateReportOptions,
  boardId: string,
  sprintId: string | undefined,
  storyPointsFieldId: string | undefined,
): Promise<{ issues: ReportingIssueSnapshot[]; truncated: boolean }> {
  const issues: ReportingIssueSnapshot[] = [];
  const seen = new Set<string>();
  let cursor: string | number | undefined;
  let truncated = false;
  let hasMore = true;
  while (hasMore) {
    abortIfRequested(options.signal);
    const pageRequest = {
      boardId,
      jql: options.request.jql,
      pageSize: 100,
      ...(cursor === undefined ? {} : { cursor }),
      ...(storyPointsFieldId === undefined ? {} : { storyPointsFieldId }),
    };
    const page = sprintId
      ? await options.client.getSprintIssues({ ...pageRequest, sprintId }, options.signal)
      : await options.client.getBoardIssues(pageRequest, options.signal);
    for (const issue of page.values) {
      if (issues.length >= MAX_REPORT_ISSUES) {
        truncated = true;
        break;
      }
      if (!seen.has(issue.id)) {
        seen.add(issue.id);
        issues.push(issue);
      }
    }
    options.onProgress?.({ stage: "issues", loaded: issues.length });
    cursor = page.nextCursor;
    if (page.truncated) truncated = true;
    hasMore = !page.isLast && cursor !== undefined && issues.length < MAX_REPORT_ISSUES;
  }
  return { issues, truncated };
}

function addCreatedEvents(
  issues: ReportingIssueSnapshot[],
  periodStart: string,
  cutoff: string,
): ReportChangeEvent[] {
  const start = new Date(periodStart).getTime();
  const end = new Date(cutoff).getTime();
  return issues.flatMap((issue) => {
    const createdAt = issue.createdAt ? new Date(issue.createdAt).getTime() : NaN;
    return Number.isFinite(createdAt) && createdAt >= start && createdAt < end
      ? [
          {
            id: `created:${issue.id}`,
            issueId: issue.id,
            issueKey: issue.key,
            type: "issue-created",
            occurredAt: new Date(createdAt).toISOString(),
          },
        ]
      : [];
  });
}

function dedupeEvents(events: ReportChangeEvent[]): ReportChangeEvent[] {
  return [...new Map(events.map((event) => [event.id, event])).values()].sort(
    (left, right) => left.occurredAt.localeCompare(right.occurredAt),
  );
}

function mergeIssues(
  left: ReportingIssueSnapshot[],
  right: ReportingIssueSnapshot[],
): ReportingIssueSnapshot[] {
  return [...new Map([...left, ...right].map((issue) => [issue.id, issue])).values()];
}

function buildCompleteness(
  truncated: boolean,
  issueCount: number,
  warnings: GeneratedReportSnapshot["completeness"]["warnings"],
): GeneratedReportSnapshot["completeness"] {
  return {
    complete: !truncated && warnings.length === 0,
    issueCount,
    truncated,
    warnings,
  };
}

export async function generateReport(
  options: GenerateReportOptions,
): Promise<GeneratedReportSnapshot> {
  const { client, request } = options;
  abortIfRequested(options.signal);
  options.onProgress?.({ stage: "board" });
  const board: JiraBoard = await client.getBoard(request.boardId, options.signal);
  const boardConfiguration = await client.getBoardConfiguration(
    request.boardId,
    options.signal,
  );
  const storyPointsFieldId =
    request.statusMapping.storyPointsFieldId ?? boardConfiguration.storyPointsFieldId;
  const statusMapping: BoardReportConfiguration = {
    ...request.statusMapping,
    ...(storyPointsFieldId ? { storyPointsFieldId } : {}),
  };

  let sprint: JiraSprint | undefined;
  if (request.type === "sprint") {
    if (!request.sprintId) throw new Error("A sprint is required for Sprint Report.");
    options.onProgress?.({ stage: "sprint" });
    sprint = await client.getSprint(request.sprintId, options.signal);
  }
  const generatedAt = new Date().toISOString();
  const period = buildReportPeriod(request.type, request.localDate, generatedAt, sprint);
  const currentPage = await loadAllIssues(
    options,
    request.boardId,
    request.sprintId,
    storyPointsFieldId,
  );
  let currentIssues = currentPage.issues;
  let candidateIssues = currentIssues;
  if (request.type === "sprint") {
    const boardPage = await loadAllIssues(
      options,
      request.boardId,
      undefined,
      storyPointsFieldId,
    );
    candidateIssues = mergeIssues(currentIssues, boardPage.issues);
    currentIssues = currentPage.issues;
  }

  abortIfRequested(options.signal);
  options.onProgress?.({ stage: "changes" });
  let changes: ReportChangeEvent[] = [];
  let changelogUnavailable = false;
  let changelogErrorDetail: string | undefined;
  try {
    changes = await client.getIssueChangelogs({
      issues: candidateIssues.map((issue) => ({ id: issue.id, key: issue.key })),
      ...(storyPointsFieldId ? { storyPointsFieldId } : {}),
      ...(statusMapping.sprintFieldId
        ? { sprintFieldId: statusMapping.sprintFieldId }
        : {}),
      ...(request.sprintId ? { sprintId: request.sprintId } : {}),
      completedStatusIds: statusMapping.completedStatusIds,
      completedStatusNames: statusMapping.completedStatusNames,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    console.error("Power View could not load Jira changelog data.", cause);
    changelogUnavailable = true;
    changelogErrorDetail = cause instanceof Error ? cause.message : undefined;
    changes = [];
  }
  changes = dedupeEvents([
    ...changes,
    ...addCreatedEvents(candidateIssues, period.start, period.dataCutoff),
  ]);

  options.onProgress?.({ stage: "worklogs" });
  let worklogs: ReportWorklog[] = [];
  let worklogUnavailable = false;
  let worklogErrorDetail: string | undefined;
  try {
    worklogs = await client.getIssueWorklogs({
      issues: candidateIssues.map((issue) => ({ id: issue.id, key: issue.key })),
      periodStart: period.start,
      periodEnd: period.dataCutoff,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    console.error("Power View could not load Jira worklog data.", cause);
    worklogUnavailable = true;
    worklogErrorDetail = cause instanceof Error ? cause.message : undefined;
    worklogs = [];
  }

  abortIfRequested(options.signal);
  options.onProgress?.({ stage: "calculating" });
  const result = calculateReportResult(
    {
      issues: currentIssues,
      changes,
      worklogs,
      period,
      type: request.type,
      scope: request.scope,
      statusMapping,
    },
    request.progressMode,
  );

  if (result.sprint) {
    const issueById = new Map(candidateIssues.map((issue) => [issue.id, issue]));
    const groupScopeChanges = (type: "sprint-added" | "sprint-removed") => {
      const grouped = new Map<string, ReportChangeEvent[]>();
      for (const event of changes.filter((item) => item.type === type)) {
        grouped.set(event.issueId, [...(grouped.get(event.issueId) ?? []), event]);
      }
      return [...grouped.entries()].flatMap(([issueId, events]) => {
        const issue = issueById.get(issueId);
        return issue ? [{ issue, events }] : [];
      });
    };
    result.sprint.addedAfterStart = groupScopeChanges("sprint-added");
    result.sprint.removedAfterStart = groupScopeChanges("sprint-removed");
  }

  const warnings: GeneratedReportSnapshot["completeness"]["warnings"] = [];
  if (currentPage.truncated)
    warnings.push({
      code: "ISSUES_TRUNCATED",
      message: "The report reached the maximum loaded issue limit.",
    });
  if (changelogUnavailable)
    warnings.push({
      code: "CHANGELOG_UNAVAILABLE",
      message: `Jira changelog data could not be loaded; activity and scope history may be incomplete.${changelogErrorDetail ? ` (${changelogErrorDetail})` : ""}`,
    });
  if (worklogUnavailable)
    warnings.push({
      code: "WORKLOG_UNAVAILABLE",
      message: `Jira worklog data could not be loaded; time metrics are unavailable.${worklogErrorDetail ? ` (${worklogErrorDetail})` : ""}`,
    });
  if (request.type === "sprint" && candidateIssues.length >= MAX_REPORT_ISSUES)
    warnings.push({
      code: "SPRINT_SCOPE_HISTORY_PARTIAL",
      message:
        "Sprint scope history may be incomplete because the board issue limit was reached.",
    });
  if (!storyPointsFieldId && request.progressMode === "story-points")
    warnings.push({
      code: "STORY_POINTS_FIELD_UNAVAILABLE",
      message: "Story Points are unavailable for this board.",
    });
  if (
    request.progressMode === "original-estimate" &&
    currentIssues.every((issue) => !issue.originalEstimateSeconds)
  )
    warnings.push({
      code: "TIME_TRACKING_UNAVAILABLE",
      message: "No Original Estimate values were available.",
    });
  const snapshot: GeneratedReportSnapshot = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    generatedAt,
    generatorVersion: PRODUCT_VERSION,
    jira: { baseUrl: options.baseUrl, deploymentType: options.deploymentType },
    request: {
      type: request.type,
      boardId: request.boardId,
      jql: request.jql,
      ...(request.sprintId ? { sprintId: request.sprintId } : {}),
      scope: request.scope,
      period,
      ...(request.progressMode ? { progressMode: request.progressMode } : {}),
    },
    board,
    ...(sprint ? { sprint } : {}),
    statusMapping,
    issues: currentIssues,
    changes,
    worklogs,
    result,
    completeness: buildCompleteness(
      currentPage.truncated,
      currentIssues.length,
      warnings,
    ),
  };
  options.onProgress?.({ stage: "saving" });
  return snapshot;
}
