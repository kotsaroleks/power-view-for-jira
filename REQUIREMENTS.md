# Power View for Jira — requirements and change protocol

> Status: living product context. Last consolidated: 2026-08-22.
>
> This document is the source of truth for future changes. A newer explicit user
> instruction overrides it; otherwise, do not silently reinterpret or expand it.

## Current release

The Gantt v2 and portable board configuration release is **0.3.0**. The root package,
Chrome manifest and exported product version must remain identical.

## Product goal

Power View is a Chrome extension for Jira that opens a practical planning workspace from
the Jira page currently open in the user's browser session. Its primary view is a Gantt
chart for the **selected Jira board**. It must work with useful defaults and must not
require complicated setup before a user can see the chart.

No Jira credentials are stored. The extension uses the active Jira browser session.

## Required service boundaries

The application is divided into three independent services. A change in one service must
not change the behaviour, data scope, storage, or public contract of another service
without an explicit cross-service requirement and tests for the contract.

**Architecture decision (2026-08-20):** these are independent front-end feature modules
inside the Chrome extension, not deployed backend services. Their isolation is enforced by
package/module boundaries, typed public contracts and contract tests.

### 1. Workspace Settings service

1. Detects and persists the Jira instance, project and board from the active Jira context.
2. When a board is already fixed/detected, it applies the saved setup automatically; the
   user is not required to complete setup again.
3. Its configuration is manually viewable and editable only on the Settings page.
4. It owns board-scoped setup data: board identity, query/scope, field mappings,
   non-working days, estimates and other workspace preferences.
5. It exposes a stable read-only `WorkspaceContext` contract to other services.
6. When the active Jira board is detected and its automatic configuration is valid, the
   Settings page shows only a compact detected-board summary. Project/board dropdowns and
   all detailed settings remain hidden until the user explicitly chooses
   `Edit settings manually`.
7. The full settings form opens automatically only when no board was detected or automatic
   configuration cannot continue without user input. The form must not flash while board
   detection or automatic configuration is still resolving.
8. After automatic or saved setup resolves a board, the application opens the Workspace
   chooser. It must not open Gantt or Reports until the user selects that service from the
   chooser.

### 2. Reports service

1. Receives the board and board scope exclusively from the Workspace Settings service.
2. Does not detect, select, replace, or persist its own board selection.
3. Uses the received board scope consistently for all report data, report history and
   report UI.
4. A Reports change must not change Workspace Settings or Gantt behaviour.
5. Opening Reports performs no Jira requests. Assignee options and Board Health use the
   issues already present in `WorkspaceContext`; local report history may be read without
   contacting Jira.
6. Jira report data is loaded only after `Generate report`. Sprint metadata may be loaded
   earlier only after the user explicitly selects Sprint Report, because it is required to
   choose the sprint.
7. Automatic Workspace setup must not publish an empty completed-status mapping when
   completed issues in the loaded board scope identify Jira's `done` status category.
   Those issue statuses are the safe fallback while optional board metadata resolves.
8. A disabled report action never presents a waiting cursor unless an operation is
   actually running. When completed statuses are unavailable, `Generate report` is
   disabled with a specific configuration explanation; only active generation is exposed
   as busy/waiting.

### 3. Gantt service

1. Receives the active board and scope exclusively from the Workspace Settings service.
2. Loads and displays only the issues of that board.
3. Owns Gantt-specific presentation state (filters, zoom, hierarchy expansion) scoped by
   Jira instance and board.
4. Edits Jira issues within the active board only after a deliberate user action. A direct
   manipulation gesture such as dropping, resizing or connecting a task is the
   authorization to save that change and must not open an additional confirmation dialog.
   Gantt never changes the selected board or another service's settings.
5. A Gantt change must not change Workspace Settings or Reports behaviour.

### Cross-service rules

1. Services communicate through typed, versioned contracts owned by the Workspace Settings
   boundary; they must not import each other's internal UI, storage or API implementation
   details.
2. Each service has its own focused unit/integration tests. Contract tests cover the
   `WorkspaceContext` handed from Settings to Reports and Gantt.
3. Any change to a shared contract requires: requirements update, a failing contract test,
   migration/compatibility decision, and tests proving unaffected services still work.
4. No service may widen a board scope to a project scope as a fallback.

## Scope and loading

