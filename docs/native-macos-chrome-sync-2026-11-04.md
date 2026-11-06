# Chrome → native macOS synchronization — 2026-11-04

Historical checkpoint. Current corrections, test counts, rendered evidence and open
acceptance are recorded in [the 5 November report](native-macos-sync-2026-11-05.md).

This change ports the current Chrome additions into the existing SwiftUI/AppKit
application. The interactive product remains native. Browser-extension permission bridges,
content scripts, manifest/update transports and Electron packaging remain
platform-specific; they are not embedded into the macOS UI.

## Ported behavior

- **Timesheet:** own Jira worklogs, week/month, Jira-profile timezone with explicit
  override, project/JQL filters, known-issue lookup and issue search, board task source,
  board/account-specific pins, personal priority groups and hierarchy. Numeric hours can
  be edited in a single-record cell; aggregated cells open individual records. Full
  create/edit/delete forms preserve original seconds, started timestamp and rich comments
  when unchanged. Daylight-saving gaps are rejected and repeated clock times require an
  explicit instant. Unsaved drafts survive table scrolling and require confirmation before
  navigation/discard.
- **Jira boundary:** modern POST search pagination, duplicate/repeated cursor checks, full
  worklog pagination, four parallel issue readers, widened date discovery and exact
  timezone/author filtering. Missing profile timezone disables the unsafe discovery date
  bound. Incomplete reads remain visibly incomplete. All mutations use
  `adjustEstimate=leave`, verify the current account and original worklog version, and are
  never automatically retried after an unknown outcome.
- **Day Off:** the same fixed GitHub Contents configuration and UTF-8 hexadecimal paths as
  Chrome, per-account/month records, ETags, strict record validation, branch verification
  before treating a missing file as empty, SHA conflict merge and a single read-back after
  an uncertain write. Known worklogs block a new Day Off; freshly read Day Off blocks new
  time. Configuration comes from `POWERVIEW_DAY_OFF_GITHUB_CONFIG` or the same private
  `.secrets/day-off-github.local.json` used by Chrome. No additional service or sign-in
  was added.
- **Time Report:** Reports contains Existing Reports / Time Report tabs. My teams and
  current membership are read from Atlassian, not inferred from board assignees.
  Team/individual daily and issue-level totals, employee selection, week/month, timezone,
  Day Off/conflict display, expected time, ratio-of-sums utilization, missing time and
  overtime are included. Capacity stays unknown when either worklog or shared-calendar
  reads are incomplete. An explicit action syncs the current roster to shared storage.
- **Section settings:** Timesheet/Gantt/Status enabled by default; Reports/Estimation
  disabled by default, matching Chrome. Switches save locally and update
  navigation/Workspace cards without deleting drafts. Both Reports and Estimation were
  enabled during local acceptance so the user can access all sections.
- **Existing screens:** the native workspace already preserves board-scoped Gantt
  dependencies, filters and view preferences atomically, reports persistence failures and
  now offers Retry saving. Existing Jira reporting pagination rejects incomplete/repeated
  cursors. Existing native release checks and Data Center authentication remain
  platform-specific equivalents.

## Verification

- 109 Core tests and 4 application tests pass, including 14 new Core tests and 2 new
  application tests. Cases cover timezone boundaries, DST, mixed authors, unsafe discovery
  bounds, repeated cursors, rich-comment preservation, stale/foreign-author writes,
  unknown write outcomes, missing/inaccessible/malformed shared calendars, concurrent SHA
  merge, no write replay, capacity and large-board hierarchy.
- A 1,500-issue application fixture exposed repeated calendar calculation per row. After
  correction, three hierarchy passes took about 0.07 seconds in the local test (fixture
  construction excluded).
- Live native read-only checks: saved Jira account reconnects; Timesheet discovers all
  boards, loads 8.2 Aria and restores it after restart; the shared calendar reads
  successfully; My teams returns Aria Team and CodeStat. Aria Team returns 14 members and
  126h 50m for 2026-11-02–08, with 560h expected and 22.6% utilization. Individual mode
  exposes issue-level rows.
- No production Jira worklog or shared-calendar records were created, edited, deleted or
  roster-synced for acceptance. Mutation checks use in-memory transports.
- The local app/archive are built and ad-hoc signed. They contain the same private GitHub
  application configuration as Chrome; no archive was published or uploaded.

## Acceptance limits

The user reported that native automation menus floated over their active window. Native UI
automation was stopped immediately. Subsequent changes (fixed table header, persistent
inline drafts, final form/discovery refinements) are compiled and covered by
noninteractive checks, but their final visual behavior was not rechecked on the user's
desktop. No claim is made that every screen is visually identical or that production write
acceptance/two-user concurrent use has been completed. No further window/mouse automation
should be performed without resolving the user's concern.

## Noninterfering verification follow-up

`scripts/check-native-macos-background.sh` now renders the actual Settings and Timesheet
week/month views to files in a separate background-only checker. The checker verifies
`NSApplicationActivationPolicy.prohibited`, an inactive process, and zero visible windows.
The views are never attached to a window. Automatic Timesheet loading is disabled for
fixture rendering, and fixture request counts must stay unchanged during rendering. That
initial run generated three PNGs with zero windows and no desktop input. The current
expanded checker renders 16 layouts; AppKit retains one hidden editor window, with zero
visible windows and no desktop input. Hidden editor windows are counted explicitly.

`AGENTS.md` makes this workflow persistent for project agents and prohibits native desktop
control for acceptance unless the user explicitly requests it again. This addresses this
project's verification workflow; it does not patch or claim to fix the upstream Computer
Use engine. Rendered fixtures do not establish keyboard, pointer, scroll synchronization
or menu interaction acceptance.
