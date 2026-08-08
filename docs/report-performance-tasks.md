# Report generation performance — task breakdown

Working document for the report-generation speedup. Each task below is self-contained: it
names its own files, acceptance criteria and tests, and can be picked up without reading
the others.

## Why

Generating a report on a large board takes minutes, because the client issues every
request strictly one at a time.

`BaseJiraClient.getIssueChangelogs` (`packages/jira-client/src/BaseJiraClient.ts:576`) and
`getIssueWorklogs` (`:609`) are each a serial `for (const issue of request.issues)` loop
wrapping a serial `while (!isLast)` pagination loop.
`apps/web/src/app/reporting/reporting-generator.ts:195` and `:223` call them with
`candidateIssues` — up to `MAX_REPORT_ISSUES = 5_000`. That is **≥10,000 sequential HTTP
round-trips**, each additionally paying a `chrome.runtime.sendMessage` hop, two zod
parses, a `chrome.storage` permission read and a serialized `chrome.storage.session`
diagnostics write (`apps/extension/src/background/platform-operations.ts:619,642`).

The service worker's 4-slot `RequestSemaphore`
(`apps/extension/src/background/jira-request-handler.ts:12,91`) therefore sits permanently
idle at depth 1.

Target: an order of magnitude off first-run wall clock, and near-zero on re-runs, without
increasing request pressure on Jira.

## Global constraints — apply to every task

1. **The concurrency ceiling stays at 4.** Do not change `DEFAULT_MAX_CONCURRENT_REQUESTS`
   (`jira-request-handler.ts:12`). The win comes from _saturating_ the existing semaphore,
   not widening it. Client-side pools reuse the same number so total in-flight depth
   stays 4.
2. **Report output must be byte-identical** for the same inputs.
3. **Do not edit an existing test to make a refactor pass.** If a test in
   `packages/domain` or `packages/jira-client` needs changing, the refactor changed
   behaviour — stop and flag it.
4. Every task ends green on `pnpm test`, `pnpm lint`, `pnpm typecheck`. Known pre-existing
   noise, unrelated to this work: 2 `react-refresh` warnings in
   `apps/web/src/app/SetupPanelDevPreview.tsx`, and 7 files flagged by
   `pnpm format:check`.

## Order and dependencies

```
T1 ──┬── T2 ──┐
     │        ├── T4 (cache)
T3 ──┘        │
T5 (independent) ──┘
T6, T7, T8 independent
```

Land **T1 → T2 → T5** first: they carry most of the win, add no new subsystems and carry
the least risk. Measure before starting T4, the only task that adds persistent state.

---

## T1 — Parallelize the per-issue fetch loops

**Impact: highest.** This is the task that matters.

### Files

- new `packages/jira-client/src/concurrency.ts`
- `packages/jira-client/src/BaseJiraClient.ts` (`getIssueChangelogs` :576,
  `getIssueWorklogs` :609)
- `apps/web/src/app/reporting/reporting-generator.ts` (:150, :170, :195, :223)
- `packages/jira-client/src/index.ts` (export the helper)

### 1.1 Bounded-concurrency helper

```ts
export const MAX_CLIENT_CONCURRENCY = 4; // mirrors the service worker semaphore

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]>;
```

Index-ordered results. Fail fast on the first rejection. Check `signal?.aborted` before
dispatching each item. Model the worker-pool shape on the existing `RequestSemaphore`
(`jira-request-handler.ts:91-132`) rather than inventing a new idiom.

### 1.2 Use it in the client

Replace the outer `for` loop in both `getIssueChangelogs` and `getIssueWorklogs` with
`mapWithConcurrency(request.issues, MAX_CLIENT_CONCURRENCY, …)`. **Keep each issue's inner
`while (!isLast)` pagination serial** — page N+1 needs page N's `startAt`. Flatten the
per-issue arrays at the end.

Add an optional `onProgress?: (completed: number, total: number) => void` to
`GetIssueChangelogsRequest` and `GetIssueWorklogsRequest`, fired as each issue completes.

### 1.3 `Promise.all` the independent awaits in the generator

- `:150` `getBoard` + `:151` `getBoardConfiguration`.
- `:170` sprint-issue load + `:179` board-issue load. These must still run _after_ the
  pair above, because `storyPointsFieldId` is derived from the config at `:155`.
- `:195` changelogs + `:223` worklogs — use `Promise.allSettled` and preserve the existing
  independent `changelogUnavailable` (`:206`) / `worklogUnavailable` (`:229`) handling
  **exactly**, including the `if (options.signal?.aborted) throw cause` rethrow.