1. The scope of the Gantt is the selected/detected Jira **board**, never merely the whole
   Jira project. A project can have many boards and a board can have its own filter.
2. Load issues using the Jira Agile board-issues endpoint for that board ID, with
   pagination. Do not use a fallback such as `project = KEY` for a board-scoped Gantt.
3. The visible loading state must state what is being loaded and make progress clear. It
   must not remain indefinitely on a generic `Preparing your workspace…` message.
4. Non-essential setup data (status catalogues, optional field suggestions, saved UI
   preferences) must not block opening the Gantt.
5. If Jira cannot provide enough data, show an actionable, specific message. Do not call a
   derived date an explicit Jira date.

## Dates, estimates and calendar rules

1. Gantt interactions are date-based only: dragging and resizing operate on whole calendar
   days, from `00:00` to `23:59`. Time-of-day scheduling is out of scope.
2. A working day is always **8 hours**.
3. `Original Estimate` is immutable when dates move.
4. Estimate means **working days**. The default non-working days are Saturday and Sunday;
   the user can configure non-working weekdays.
5. `Non-working days` is recalculated every time the date range changes.
6. `Calendar days estimate` equals working-day estimate plus non-working days inside the
   scheduled range. It is a derived display value, not a replacement for Original
   Estimate.
7. A task with both dates missing is `Unscheduled`. It has no inferred bar presented as a
   committed plan.
8. For an unscheduled task, with `Edit Jira` enabled, two clicks on empty timeline cells
   set dates: the earlier date is Start and the later date is Due. The second click
   completes the gesture and initiates the Jira update without an additional review or
   confirmation dialog.
   - After the first click, the chosen date remains visibly selected and the UI asks for
     the second date. The first click must not mutate Jira.
   - After the second click, the task immediately becomes a scheduled bar spanning both
     selected dates, the `Unscheduled` prompt disappears, and the transient cell
     focus/selection does not remain in place while Jira saves or refreshes.
9. A task with only one Jira date may be shown as a clearly labelled forecast/planned date
   derived from the estimate. Derived dates must be visibly distinguishable from explicit
   Jira dates.
10. Warnings must use text and accessible labels; a bare `!` is insufficient.

## Jira fields and editing

1. Settings may list date fields available to the user. Do not falsely mark a field
   unwritable merely because generic field metadata is inconclusive.
2. The actual Jira update is authoritative: attempt the selected allowed field only after
   explicit user action; surface Jira's specific response if it refuses it.
3. A Gantt edit must update the same values that the user can edit in Jira's issue or Plan
   UI, subject to the user's Jira permissions and workflow.
4. Date changes, status, priority and assignee changes require a deliberate user action.
   For direct manipulation in Gantt, completing the gesture is the save action; do not
   require a second Save click or a confirmation dialog. Read-only loading must never
   mutate Jira.
5. Do not retry a failed mutation through another bridge if that could duplicate a Jira
   update. A single-task action produces at most one Jira mutation request. A cascade may
   produce one intentional mutation per affected issue, but never a duplicate mutation for
   the same issue and planned date change.
6. If the extension cannot reach Jira, say whether the failure is authentication,
   permissions, selected field, or network/bridge related; provide a retry only when
   retrying is safe.
7. Assignee is editable directly from the replacement Gantt task table. Opening the
   assignee control and searching must use Jira's issue-scoped assignable-user API.
   Selecting a user or `Unassigned` is the deliberate save action: write immediately, show
   the Jira failure if it is rejected, and do not add a confirmation dialog or a second
   Save button. The editor can be dismissed without a Jira mutation by its Close control,
   `Escape`, clicking outside it, or toggling the same assignee cell. Structural hierarchy
   rows remain read-only.
8. Status is editable directly from the replacement Gantt task table. Opening the status
   control loads only the Jira workflow transitions currently available for that issue; it
   must not offer arbitrary project statuses that Jira will reject. Selecting a target
   status immediately executes its transition without a second Save action or confirmation
   dialog. The dropdown can be dismissed without a Jira mutation by its Close control,
   `Escape`, clicking outside it, or toggling the same status cell. Transition failures
   are shown using Jira's response, and structural hierarchy rows remain read-only.

## Gantt behaviour and UX

