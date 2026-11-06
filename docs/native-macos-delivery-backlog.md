# Native delivery backlog

## Completion follow-up — 2026-11-06

Current report: [6 November implementation and evidence](native-macos-sync-2026-11-06.md).
148 Swift tests (110 Core + 38 application) and two headless production Chrome scenarios
pass. The earlier list below understated functional differences; the following are now
implemented and checked through production models/API fixtures and rendered layouts.

- [x] Match the approved grid-first entry flow; remove the generic Log time button.
- [x] Add another individual worklog from details; preserve existing records and the
      issue/date/focus target through details, add and edit sheets.
- [x] Close details and show confirmed deletion; keep Save busy until its refresh
      completes, preventing duplicate submission during form completion.
- [x] Read assigned, pinned and priority tasks directly when discovery omits their time.
- [x] Retain unknown save/delete input, reread actual own records and require explicit
      reconciliation before retry; preserve the operation's original timezone.
- [x] Require a fresh Day Off read before acknowledging an uncertain calendar write.
- [x] Match explicit Time Report Load/Cancel, single-person drilldown, per-person totals,
      deficit/conflict styling and suppression of partial report totals.
- [x] Cancel roster sync on leaving/changing teams, including a final pre-write check.
- [x] Match compact Timesheet hierarchy/width, wrapping toolbars, pin/row labels and
      minimum-width navigation with all sections enabled.
- [x] Compare current Chrome and native rows/hours on the same production-browser fixture;
      render full root at 1440×900 and 1280×800 plus a minimum-width fixture.
- [x] Resolve Dock URL/bookmark and decode the intended icon through the system icon API.
- [x] Build and verify local app/archive, version 0.1.0, build 5.
- [ ] Real native keyboard/pointer/focus/scroll/display-scale acceptance and complete
      matching-screen visual/independent UI acceptance. Desktop interaction is prohibited
      by AGENTS.md; detached scroll attempts remain explicitly unverified.
- [ ] Live production Jira write acceptance, closed pinned Dock appearance and Drive
      continuation across two real users/Macs. Fixture/local tests do not replace these.
- [ ] Public Developer ID signing/notarization; no suitable identity is available.

## Earlier Chrome synchronization — 2026-11-05

Current implementation and evidence:
[5 November synchronization report](native-macos-sync-2026-11-05.md). The latest full
native test run is 110 Core + 28 application tests. Model/API journeys and detached
production renders are distinguished from real desktop interaction.

- [x] Port Timesheet “Copy last week's tasks”: add task rows from the previous week's own
      worklogs without copying hours; reject incomplete source reads.
- [x] Match Timesheet timezone selection: a supported-zone picker, persistent
      Jira-profile/custom source distinction, following profile changes when Jira is
      selected, and the current Chrome warning about offsets relative to Kyiv.
- [x] Match month-specific row selection and detail buttons; weekly hierarchy/groups,
      group labels, unread hours, explicit Load hours, today's header and detail shortcut.
- [x] Add explicit Cancel loading and cancellation of obsolete form search requests.
- [x] Exercise production models/API boundaries for time create/edit/delete, preserved
      draft fields, queued inline saves, Day Off conflicts/concurrent clients and
      team/account/period switches. All writes use in-memory fixtures.
- [x] Add window-close/Open/New/Quit protection for pending Timesheet input and writes.
- [x] Render 16 production layouts offscreen, including full 1440×900 and 1280×800
      Timesheet viewports, week/month, loading/error, forms and team/individual reports.
- [x] Compare weekly rows, Time Report metrics and timezone warnings against generated
      golden data from the actual current Chrome functions.
- [x] Finish the Chrome/native change inventory and final local app/archive packaging.
- [ ] Real native keyboard/focus/Escape/Tab, pointer, scroll/header synchronization,
      display scaling and complete matching-viewport visual acceptance. Detached SwiftUI
      does not expose usable scroll-document geometry; these checks remain unverified.
- [ ] Controlled live Jira mutation acceptance. Production Jira records have not been
      changed for testing.

Delayed board metadata is covered by a production-model regression; real per-board UI
acceptance remains unverified. Pinned closed Dock appearance, Drive continuation across
two accounts/Macs and distribution signing below remain external acceptance work.

## Earlier delivery evidence — 2026-10-27

Updated 2026-10-27. User authorized completing the entire backlog without per-item
prompts. This file tracks acceptance; a passing build is not full product acceptance.

- [x] Restore last workspace/page and reconnect saved Jira account; live restart verified.
- [x] Replace malformed manual icon with Apple iconutil output; closed-app Finder
      verified.
- [ ] Verify pinned Dock icon while app is closed.
- [x] Gantt dependency Delete, all four drag types, cycle rejection, search, divider
      keyboard; native fixture verified.
- [x] Gantt move and both date-edge resize gestures: native UI → mock PUT → readback
      verified; fixed local-coordinate preview feedback.
- [x] Gantt collapse/expand, arrows between cells/rows, Home/End/Ctrl+Home/Ctrl+End,
      F2/Escape verified in native hierarchy fixture. Fixed status/assignee focusability.
- [ ] Gantt original/native visual acceptance at matching viewport.
- [x] Current sprint status drilldowns, person identity/filter and distribution
      implemented; identity/category tests pass.
- [x] Current sprint live UI: Aria Sprint 3,98 issues,10 completed; completed drilldown10
      links; person filter3/6→6/6 verified.
- [x] Daily and Weekly live read-only generation on board2563: 157 issues, complete
      results saved to local history and visible in native UI.
- [x] Sprint live generation, history reopen after restart, deletion clears displayed
      result, Undo restores the saved report; native UI verified.
- [x] Export PDF with original printable report layout: template content checked against
      Chrome; system render verified on one-page and nine-page fixtures, all 80 added
      issues retained, A4 dimensions, 83 URL links. The original printable template has no
      activity charts.
- [x] Estimation native UI: add two issues, 3.5-day estimate, scope confirmation, QA
      preparation, Ready to dev; file export/import restores fields, changed-file
      overwrite rejected.
- [ ] Shared Drive-file continuation across two accounts/Macs (local handoff is
      implemented; cross-device atomic locking is not claimed).
- [ ] Full Chrome/native scope, settings, visual and responsive acceptance.
- [x] Preserve pending edits before Open/New; recover if preferred document is corrupted.
      Two application lifecycle tests pass; independent source recheck found no remaining
      P1 in these paths.
- [x] Archive per-board setup/status/date/points/Sprint mappings and handoff fingerprint;
      model roundtrip tests and independent source recheck pass.
- [ ] Per-board delayed-load UI acceptance.
- [x] Prevent time-estimation seconds from being labeled Story Points; transport test
      passes.
- [x] Honest application-update flow, local Apple Silicon installation archive, checksum
      and release instructions.
- [ ] Distribution signing/notarization (requires an available Apple signing identity).

No production Jira writes, publication, destructive resets or credentials in artifacts.

Latest full test run: 95 Core + 2 application tests passed. Jira subsequently reconnected;
the 25 October live Daily and Weekly runs both returned completeness.complete=true.
Weekly: 1 completed during period, 3 created, 694800 seconds worklog (193h). Daily: no
tracked period changes, explicitly shown. On27October Sprint generation completed with
98issues,10completed,77.5h worklog and10.2% completion. Jira denied worklog/history for
two issues; both warnings were shown and history marked Partial. Switching to Original
Estimate recomputed1.9% without regeneration. Actual UI-exported PDF has9A4
pages,17230text characters and both warning issue keys. Dock automation still times out;
closed pinned icon is not counted as accepted. Drive across two accounts and signing
remain external acceptance work.