### Acceptance

- Report output byte-identical. `dedupeEvents` (`reporting-generator.ts:118`) already
  sorts by `occurredAt`, so out-of-order completion is safe — but confirm every parallel
  path still funnels through it.
- No existing test edited.

### Tests

New `packages/jira-client/src/concurrency.test.ts`:

- results come back in input order regardless of completion order
- **in-flight count never exceeds `limit`** — this is the guard for global constraint 1
- an aborted signal rejects and stops dispatching
- first rejection propagates and stops dispatching

Plus a `BaseJiraClient` test asserting `getIssueChangelogs` over N issues never has more
than 4 transport calls outstanding.

### Status: done

Landed. Pool is a fixed set of `min(limit, items.length)` workers pulling from one shared
`items.entries()` iterator; results written by index, so input order is preserved.

Two behaviour changes that do **not** affect report output, but are worth knowing:

- **Progress events interleave.** On a sprint report both `loadAllIssues` calls now run
  concurrently and both emit `{ stage: "issues", loaded }`, so the count is no longer
  monotonic. `stage: "worklogs"` is now emitted after both fetches have settled rather
  than before the worklog fetch starts. T7 reworks this surface anyway.
- **Abort now cancels both fetches.** Previously a changelog abort meant worklogs were
  never requested. The rethrow still happens from the changelog branch first, so the error
  surfaced to the caller is unchanged.

`boardPage.truncated` is still ignored, exactly as before — only `currentPage.truncated`
feeds `buildCompleteness`.

---

## T2 — Stop fetching what is thrown away

### Files

- `apps/web/src/app/reporting/reporting-generator.ts` (:196, :224)
- `packages/jira-client/src/BaseJiraClient.ts` (sprint/board issue requests, :446, :537)
- `apps/web/src/app/reports/BoardHealthReport.tsx` (:332-347)
- `apps/web/src/app/SetupPanel.tsx` (`loadBoardStatuses` :93-108)

### 2.1 Narrow the changelog/worklog input set

Today both `:196` and `:224` pass **all** `candidateIssues`. On a sprint report that is
the sprint _plus the entire board_.

- ~~**Worklogs → pass `currentIssues`, not `candidateIssues`.**~~ **Withdrawn — this task
  was wrong.** Tracing showed `scopedWorklogs` (`reporting-calculations.ts:215`) is scoped
  **by author only**; there is no issue-id filter anywhere in the worklog path. A
  board-only issue's worklog reaches output three ways: `uniqueUsers` (`:171`) can add a
  whole person block for an author with no sprint issue; `userWorklogs` (`:235`) filters
  by author + period, never by issue; and `executiveSummary.worklogSeconds` (`:322`) sums
  all in-period scoped worklogs. Narrowing here would silently change sprint-report
  numbers. Worklogs stay on `candidateIssues`; the reasoning is recorded as a comment at
  the call site. Revisiting this needs a **product decision**, not a perf refactor.
- **Changelogs → keep `candidateIssues`** (sprint scope history at `:256-269` genuinely
  needs the board-only issues), but skip any issue whose `updatedAt` predates
  `period.start` — such an issue provably has no changelog entry inside the period.
- Leave `addCreatedEvents` (`:215`) on the full `candidateIssues` set; it reads
  `createdAt` off the already-loaded snapshot and costs nothing.

### 2.2 `fields` override for id-only fetches

`BoardHealthReport.tsx:332-347` paginates full 100-issue payloads across every active
sprint and keeps only `issue.id` (`:347`). Add an optional `fields` override to the
sprint-issue request so this path asks for `id` alone — roughly 50× less payload.
`SetupPanel.tsx:93-108` has the same shape and needs only `status`.

Leave `STANDARD_ISSUE_FIELDS` (`BaseJiraClient.ts:79-103`) alone for the main report load
— it is genuinely consumed by `mapReportingIssue`.

### Acceptance

- Sprint report output identical, including the `sprint-added` / `sprint-removed` blocks —
  those are the ones at risk from 2.1.
- Board Health page renders identically.

### Tests

- A sprint-report test where a board-only issue has `updatedAt` before `period.start`: it
  must be excluded from the changelog fetch but still present in scope-change output.
- ~~A test that worklogs for board-only issues are never requested.~~ Withdrawn with 2.1.

### Status: done (2.1 partially withdrawn)

