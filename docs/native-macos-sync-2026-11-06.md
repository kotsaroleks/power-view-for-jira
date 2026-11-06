# Native completion follow-up — 6 November 2026

This is the current implementation and verification report. It supersedes the
[5 November checkpoint](native-macos-sync-2026-11-05.md), which understated functional
differences as remaining acceptance only. The comparison below uses current Chrome source
and production views, rather than the presence of similarly named Swift files.

## Functional differences corrected

- The main Timesheet follows the approved weekly entry flow. The generic Log time button
  is removed. Hours are entered in the table; an empty monthly cell returns to weekly
  entry. Add/check issue, filters and help are compact secondary actions.
- Details contain the individual record ID, local start time, description, total and **Add
  another worklog**. Adding a second record preserves the first instead of rewriting their
  aggregate. The production presentation model carries the same issue, date and return
  cell through Details → Add/Edit → close. Confirmed deletion closes details and shows the
  same success feedback as Chrome. A confirmed save stays protected until its refresh
  completes, preventing a second submission while the form is waiting to close.
- Known forms initially focus Duration. Closing forms/details requests that the real row
  and cell be revealed before restoring focus. Week/month fields share a stable focus
  target. Actual native key events and scrolling remain unverified, as below.
- Assigned, pinned and priority tasks are read directly as known issues, even when the
  discovery search omits them. Other unselected board issues remain unread until Load
  hours. Changing the selected task sources invalidates obsolete reads; this does not turn
  the board into a filter on personal worklogs. Month excludes these weekly sources.
- Worklog save/delete with an unknown outcome immediately rereads actual own records for
  the attempted issue/day/timezone. Input and the unresolved state remain visible; retry
  is enabled explicitly after a successful read and user verification. A later timezone
  change cannot silently reinterpret the original operation. Reread records include their
  descriptions and readable start times in that original timezone. Day Off similarly
  requires a fresh calendar read before its uncertainty can be acknowledged. No
  acknowledgement automatically sends another mutation.
- Time Report has explicit **Load Time Report**, **Cancel loading**, team refresh and
  separate Day Off refresh. Changes to team, period or timezone clear the previous result.
  Discovery alone does not scan time. Failed discovery cannot revive an old team.
- Individual View displays one selected current employee, with its own picker and issue
  breakdown. Clicking a team member opens that person's view. Team rows include logged,
  expected and utilization values; employee totals, weekday deficits and Day Off conflicts
  match Chrome. A zero-second worklog still counts as a conflict on Day Off. Issue rows do
  not invent per-issue capacity deficits.
- Partial worklog reports withhold the table and full totals, showing the failed issue
  count and retry guidance. Unknown calendar data withholds capacity/deficit indicators.
- Roster sync is an owned cancellable operation. Leaving the report or changing teams
  cancels it, including a check immediately before GitHub PUT. A stale completion cannot
  replace current feedback or sync a previously selected roster.

## Layout corrections

The Timesheet now uses the original page hierarchy and available width, rather than a new
enclosing card. Title, period controls, board/task actions, compact filters and the
coverage bar are separate rows. A native wrapping layout preserves readable actions in
narrow windows. Date columns fill the available weekly width; monthly columns retain their
minimum readable width. Pin symbols, row links, two-line issue summaries, group headings,
weekend shading, today's header and unpadded hour values follow the reference.

The root header chooses full navigation or a compact menu based on the controls' real
sizes, including when all sections are enabled. Unavailable sections remain visible and
disabled until board setup exists. The Timesheet subtitle is Personal time. These are
native SwiftUI/AppKit controls; browser service workers and permission bridges are not
embedded in the application.

## Verification

- **148 Swift tests passed: 110 Core + 38 application.** Added production-model/API
  journeys cover second-record creation, edit/detail return targets, explicit reports,
  one-person drilldown, partial-result suppression, day-style rules, obsolete roster sync,
  omitted assigned/pinned/priority time and unknown save/delete/calendar recovery. Writes
  use in-memory transports and leave issue estimates unchanged.
- **Two production Chrome browser scenarios passed headlessly**, using a separate
  temporary browser profile and synthetic Jira/GitHub responses. The web reference was
  built from current source with fixture-only storage configuration; installed extension
  files and the user's browser profile were not modified. The first attempts exposed
  missing fixture icons and an incorrect fixture storage root; final runs include the
  correct package layout/root and passed.
- `scripts/native-chrome-scene.mjs` extracts the actual browser test's issues and initial
  worklogs. The corresponding Swift scene has the same ten visible rows in the same order,
  six own worklogs and **37,800 seconds (10h 30m)**. Expected hierarchy/order is computed
  by the current Chrome `weeklyRows` function. Both component and full-root native views
  use this scene at the reference viewport sizes. Native production models also perform
  the same create → edit → delete fixture journey; after three requests the original
  records and 10h 30m total remain, details close and deletion feedback is visible. All
  three fixture writes use `adjustEstimate=leave`.
- **26 production layouts** are rendered by `scripts/check-native-macos-background.sh` in
  a background-only, prohibited-activation process with zero visible windows. The expanded
  set includes all-section/minimum-width headers, known new/edit forms, multiple-record
  details, retained unknown-write input, empty Timesheet and partial Time Report. Request
  counts remain unchanged while rendering, including recovery forms; rendering never
  replays a write. The manifest records the exact render count and two unsupported
  programmatic scroll checks.
- Read-only installation inspection resolves both the Dock URL and its bookmark to the
  current bundle. The bookmark reports stale metadata but resolves to the correct path.
  Both the icon resource and the system file-icon API return the intended image. This
  verifies icon lookup, not the actual Dock while the user's app is closed.
- Local version **0.1.0, build 5** is packaged with an ad-hoc signature. The app is staged
  and replaced without overwriting old mapped executable files. Package integrity,
  signature, source hashes, icon/config consistency and checksum are recorded separately.
  No archive, credentials or private Jira data were uploaded or published.

Durable evidence: [QA images, logs and manifests](qa/native-macos-2026-11-06/README.md).

## Exact acceptance boundary

Native key/pointer input, focus restoration in a real window, scroll/header
synchronization and display scaling have **not** been exercised on the user's desktop.
Both NSScrollView geometry probing and production ScrollViewReader requests remained at
zero offset while detached. They are recorded as unverified, without fabricated scroll
images or a passed-interaction claim. The checked-in desktop restrictions explicitly
require leaving such checks unverified and continuing independent work.

Live production worklog mutations, live two-account/two-Mac Drive continuation and the
actual closed pinned Dock appearance remain unverified. Local two-reader handoff and
in-memory concurrent calendar tests are not evidence of cross-device atomic locking. No
Developer ID Application identity is available for public notarized distribution.

The source/data comparison and rendered layouts do not establish complete visual identity
on every screen or an independent final UI audit. No native desktop control, user app
activation/quit/restart, security setting or Computer Use permission change was used for
this follow-up.