1. Show issue key, summary, status, assignee, schedule state and meaningful warnings.
2. Support hierarchy/rollups without inheriting parent dates as child explicit dates.
   Rollups are display values only. Jira's native `parent` relation and legacy `Epic Link`
   field are detected automatically: loaded stories/tasks are grouped under their loaded
   epic without requiring a manual hierarchy-field selection. An explicit native parent
   takes precedence over the legacy Epic Link. When Jira includes a referenced epic or
   parent in a board item's own metadata but does not return that parent as a board item,
   Gantt materializes an expanded, structural-only parent row and groups the board items
   beneath it. This must not trigger a project-wide scan, add the structural row to
   Reports, or make that synthetic row editable. The embedded parent summary/type/status
   are used when Jira supplies them; the referenced issue key is the fallback label.
3. Support filtering, including **Hide completed matching tasks**. The selected wording is
   exactly: `Hide completed matching tasks`. The filter remains authoritative for
   hierarchy rows: completed children stay hidden after their parent is expanded. When
   every direct child is completed and this filter is active, the parent does not show an
   expand/collapse disclosure because expanding it cannot reveal a visible child.
4. Filters, zoom and view preferences are scoped at least by Jira instance and board;
   changing boards must not inherit another board's preferences or setup.
5. Initial setup should be minimal. Advanced query, status mapping, date mapping,
   reporting fields and calendar settings are optional and discoverable, not required for
   the first chart.
6. The product must not silently load a broader data set in order to make startup look
   easier. Correct board scope is more important than a speculative fallback.
7. The replacement Gantt UI is implemented as a new isolated module. Existing Gantt
   components and interaction code are not rewritten or incrementally modified; only
   stable Workspace and domain contracts may be reused.
8. The replacement follows the established Wrike Gantt interaction model: a synchronized
   task table and timeline, resizable divider, hierarchy, filtering, sorting, zoom and
   Today navigation, clearly visible task bars and dependency lines.
9. A user can move a scheduled task by dragging the whole bar, resize it by dragging
   either edge, and create an unscheduled task schedule with two timeline clicks. All
   interactions operate on whole days and require no secondary confirmation dialog.
10. All replacement behaviours are introduced test-first. The old Gantt remains available
    as a fallback until the new module's acceptance tests pass and the app entry point is
    deliberately switched.
11. Search text, `Hide completed matching tasks`, zoom, sort field and sort direction are
    persisted for the active Jira instance and board. Loading another board must reset
    these controls to that board's saved values or to their defaults.
12. Gantt height expands to contain every visible task row. The task table and timeline
    must not create an internal vertical scroll area or clip lower rows; vertical
    navigation uses the page scrollbar. Expanding the final visible parent must make all
    newly revealed children reachable with that page scrollbar. Only the timeline may keep
    its own horizontal scrollbar for dates outside the visible width.
13. Task-bar and status-indicator colours distinguish workflow meaning. `In Review` uses a
    dedicated review colour (neutral purple), not the blue used for actively `In Progress`
    work; this is based on the Jira status name without changing Jira's status category or
    workflow.

## Gantt dependencies and cascade scheduling

1. A dependency is an active scheduling rule, not a decorative connector. Changing a task
   in Gantt cascades through every downstream dependent task in dependency order.
2. Users create dependencies by dragging a connector from an edge of one task to an edge
   of another. The supported relationships are Finish-to-Start (FS), Finish-to-Finish
   (FF), Start-to-Start (SS), and Start-to-Finish (SF).
3. Dependency definitions may be stored by the application and are not required to be
   represented as Jira issue links. They are scoped to the Jira instance and board.
4. When a task is changed through Gantt, completing the gesture authorizes both the direct
   Jira date update and the required cascade. Do not show a confirmation dialog for each
   affected task.
5. The application records the Jira dates against which its dependency schedule was last
   reconciled. If Jira later returns different dates for a task while its dependants were
   not correspondingly moved, Gantt marks the changed task and the broken dependency state
   in red.
6. For an externally changed Jira date, Gantt must not silently rewrite downstream tasks.
   It presents one explicit choice for that conflict: automatically repair the schedule by
   cascading the change through all downstream dependants, or leave Jira dates unchanged
   for manual correction.
7. Automatic repair is a single user action for the entire affected dependency graph; it
   must not request a separate confirmation for every Jira update. Choosing manual
   correction must not mutate any issue.
