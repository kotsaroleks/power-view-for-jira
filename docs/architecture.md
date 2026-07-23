# Architecture

Power View is a browser-only pnpm monorepo. The Chrome Manifest V3 shell lives in
`apps/extension`, the full-page React application lives in `apps/web`, and feature-neutral
contracts live in `packages`.

The production build first emits the web application to `dist/extension/app`, then adds
the popup, service worker, classic content-script bundle, assets, and manifest.

Milestone 8 extends the validated issue-loading pipeline through the filtered, virtualized
Gantt UI:

1. the content script detects stable URL and Jira metadata signals;
2. the service worker verifies the sender origin and stores versioned context in
   `chrome.storage.session`;
3. the popup refreshes context for the active tab;
4. the full-page application reads the latest validated context;
5. the application asks `JiraClient` for server info and the current user;
6. `RuntimeJiraTransport` sends a correlated, Zod-validated request to the service worker;
7. the service worker verifies its extension sender, active Jira base URL, exact host
   permission, GET method, endpoint allowlist, and query-parameter allowlist before
   calling Jira;
8. after connection, the application loads project and field metadata through the same
   transport, validates the user's JQL and mapping, and saves setup in
   `chrome.storage.local` under a versioned per-instance/per-project key;
9. the deployment adapter pages through accessible issues, maps raw records into the
   domain model, deduplicates by Jira issue ID, reports progress, and stops on an empty
   page or the configured maximum;
10. only sanitized issue count and cache status are reported to extension diagnostics;
11. the domain layer resolves parent/epic hierarchy, dates, progress, and blocking links
    into renderer-independent `GanttTask` records.
12. the React application passes the schedule through a UI-owned renderer adapter and
    presents one shared scrolling grid whose issue-tree and timeline rows cannot diverge.
13. a pure domain filter selects direct matches, restores their ancestor paths, optionally
    includes descendants, and marks context-only ancestors before expansion is evaluated;
14. the UI renders a fixed-height overscanned row window while reporting the complete
    accessible row count, and saves filter and zoom preferences per Jira instance and
    project;
15. an SVG overlay derives finish-to-start connector geometry from the same renderer and
    visible row order, while blocked/conflicting work also keeps a textual indicator;
16. diagnostics report sanitized Jira-tab health and exact-host permission state;
17. the release build validates MV3 permissions/CSP and emits a deterministic ZIP plus
    SHA-256 checksum.

The transport allows only v2/v3 `myself`, `serverInfo`, and `field`; the v2 `project` and
`search` routes; and the v3 `project/search` and `search/jql` routes. Every route has an
independent query-parameter allowlist. It includes browser credentials without exposing
their values, rejects cross-instance URLs, strips all headers except `Accept`, limits
concurrency to four, times out after 15 seconds, supports cancellation, and retries
429/5xx responses at most twice.

Cloud uses Jira REST v3. Data Center, Server, and unknown custom deployments use REST v2.
Cloud project search uses Jira pagination. The compatible Data Center project list is
filtered, sorted, and paginated client-side. Cloud issue search uses an enhanced-search
`nextPageToken`; Data Center uses `startAt/maxResults/total`. Issue results use a
five-minute in-memory cache keyed by JQL, field mapping, page size, and limit. JQL or
mapping changes clear the cache, and manual refresh bypasses it. Full descriptions are not
requested or persisted. No backend exists.

Edit mode uses a separate, deny-by-default mutation path. The service worker validates the
endpoint, method, query, JSON body, active Jira origin, stored tab, and host permission
before a packaged function performs same-origin `fetch` in the Jira page main world. Only
date fields, assignee, and issue-link dependency operations are allowed. Mutations require
a user confirmation and are never retried.

Hierarchy resolution keeps input ordering deterministic, prefers explicit parent over epic
relationships, detaches cycles, preserves missing-parent issues as warned roots, and caps
depth at 10. Schedule resolution runs children before parents so parent ranges and
weighted progress can be derived without UI dependencies. Generated or corrected dates
carry source metadata and a user-facing warning. Default duration values are validated
between 1 and 365 days and stored with each project setup.

The Gantt workspace owns presentation state only: filters, zoom, selection, expanded task
IDs, and the virtual scroll window. Expansion survives rerenders for the current query and
resets when the query identity changes. Roots start collapsed, and no more than 1,000
expanded rows are rendered. The native DOM/CSS renderer is behind `GanttRenderer`; neither
it nor React is imported by the domain package, so another SVG, canvas, or third-party
renderer can replace it without changing schedule rules.

Filtering is client-side and linear in the loaded task count. Text searches key and
summary. Status, category, assignee, issue type, priority, labels, date quality, blocked,
and unresolved groups support multiple values. Values within a group use OR; active groups
use the selected AND/OR mode, while text always narrows. Overdue means an end date before
today on a task whose status category is not done. Matching descendants force only their
included context path open. For more than 100 visible rows, the shared grid renders a
viewport plus overscan spacers instead of mounting every row, so table and timeline remain
structurally synchronized.

Local settings use schema v2. A successful read of schema v1 is migrated in place to v2,
preserving setup, recent JQL, and legacy filters while initializing new filters and Gantt
view preferences.