Changelog narrowing landed and is safe: any changelog entry bumps `fields.updated`, and
every consumer of `changes` filters to the period. An issue whose `updatedAt` is **missing
or unparseable is still fetched** (`!Number.isFinite(updatedAt) || updatedAt >= start`).

2.2 landed as a new **`fieldsOverride`** on the request — the pre-existing `fields` option
is _additive_, so reusing it would have changed its semantics. The override also needed a
schema branch: `rawJiraIssueSchema` hard-requires `fields.summary`/`issuetype`/`status`/
`project`, which an id-only response cannot satisfy, so `rawPartialJiraIssueSchema` still
validates `id`/`key`/`self` but relaxes the field requirements. It is used **only** when
an override is present; the main report load keeps the strict schema.

---

## T3 — Bulk changelog with a permanent fallback

`BaseJiraClient.ts:578-582` documents why `POST /rest/api/3/changelog/bulkfetch` was
abandoned: it fails as a generic network error behind some corporate proxies/WAFs. The fix
is not to avoid it, but to **try it once and fall back permanently on failure**.

### Files

- `packages/jira-client/src/JiraCloudClient.ts` (override `getIssueChangelogs`)
- `packages/jira-client/src/BaseJiraClient.ts` (replace the comment at :578-582)
- `packages/jira-client/src/reporting-schemas.ts` (response schema for the bulk endpoint)

### Work

Cloud only — the endpoint does not exist on Data Center.

1. Attempt the bulk endpoint with `issueIdsOrKeys` in batches of 1000 (the documented cap,
   and what `docs/reporting-technical-spec.md:550` already specifies). Run the batches
   through `mapWithConcurrency` from T1.
2. On **any** failure of the first batch, set an instance-level
   `bulkChangelogUnavailable = true` and delegate the whole request to the T1 parallel
   per-issue path. Never retry bulk again for that client instance.
3. `request.signal` must abort both paths.
4. Replace the comment at `:578-582` with one describing this try-once-then-fall-back
   contract, so the reasoning is not lost again.

5,000 requests become 5 on a healthy Cloud instance, and cost one failed request
elsewhere.

### Tests

- Bulk succeeds → per-issue endpoint never called; events identical to the per-issue path
  for the same fixture.
- First batch rejects → per-issue path produces the full result, **and bulk is not
  attempted again** on a second call to the same instance.
- Abort mid-bulk propagates.
- Truncated/paginated bulk response → no changelog entry is lost.

### Status: done

**Pagination is one top-level `nextPageToken`, not a per-issue token** (this task file
originally said per-entry — that was wrong). Results are sorted globally by changelog date
then issue id, so a page can end mid-issue and the next page continues it. The batch loop
reposts the same `issueIdsOrKeys` with the token until it comes back null, merging
`changeHistories` per `issueId`. Detect-and-refetch was not viable: nothing in the
response marks an entry as truncated.

Two latent silent-data-loss bugs were found and fixed in the pre-existing schema stub:
`nextPageToken` was `.optional()` but the API sends explicit `null` on the last page,
which would have thrown and made **every healthy Cloud instance** fall back permanently;
and `issueChangeLogs` is deliberately kept **required**, so a non-bulk response body
cannot parse as "no history at all" and silently empty the report.

`fieldIds` is **omitted**, not sent as `[]`. The OpenAPI spec makes it optional
(`required: ["issueIdsOrKeys"]`) and allows `minItems: 0`, but never defines what an empty
array means — it could mean "no filter" or "filter to no fields", and the second would
make every Cloud report return zero changes with no error. Omission is unambiguous. This
required allowing an absent `fieldIds` in `validBulkChangelogBody`
(`apps/extension/src/jira-request-policy.ts:104`), which previously forced the key to be
present.

One existing test was rewritten, deliberately: `JiraClient.test.ts` asserted "Cloud uses
the per-issue GET endpoint, **not** the bulk POST endpoint" — the exact decision this task
reverses. It could not survive T3 in any form. A Data Center counterpart was added to keep
that assertion alive where it is still true.

**Open risk requiring a live Cloud instance:** the bulk path omits issues the user cannot
read, where the per-issue path 404s. Candidate issues come from search results the user
can already read, so this should not arise — but it is unverified.

---

## T4 — Persistent changelog/worklog cache

**Do not start until T1 and T3 are landed and measured.** This is the only task that adds
persistent state.

An issue's changelog can only change when the issue changes, and `ReportingIssueSnapshot`
already carries `updatedAt` (`packages/domain/src/reporting.ts:60`). That is the cache
validity key — no TTL, no guessing.

### Files

