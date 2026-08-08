import {
  buildReportPeriod,
  calculateReportResult,
  PRODUCT_VERSION,
  type BoardReportConfiguration,
  type GeneratedReportSnapshot,
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
import type { JiraHistoryCache } from "@power-view/storage";

import {
  changelogFingerprint,
  fetchWithHistoryCache,
  worklogFingerprint,
  type HistoryIssueRef,
} from "./history-cache";

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
  /** Issues answered from the history cache, so a near-instant re-run does not look stuck. */
  cached?: number;
  total?: number;
}

export interface GenerateReportOptions {
  client: ReportingClient;
  baseUrl: string;
  deploymentType: JiraDeploymentType;
  request: GenerateReportRequest;
  onProgress?: (progress: ReportGenerationProgress) => void;
  signal?: AbortSignal;
  /** Optional; omitted or broken, the report is generated exactly as before, just uncached. */
  historyCache?: JiraHistoryCache;
  /** Bypasses cache reads — but not writes — for history edited in Jira out of band. */
  forceRefresh?: boolean;
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
  onLoaded?: (loaded: number) => void,
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
    onLoaded?.(issues.length);
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

// Any changelog entry bumps the issue's `updated` timestamp, so an issue last touched
// before the period started cannot hold an entry inside it — and every consumer of
// `changes` filters to the period. On a sprint report this drops most of the board-only
// issues that only exist to reconstruct sprint scope history. An issue with no `updatedAt`
// tells us nothing and must still be fetched.
function changelogCandidates(
  issues: ReportingIssueSnapshot[],
  periodStart: string,
): HistoryIssueRef[] {
  const start = new Date(periodStart).getTime();
  return issues
    .filter((issue) => {
      const updatedAt = issue.updatedAt ? new Date(issue.updatedAt).getTime() : NaN;
      return !Number.isFinite(updatedAt) || updatedAt >= start;
    })
    .map(toHistoryIssueRef);
}

// `updatedAt` rides along because it is the history cache's validity key; the client only
// ever sees `id`/`key`.
function toHistoryIssueRef(issue: ReportingIssueSnapshot): HistoryIssueRef {
  return {
    id: issue.id,
    key: issue.key,
    ...(issue.updatedAt ? { updatedAt: issue.updatedAt } : {}),
  };
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
  const [board, boardConfiguration] = await Promise.all([
    client.getBoard(request.boardId, options.signal),
    client.getBoardConfiguration(request.boardId, options.signal),
  ]);
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
  // Both loads need storyPointsFieldId from the board configuration above, but not from
  // each other. They run concurrently, so each keeps its own counter and the progress
  // emitted is the sum — otherwise the two interleaved streams make the count jump around.
  let currentIssuesLoaded = 0;
  let boardIssuesLoaded = 0;
  const emitIssuesProgress = () =>
    options.onProgress?.({
      stage: "issues",
      loaded: currentIssuesLoaded + boardIssuesLoaded,
    });
  const [currentPage, boardPage] = await Promise.all([
    loadAllIssues(
      options,
      request.boardId,
      request.sprintId,
      storyPointsFieldId,
      (loaded) => {
        currentIssuesLoaded = loaded;
        emitIssuesProgress();
      },
    ),
    request.type === "sprint"
      ? loadAllIssues(
          options,
          request.boardId,
          undefined,
          storyPointsFieldId,
          (loaded) => {
            boardIssuesLoaded = loaded;
            emitIssuesProgress();
          },
        )
      : undefined,
  ]);
  const currentIssues = currentPage.issues;
  const candidateIssues = boardPage
    ? mergeIssues(currentIssues, boardPage.issues)
    : currentIssues;

  abortIfRequested(options.signal);
  options.onProgress?.({ stage: "changes" });
  // Worklogs stay on the full candidate set: `calculateReportResult` scopes them by author
  // only, never by issue, so a board-only issue's worklog still reaches the people blocks
  // and the executive summary's worklogSeconds. Narrowing this to `currentIssues` would
  // change report output.
  const worklogIssueRefs = candidateIssues.map(toHistoryIssueRef);
  const changelogRequest = {
    ...(storyPointsFieldId ? { storyPointsFieldId } : {}),
    ...(statusMapping.sprintFieldId
      ? { sprintFieldId: statusMapping.sprintFieldId }
      : {}),
    ...(request.sprintId ? { sprintId: request.sprintId } : {}),
    completedStatusIds: statusMapping.completedStatusIds,
    completedStatusNames: statusMapping.completedStatusNames,
  };
  // The cache wraps the two fetches rather than the client: the client stays
  // transport-only and unit-testable without IndexedDB.
  //
  // `onCacheHits`'s `total` is the full candidate set for that stage (it runs before the
  // cache/miss split), which is what the UI should show as the denominator. The client's
  // own `onProgress` `total` is `misses.length` — never use it, or a mostly-cached run
  // renders nonsense like 1200/300.
  let changesCached = 0;
  let changesTotal = 0;
  let changesCompleted = 0;
  const emitChangesProgress = () =>
    options.onProgress?.({
      stage: "changes",
      loaded: changesCached + changesCompleted,
      cached: changesCached,
      total: changesTotal,
    });
  let worklogsCached = 0;
  let worklogsTotal = 0;
  let worklogsCompleted = 0;
  const emitWorklogsProgress = () =>
    options.onProgress?.({
      stage: "worklogs",
      loaded: worklogsCached + worklogsCompleted,
      cached: worklogsCached,
      total: worklogsTotal,
    });
  const [changelogOutcome, worklogOutcome] = await Promise.allSettled([
    fetchWithHistoryCache<ReportChangeEvent>({
      ...(options.historyCache ? { cache: options.historyCache } : {}),
      storeName: "changelogs",
      baseUrl: options.baseUrl,
      issues: changelogCandidates(candidateIssues, period.start),
      fingerprint: changelogFingerprint(changelogRequest),
      ...(options.forceRefresh ? { forceRefresh: true } : {}),
      issueIdOf: (event) => event.issueId,
      onCacheHits: (cached, total) => {
        changesCached = cached;
        changesTotal = total;
        emitChangesProgress();
      },
      onFetchProgress: (completed) => {
        changesCompleted = completed;
        emitChangesProgress();
      },
      fetch: (issues, onProgress) =>
        client.getIssueChangelogs({
          issues,
          ...changelogRequest,
          ...(options.signal ? { signal: options.signal } : {}),
          ...(onProgress ? { onProgress } : {}),
        }),
    }),
    fetchWithHistoryCache<ReportWorklog>({
      ...(options.historyCache ? { cache: options.historyCache } : {}),
      storeName: "worklogs",
      baseUrl: options.baseUrl,
      issues: worklogIssueRefs,
      fingerprint: worklogFingerprint(period.start, period.dataCutoff),
      ...(options.forceRefresh ? { forceRefresh: true } : {}),
      issueIdOf: (worklog) => worklog.issueId,
      onCacheHits: (cached, total) => {
        worklogsCached = cached;
        worklogsTotal = total;
        emitWorklogsProgress();
      },
      onFetchProgress: (completed) => {
        worklogsCompleted = completed;
        emitWorklogsProgress();
      },
      fetch: (issues, onProgress) =>
        client.getIssueWorklogs({
          issues,
          periodStart: period.start,
          periodEnd: period.dataCutoff,
          ...(options.signal ? { signal: options.signal } : {}),
          ...(onProgress ? { onProgress } : {}),
        }),
    }),
  ]);

  let changes: ReportChangeEvent[] = [];
  let changelogUnavailable = false;
  let changelogErrorDetail: string | undefined;
  if (changelogOutcome.status === "fulfilled") {
    changes = changelogOutcome.value;
  } else {
    const cause: unknown = changelogOutcome.reason;
    if (options.signal?.aborted) throw cause;
    console.error("Power View could not load Jira changelog data.", cause);
    changelogUnavailable = true;
    changelogErrorDetail = cause instanceof Error ? cause.message : undefined;
  }
  changes = dedupeEvents([
    ...changes,
    ...addCreatedEvents(candidateIssues, period.start, period.dataCutoff),
  ]);

  let worklogs: ReportWorklog[] = [];
  let worklogUnavailable = false;
  let worklogErrorDetail: string | undefined;
  if (worklogOutcome.status === "fulfilled") {
    worklogs = worklogOutcome.value;
  } else {
    const cause: unknown = worklogOutcome.reason;
    if (options.signal?.aborted) throw cause;
    console.error("Power View could not load Jira worklog data.", cause);
    worklogUnavailable = true;
    worklogErrorDetail = cause instanceof Error ? cause.message : undefined;
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
    const periodStart = new Date(period.start).getTime();
    const periodEnd = new Date(period.dataCutoff).getTime();
    const groupScopeChanges = (type: "sprint-added" | "sprint-removed") => {
      const grouped = new Map<string, ReportChangeEvent[]>();
      for (const event of changes.filter((item) => {
        if (item.type !== type) return false;
        const occurredAt = new Date(item.occurredAt).getTime();
        return occurredAt >= periodStart && occurredAt < periodEnd;
      })) {
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