8. Cascade scheduling is constraint-based. A downstream task moves only when its current
   dates violate a dependency after the predecessor changes, and only by the minimum
   amount needed to satisfy the constraint. Moving a predecessor earlier does not pull a
   successor earlier when its existing dates already satisfy the graph.
9. Cascade movement preserves each downstream task's working-day duration and never
   changes Original Estimate. Recalculated dates skip configured non-working days;
   Calendar days estimate and Non-working days remain derived from the resulting span.
10. With zero lag, FS starts the successor on the next working day after predecessor
    finish; FF constrains successor finish to predecessor finish; SS constrains successor
    start to predecessor start; SF constrains successor finish to predecessor start. A
    configured working-day lag is applied to that boundary.
11. With multiple predecessors, the latest applicable start/end constraint wins. A moved
    successor is then treated as a changed predecessor and the same calculation continues
    through every downstream level.
12. Creating a dependency that would introduce a directed cycle is rejected before storage
    or any Jira mutation. A duplicate dependency is ignored.

## Portable board configuration

1. A user can export the configuration for the active Jira board to a versioned JSON file
   and import a compatible file received from another user.
2. The export includes Jira instance and board identity, field mappings, calendar and
   non-working days, Gantt preferences, dependency definitions, and the last reconciled
   Jira dates required for external-change detection.
3. The export never includes Jira credentials, browser cookies, access tokens, or
   authentication data.
4. Before applying a file, Import shows a compact summary containing its Jira board,
   format version and dependency count. One explicit `Import` action applies it; no
   additional confirmation dialog is shown.
5. Import is atomic and fully replaces the current configuration for the matching Jira
   instance and board. It does not merge dependency graphs.
6. Immediately before replacement, the application creates a local backup of the current
   board configuration so the previous state remains recoverable.
7. A corrupt, unsupported, different-board file, or a file whose dependency graph contains
   a directed cycle is rejected without changing the current configuration. Import must
   validate the complete document before writing any part of it.
8. A shareable synchronization link is not required for the initial implementation; the
   file transfer is the selected no-backend portability mechanism.

## Data integrity and safety

1. Preserve user changes already present in the worktree unless the task explicitly
   concerns them.
2. Treat Jira permissions, workflow constraints and field editability as runtime facts,
   not assumptions from field labels.
3. Never make external Jira writes during diagnostics or automated verification.
4. Keep request allowlists narrow and validate request paths, methods and payloads.

## Required change process (TDD)

Every functional change follows this exact order:

1. **Update this context first.** Add or revise the relevant requirement, decision,
   acceptance criteria and any deliberate trade-off in this file. If the requested
   behaviour is ambiguous or conflicts with this document, ask the user before coding.
2. **Write or rewrite the test first.** Start from the requirement's acceptance criteria.
   The new or changed test must fail against the previous behaviour and cover the
   user-visible regression, not only a helper implementation detail.
3. **Implement the smallest change** that makes the test pass. Avoid unrelated refactors
   or speculative features.
4. **Verify.** Run the focused tests, relevant type/build checks and, when the change
   affects browser/Jira behaviour, perform a safe read-only check in the real Chrome
   session. Clearly distinguish automated test evidence from live Jira evidence.
5. **Report honestly.** State what changed, which tests ran, what was live-verified, and
   any remaining limitation. Do not claim a build or live verification that was not
   actually completed.

## Acceptance criteria for the current known regression

When Power View is opened from Jira board `B`:

1. The issue request is addressed to board `B`'s board-issues endpoint (not a project-wide
   JQL fallback).
2. All paginated requests retain board `B` as their scope.
3. The displayed issue count contains only issues returned for board `B`.
4. A test fails if the setup flow instead invokes project-wide `searchIssues` for the
   initial board Gantt load.
5. The loading UI identifies the board and progresses until the chart opens or a specific
   recoverable error is shown.
6. If the board-issues endpoint fails, do not retry against the whole project. Keep the
   board scope, show the endpoint error and offer a safe retry.

## Reference material already in the repository

- `docs/workspace-context-architecture.md` — board-scoped workspace design.
- `docs/reporting-technical-spec.md` — Jira API and reporting architecture.
- `docs/testing.md` — existing test and manual-verification guidance.

If these documents conflict with an explicit requirement above, this file and the latest
explicit user instruction take precedence for Gantt work.