- new `packages/storage/src/jira-history-cache.ts`
- `packages/storage/src/index.ts`
- `apps/web/src/app/reporting/reporting-generator.ts` (wire-in)
- `apps/web/src/app/reporting/ReportsView.tsx` (:757, force-refresh)

### Work

Follow the structure of `IndexedDbReportHistoryStore`
(`packages/storage/src/report-history-store.ts:83-169`) — same `open()` / `transaction()`
helpers, same `Memory*` sibling for tests.

- Database `power-view-jira-cache`; two object stores, `changelogs` and `worklogs`.
- Key `` `${baseUrl}|${issueId}` ``; value `{ key, issueUpdatedAt, fetchedAt, entries }`.
- ~~**Cache raw Jira entries, not mapped events.**~~ **Not implementable as written.**
  `getIssueChangelogs` (`packages/jira-client/src/reporting-api.ts:115`) returns
  **already-mapped, already-flattened** `ReportChangeEvent[]`, so a decorator at the
  generator level never sees raw entries. Resolved by caching the _mapped_ values with a
  **fingerprint** of the mapping inputs, checked on read alongside `issueUpdatedAt`:
  - Changelogs:
    `[storyPointsFieldId, sprintFieldId, sprintId, sorted completedStatusIds, sorted completedStatusNames]`
    — the status lists are sorted because they are membership sets, so reordering them
    does not invalidate.
  - Worklogs: **this task originally claimed worklogs need no fingerprint because
    `mapWorklog` is config-free. That was wrong.** On Cloud, `getIssueWorklogs` narrows
    the request with `startedAfter`/`startedBefore` from the period
    (`BaseJiraClient.ts:652`), so a cached result covers only _that_ window. The worklog
    fingerprint is `[period.start, period.dataCutoff]`, so a Daily run can never answer a
    Weekly one. Without it the cache would have silently under-reported time.
- Bulk `getMany(keys)` / `putMany(records)` over a **single** transaction each — per-key
  transactions would reintroduce the serialization problem one layer down.
- Evict on write: drop records with `fetchedAt` older than ~30 days.

Wire it in as a **decorator around the client inside `reporting-generator.ts`**, not
inside `BaseJiraClient` — the client stays transport-only and unit-testable without
IndexedDB.

1. `getMany` for all candidate issue ids before the fetch.
2. Hit iff `cached.issueUpdatedAt === issue.updatedAt`.
3. Fetch only the misses (via T1/T3), then `putMany`.
4. Map hits and misses together through `mapChangelogEntry`, then the existing
   `dedupeEvents` (`:213`).

Same flow for worklogs.

**Force refresh:** a modifier on the generate button (`ReportsView.tsx:757`) that bypasses
cache _reads_ but still writes — needed when Jira history is edited out-of-band.

### Acceptance

- Second identical run issues near-zero changelog requests and returns byte-identical
  output to the first.
- Cache is transparent on failure: if IndexedDB is unavailable, report generation still
  works, just uncached.

### Tests

- Hit on matching `updatedAt`, miss on changed `updatedAt`, **miss when `updatedAt` is
  absent** (it is optional on `ReportingIssueSnapshot`; a missing value cannot prove
  freshness).
- Miss when the fingerprint differs.
- **An issue with zero events caches and hits on re-run** — see the trap below.
- Force-refresh bypasses reads but still writes.
- `getMany`/`putMany` each use one transaction.
- Eviction drops records past the age threshold.
- A throwing/unavailable IndexedDB still produces a correct report.

### Status: done

**The empty-result trap.** Results come back flattened, so they are re-attributed per
issue via `event.issueId` / `worklog.issueId`. An issue with no entries contributes zero
events, so "which issues were fetched" cannot be inferred from the results — a record is
written for **every requested miss**, storing `entries: []` where nothing came back.
Otherwise those issues miss forever and the cache never converges.

Results are emitted in requested-issue order, interleaving hits and fresh fetches, which
reproduces the uncached path's `perIssue.flat()` ordering byte-for-byte. The test is
arranged so a naive "hits first, fetches after" implementation fails it.

Cache faults cannot fail a report: every cache call goes through a `tolerate()` wrapper
returning a neutral fallback, and `historyCache` is undefined when `indexedDB` is absent.
Eviction uses a **key** cursor over the `fetchedAt` index, so it never materializes a
payload.

Force refresh is shift-click on Generate report.

---

## T5 — Fix the cubic calculation loops

Independent of T1–T4; can run in parallel with them. Behaviour-preserving, no signature
changes.

