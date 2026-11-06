# Chrome → native macOS synchronization — 5 November 2026

Historical checkpoint;
[6 November corrections and verification](native-macos-sync-2026-11-06.md) are current.
The follow-up found functional differences in addition to acceptance gaps. This inventory
superseded the open implementation gaps in the
[4 November checkpoint](native-macos-chrome-sync-2026-11-04.md). It does not mark
unexercised desktop interactions or external acceptance as passed. The application UI
remains SwiftUI/AppKit; no Chrome page or JavaScript runtime is embedded.

## Source-to-native inventory

| Current Chrome behavior / source                                                                                   | Native implementation                                                                                                                                                                                   | Verification and boundary                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App navigation, standalone Timesheet and Reports tabs (`App.tsx`, `ReportsService.tsx`)                            | `PowerViewApp.swift`, `ProductTimeReport.swift`; Timesheet needs Jira identity, not board setup. Existing Reports remain mounted when switching tabs.                                                   | Full root render at 1440×900 and 1280×800; account/team invalidation tests. Returning to Time Report refreshes discovery and results.                                         |
| Section switches (`SectionSettings.tsx`, `use-app-sections.ts`, settings store)                                    | `NativeSectionSettings` and persisted `app.sections.v1`; identical default visibility.                                                                                                                  | Production Settings render. Hiding a section updates navigation without deleting workspace data.                                                                              |
| Own-time reader, explicit project/JQL scope, known issue and coverage (`timesheet-model.ts`, `TimesheetClient.ts`) | `TimeTracking.swift`, `NativeTimesheetModel`; modern POST cursor search, paged worklogs, four readers, exact author/date filtering, cancelled/obsolete read rejection.                                  | Core transport regressions and application query cancellation. Search-index coverage remains explicitly limited; complete history is not promised.                            |
| Week/month rows and weekly hierarchy (`weekly-row-model.ts`, `Timesheet.tsx`)                                      | `NativeTimesheetModel.rows`, grouped production table; pins → own worklogs → priority → assigned → other. Month excludes board-only rows/groups.                                                        | Five golden scenarios generated from the actual current Chrome row function, including malformed cycles, collapse and parent context.                                         |
| Board tasks, pins, task copying and unread hours (`use-weekly-tasks.ts`)                                           | Scoped board/pin preferences, explicit Load hours, separate successful/failed read IDs. Copy last week's tasks adds rows only.                                                                          | Delayed-board regression; copy has zero mutations and unchanged hours; partial source rejected; unread/failed hours are not displayed as zero.                                |
| Worklog board/issue picker (`WorklogIssuePicker.tsx`, `issue-picker-model.ts`)                                     | `NativeWorklogBoardPicker.swift`: remembered board, assigned first, Epic/Story favorites and child groups. Global search is separate.                                                                   | Board/favorite scoping regression and cancelled obsolete search. Current identity is validated before publishing results.                                                     |
| Inline weekly hours (`WeeklyTimeCell.tsx`)                                                                         | Enter/blur save, serialized per-cell queue, persistent draft storage, Escape reset, visible focus, Option+Down details, detail button excluded from Tab order. Month uses detail/add buttons.           | Production-model queued-write test, blank/unchanged no-write regression, week/month renders. Actual keyboard/focus interaction remains unverified.                            |
| Date/time/duration/description form (`WorklogForm.tsx`)                                                            | `NativeWorklogDraft`, production editor and details sheets; real date picker, supported-zone picker, search cancellation, explicit DST overlap choice.                                                  | Production draft → create/edit/delete request journey; exact seconds, timestamp and rich comment preserved when unchanged; skipped and repeated local times covered.          |
| Jira/custom zone source and Kyiv-offset warning (`time-zone-warning.ts`)                                           | Jira-profile/custom distinction and scoped persistence; new profile values followed only for Jira source.                                                                                               | Four warning goldens, DST transition regression, missing profile fallback, legacy preference migration and account switch tests.                                              |
| Shared Day Off (`day-off/`, `DayOffToggle.tsx`)                                                                    | `SharedTimeCalendar.swift`: same GitHub Contents paths/configuration, branch check, strict JSON, SHA merge, uncertain-write reconciliation.                                                             | Two independent in-memory clients preserve concurrent dates; unavailable/malformed calendar and both directions of worklog conflict tested. No live calendar records changed. |
| Team/Individual Time Report (`time-report/`, domain `time-report.ts`)                                              | `NativeTimeReportModel`, native table and summary; actual My teams/current membership, employee filter, week/month/timezone, unique weekday Day Off capacity, issue breakdown and explicit roster sync. | Two metric goldens plus production model/API tests for membership, team/account/period changes and roster sync. Failed discovery cannot present an old selection as fresh.    |
| Jira user timezone (`jira-user.ts`, mappers/schemas)                                                               | `JiraUser.timeZone`, refreshed `TimeSnapshot.user`, exact calendar calculations.                                                                                                                        | Profile change and missing/invalid timezone regressions.                                                                                                                      |
| Gantt saved settings loading/save errors (`GanttV2Service.tsx`)                                                    | Existing native per-board archives and atomic workspace store; load completes before replacing state, failed save remains visible with Retry saving.                                                    | Workspace isolation, corrupted recovery, stale save and serialized lifecycle tests; production Gantt render. Real delayed-load UI acceptance remains unverified.              |
| Reporting cursor completeness (`reporting-generator.ts`)                                                           | Existing native search rejects missing/repeated cursor and preserves partial-read warnings.                                                                                                             | Core pagination/report regressions and existing report golden fixtures.                                                                                                       |
| Setup activity suspension (`SetupPanel.tsx`, workspace settings service)                                           | Setup only exists in the active root page; its scoped asynchronous project/board loads reject obsolete responses.                                                                                       | Existing model/source guards and production setup render.                                                                                                                     |
| Workspace/Open/New/Quit/close with pending time                                                                    | Root dirty/busy callbacks, `WorkspaceDocumentStore.mayReplaceWorkspace`, forwarding window delegate.                                                                                                    | Open/New/Quit and close-guard predicate regressions without creating a native window.                                                                                         |
| Chrome manifest, permissions, content/background bridges, extension update transport, Vite and Electron packaging  | Platform-specific transport/build files. Native uses URLSession, Keychain and a macOS-only release asset check. Browser permissions and service workers have no native runtime role.                    | Existing Cloud/Data Center identity, URL validation and macOS update tests. These browser implementation files are not copied into the Swift application.                     |

