import {
  isFreshCacheRecord,
  jiraHistoryCacheKey,
  type JiraHistoryCache,
  type JiraHistoryCacheRecord,
  type JiraHistoryCacheStoreName,
} from "@power-view/storage";

export interface HistoryIssueRef {
  id: string;
  key: string;
  updatedAt?: string;
}

/**
 * `JiraClient.getIssueChangelogs` returns events that are already mapped — and
 * `mapChangelogEntry` reads the board's field ids, the sprint under report and the
 * completed-status mapping. Caching mapped events therefore has to invalidate when any of
 * those move, or a re-run after a mapping change would serve wrongly classified events.
 * The lists are membership sets, so they are sorted: reordering them changes nothing.
 */
export function changelogFingerprint(request: {
  storyPointsFieldId?: string;
  sprintFieldId?: string;
  sprintId?: string;
  completedStatusIds?: readonly string[];
  completedStatusNames?: readonly string[];
}): string {
  return JSON.stringify([
    request.storyPointsFieldId ?? null,
    request.sprintFieldId ?? null,
    request.sprintId ?? null,
    [...(request.completedStatusIds ?? [])].sort(),
    [...(request.completedStatusNames ?? [])].sort(),
  ]);
}

/**
 * `mapWorklog` is config-free, but on Cloud the request itself is narrowed by
 * `startedAfter`/`startedBefore`, so what came back is only the worklogs inside that
 * window. The period is the fingerprint; a Daily run must not answer a Weekly one.
 */
export function worklogFingerprint(periodStart: string, periodEnd: string): string {
  return JSON.stringify([periodStart, periodEnd]);
}

export interface CachedHistoryFetch<TEntry> {
  cache?: JiraHistoryCache;
  storeName: JiraHistoryCacheStoreName;
  baseUrl: string;
  issues: readonly HistoryIssueRef[];
  fingerprint: string;
  forceRefresh?: boolean;
  fetch: (
    issues: Array<{ id: string; key: string }>,
    onProgress?: (completed: number) => void,
  ) => Promise<TEntry[]>;
  issueIdOf: (entry: TEntry) => string;
  onCacheHits?: (cached: number, total: number) => void;
  /** Fired as `fetch` reports issues completed, so the caller can add it to the cache count. */
  onFetchProgress?: (completed: number) => void;
}

/**
 * The cache is an optimisation and nothing more: every operation on it is tolerated, so a
 * missing, broken or full IndexedDB costs a slower report and never a failed one.
 */
async function tolerate<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    console.warn("Power View could not use the Jira history cache.", cause);
    return fallback;
  }
}

export async function fetchWithHistoryCache<TEntry>(
  options: CachedHistoryFetch<TEntry>,
): Promise<TEntry[]> {
  const { cache, storeName, baseUrl, issues, fingerprint } = options;
  const hits = new Map<string, TEntry[]>();

  if (cache && !options.forceRefresh) {
    const keys = issues.map((issue) => jiraHistoryCacheKey(baseUrl, issue.id));
    const records = await tolerate(
      () => cache.getMany<TEntry>(storeName, keys),
      [] as Array<JiraHistoryCacheRecord<TEntry>>,
    );
    const byKey = new Map(records.map((record) => [record.key, record]));
    for (const issue of issues) {
      const record = byKey.get(jiraHistoryCacheKey(baseUrl, issue.id));
      if (isFreshCacheRecord(record, issue.updatedAt, fingerprint))
        hits.set(issue.id, record!.entries);
    }
  }
  options.onCacheHits?.(hits.size, issues.length);

  const misses = issues.filter((issue) => !hits.has(issue.id));
  const fetched = await options.fetch(
    misses.map((issue) => ({ id: issue.id, key: issue.key })),
    options.onFetchProgress,
  );

  // Results come back flattened across issues, so re-attribute them by issue id. An issue
  // with no history in range contributes nothing to `fetched` — it still needs a record,
  // or it would miss on every future run and the cache would never converge.
  const fetchedByIssue = new Map<string, TEntry[]>();
  for (const entry of fetched) {
    const issueId = options.issueIdOf(entry);
    const bucket = fetchedByIssue.get(issueId);
    if (bucket) bucket.push(entry);
    else fetchedByIssue.set(issueId, [entry]);
  }

  if (cache) {
    const fetchedAt = new Date().toISOString();
    const records = misses.flatMap((issue) =>
      issue.updatedAt === undefined
        ? []
        : [
            {
              key: jiraHistoryCacheKey(baseUrl, issue.id),
              issueId: issue.id,
              issueUpdatedAt: issue.updatedAt,
              fetchedAt,
              fingerprint,
              entries: fetchedByIssue.get(issue.id) ?? [],
            },
          ],
    );
    await tolerate(() => cache.putMany(storeName, records), undefined);
  }

  // Emit in requested-issue order so the result is identical to the uncached path, which
  // flattens per-issue arrays in that same order. Entries attributed to an issue nobody
  // asked about cannot be placed, so they trail rather than being dropped.
  const requested = new Set(issues.map((issue) => issue.id));
  return [
    ...issues.flatMap(
      (issue) => hits.get(issue.id) ?? fetchedByIssue.get(issue.id) ?? [],
    ),
    ...fetched.filter((entry) => !requested.has(options.issueIdOf(entry))),
  ];
}