### File

`packages/domain/src/reporting-calculations.ts`

### Work

- **`makePeopleBlocks` (:193-222)** is O(users × changes × issues): `.some()` over
  `assignedIssues` inside a `.filter()` over `changes` inside a `.map()` over users. Build
  `changesByIssueId: Map<string, ReportChangeEvent[]>` and
  `changesByActorId: Map<string, ReportChangeEvent[]>` **once** before the `.map()`. Per
  user, `userChanges` becomes the union of the two lookups, **deduped by `change.id`** to
  preserve the OR semantics at `:195-199`. Pre-group `scopedIssues` by `assignee?.id` to
  hoist `assignedIssues` out of the loop too.
- **`calculateReportResult` (:233-239)**: replace `scopedIssues.some(...)` with a
  `Set<string>` of scoped issue ids.
- **Unassigned block (:259-265)**: replace `unassignedIssues.some(...)` with a `Set`.
- The ~10 separate full passes over `periodChanges` at `:266+` could collapse into one
  pass — do this **only if it stays readable**. It is a much smaller win and the current
  code is clear.

### Acceptance

Existing `packages/domain` tests pass **with zero edits**. That is the proof the rewrite
is behaviour-identical — including the ordering of `userChanges`, which the union must
preserve.

### Status: done

Landed. Union is deduped by **original array position**, not by `change.id` as this task
originally specified — position-dedupe is exactly the OR-collapse the old `.filter()`
expressed, whereas id-dedupe would additionally drop a second distinct event that happened
to share an id. Verified by differential harness against the pre-refactor implementation
(2,880 seed × scope × type × progress-mode combinations, `JSON.stringify` compared so
ordering counts), plus the existing domain suite passing unedited.

Remaining quadratic term, deliberately out of scope: `scopedWorklogs.filter(...)` per user
in `makePeopleBlocks` is still O(users × worklogs). Worklog counts are far smaller than
change counts, so this is low priority — but it is the last one in that function.

---

## T6 — Per-request fixed overhead

### File

`apps/extension/src/background/platform-operations.ts`

- **`:619` `requireActiveJiraContextWithPermission()`** — a `chrome.storage` read + zod
  parse + `chrome.permissions.contains()` on every request. Memoize for a short window (~2
  s), invalidated by the existing context-change path so a tab switch is still picked up
  immediately. **Keep the un-memoized call on the non-GET branch at `:622`** — that one
  deliberately re-reads after `refreshContext`.
- **`:642` `diagnosticsStore.recordRequest()`** — `DiagnosticsStore` chains every write
  onto `this.writes` (`packages/storage/src/diagnostics-store.ts:45,53,67`), a global
  serialization point doing a read + parse + `chrome.storage.session` write just to
  overwrite `lastRequest`. Coalesce: hold the latest record in memory, flush on a trailing
  ~500 ms debounce. **Errors (`:656`) flush immediately** — those are what the Diagnostics
  page exists for.

### Acceptance

The Diagnostics page still shows the last request, the last error, and
`lastSuccessfulConnectionAt` after a report run. (`DiagnosticsState` has no counters —
`lastRequest`/`lastErrorCode`/`cacheStatus`/`loadedIssueCount` are the whole schema; this
task never adds any.) A revoked host permission is refused on the next request, not up to
2s later.

### Status: done

Landed as specified. The context/permission gate is memoized 2s, success-path only,
cleared on both `contextStore.save()` sites and on
`chrome.permissions.onRemoved`/`onAdded` — the permission listeners are load-bearing, not
redundant with the TTL: without them a revoked host stays reachable for up to 2s. The
post-`refreshContext` re-read passes `{ fresh: true }` explicitly rather than relying
solely on the save-triggered invalidation.

Diagnostics writes coalesce on a trailing 500ms debounce but still enqueue onto the
existing `this.writes` chain — only the scheduling changed, not the serialization, so a
debounced `recordRequest` flush cannot race a concurrent `recordIssueLoad()`. A
`connectionSucceeded` or `errorCode` record flushes immediately, uncoalesced — those are
real state and the reason the Diagnostics page exists. `getState()` forces a pending flush
before reading. The debounced path returns an already-resolved promise, so `recordRequest`
callers do not gain a 500ms wait on every request.

`pnpm format:check` flags 8 pre-existing files, not 7 —
`packages/domain/src/jira-field.test.ts` was already unformatted before this branch; the
task file's earlier count was off by one.

---

## T7 — Progress and cancellation

### Files