Existing Estimation, Gantt, Status, report/history/PDF and portable Chrome settings remain
in the native product. Their current model regressions run in the complete test suite;
this follow-up does not repeat or extend earlier live acceptance claims.

## Verification performed

- **138 tests passed: 110 Core + 28 application.** The application tests call production
  models and request boundaries with in-memory Jira/GitHub transports. Create/edit/delete
  use `adjustEstimate=leave`; stale versions, foreign authors, unknown outcomes and
  concurrent calendar updates have regressions. No production writes were used.
- `scripts/native-time-fixtures.mjs` generates five weekly-row, two report-metric and four
  timezone-warning cases directly from current Chrome source. Swift compares those
  outputs. Existing report, hierarchy, schedule, cascade, health, estimation and portable
  export golden fixtures remain covered by Core tests.
- `scripts/check-native-macos-background.sh` rendered **16 actual production layouts**,
  including complete Timesheet screens at 1440×900 and 1280×800, week/month,
  loading/error, new/edit worklog forms, team/individual report, Settings, Gantt, Status,
  Estimation and Jira setup. The rendered full Timesheet shows its header and more than
  five rows; controls do not overlap at either size. Rendering is at 2× pixel resolution.
- The checker requires `LSBackgroundOnly`, prohibited activation, an inactive process,
  detached hosting views and zero visible windows. AppKit retained one hidden editor
  window, explicitly counted in the manifest. Fixture request counts do not change while
  views render. It used no live transport, saved credentials, clipboard or desktop input.
- The final Apple Silicon app and archive are built locally with an ad-hoc signature,
  version 0.1.0, build 4. Code-signature verification, archive integrity, resource/config
  consistency and checksum are checked without launching the app. Private configuration
  checks report equality only, never token values. Nothing was uploaded or published.
- Packaging stages a complete signed bundle before replacing the output by rename. Earlier
  bundles stay intact in `apps/macos/dist/.previous-builds`; it does not overwrite an
  executable that may still be mapped by the user's running application.

Durable layout evidence and the machine-readable manifest are in
[`docs/qa/native-macos-2026-11-05`](qa/native-macos-2026-11-05/README.md). The app/archive
are under `apps/macos/dist/`.

## Acceptance still unverified or unavailable

| Check                                                                                                           | Actual status                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native keyboard, focus restoration, Option+Down/Escape/Tab, pointer, scroll synchronization and display scaling | Implemented/source-checked where applicable, but not exercised on the user's desktop. Detached SwiftUI returns zero document geometry for the two scroll probes; the checker records them under `unverifiedInteractions`.                                    |
| Complete Chrome/native visual acceptance on identical data and all states                                       | Production layouts inspected; this is not a claim of complete matching-screen acceptance or an independent final UI audit.                                                                                                                                   |
| Controlled live Jira worklog writes and Day Off concurrency                                                     | Production model/API fixture journeys passed. Actual Jira/calendar records were not changed for acceptance.                                                                                                                                                  |
| Closed pinned Dock icon                                                                                         | Dock's saved entry points to the correct `dist/Power View.app` with bundle ID `com.powerview.native`. Actual closed-app Dock appearance was not checked.                                                                                                     |
| Shared Drive handoff across two real users/Macs                                                                 | Two independent local readers continue one handoff file and reject a stale save. Live Drive synchronization across two machines is not accepted, and local coordination is not a cross-device lock. The file workflow needs no Google Cloud/Drive API setup. |
| Public macOS signing/notarization                                                                               | No Developer ID Application identity is available on this Mac. Local archive is ad-hoc signed; no public distribution or notarization was performed.                                                                                                         |

The desktop restrictions in `AGENTS.md` remain in force. No app launch, activation,
quit/restart, menu, native click or keyboard input was performed for this follow-up. No
upstream Computer Use permission or security setting was changed, and no repository change
is claimed to fix the upstream floating-menu defect.