- `apps/web/src/app/reporting/reporting-generator.ts` (:32-36)
- `apps/web/src/app/reporting/ReportsView.tsx` (:757, :766, :786)

- `ReportGenerationProgress` gains `total` and `cached` alongside `loaded`, fed by the
  T1.2 and T4 callbacks. `ReportsView.tsx:786` currently does
  `setLoadingMessage(progress.stage)`, so the user watches `changes` sit frozen through
  the phase that dominates the run — render `changes 1,240 / 5,000` instead.
- `ReportsView.tsx:766` creates an `AbortController` and **never aborts it** — no cancel
  button, no unmount cleanup. Add both. The plumbing already exists end-to-end
  (`abortIfRequested` `:49` → `packages/jira-client/src/RuntimeJiraTransport.ts:41-65` →
  `JIRA_REQUEST_CANCEL` → `jira-request-handler.ts:326`); `BoardHealthReport.tsx:306,365`
  and `SetupPanel.tsx:557-563` show the established pattern to copy.

### Status: done

Landed. The generator now emits real counts: `loaded: cached + completed` against
`total: issues.length` — the client's own `onProgress` total is `misses.length` and is
discarded, since forwarding it would render nonsense like `1200 / 300` on a mostly-cached
run. Cache hits alone now emit `loaded: cached` too, so a fully-cached re-run (zero
misses, zero client progress events) still shows a count instead of going silent. The two
concurrent `loadAllIssues` calls on a sprint report each keep their own counter and emit
the sum, fixing the non-monotonic `issues` count noted in T1's status.

`createProgressThrottle` (moved to its own module, `progress-throttle.ts`, to keep
`react-refresh` happy about `ReportsView.tsx` only exporting components) coalesces to one
state update per ~100ms, with an unthrottled flush on stage change and a trailing timer so
the final count in a burst is never dropped — without it, a 5,000-issue board would drive
5,000 renders during the exact phase this task exists to make feel fast.

Cancellation: the `AbortController` moved into a ref, a Cancel button calls `abort()`, and
`useEffect(() => () => controllerRef.current?.abort(), [])` (empty deps, so it fires only
on unmount, not on every dependency change) aborts an in-flight run when the view goes
away. An aborted run surfaces as a status message, not the red error state.

One pre-existing test, `history-cache.test.ts`'s "reports cache hits through the progress
callback", asserted the old cache-hit event shape with no `loaded` field — exactly what
this task adds. Updated to expect `loaded`, not edited to dodge a break: the old assertion
predated the requirement this task implements.

---

## T8 — Report history list should not deserialize every snapshot

`IndexedDbReportHistoryStore.list()`
(`packages/storage/src/report-history-store.ts:107-124`) calls `store.getAll()`,
deserializing every full snapshot — issues + changes + worklogs, potentially tens of MB —
to render six header fields per row.

Iterate the already-created `boardIdGeneratedAt` index (`:140`) with a cursor, or maintain
a separate lightweight `reportIndex` object store. Small, self-contained, and makes the
history list open instantly.

### Status: done

Took the separate `reportIndex` store. **The cursor route does not work** — a cursor still
materializes `cursor.value`, i.e. the whole snapshot, per row; it moves the cost from one
`getAll()` into N deserializations rather than removing it.

`DATABASE_VERSION` bumped 1 → 2, with a backfill cursor in `onupgradeneeded` deriving an
index row for every pre-existing snapshot. The open request only resolves once the
versionchange transaction commits, so `list()` can never see a half-backfilled index.
`save()`/`delete()` span both stores in one `readwrite` transaction, so they cannot
diverge. Verified by a test asserting `list()` performs **zero** reads against
`reportSnapshots`.

---

## Verification

Per task:

1. `pnpm test` — and confirm **no existing test was edited** (global constraint 3).
2. `pnpm lint`, `pnpm typecheck` — clean modulo the known pre-existing noise.
3. New tests as listed under each task.

Across the whole effort:

4. **Measure, don't assume.** Record wall clock and request count before and after on a
   real board via the Diagnostics page, with a temporary `console.time` around each
   `generateReport` stage. Report per-task numbers so the ordering here can be
   re-prioritised if reality disagrees with the analysis.
5. **Manual**: `pnpm --filter @power-view/web dev` → `http://localhost:5173/?app-preview`.
   Generate a Daily, a Weekly and a Sprint report; confirm output identical to a
   pre-change snapshot, that progress counts advance, that Cancel works mid-run, and
   (after T4) that a second identical run is near-instant.
