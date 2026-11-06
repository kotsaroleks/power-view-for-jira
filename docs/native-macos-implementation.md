# Native Power View copy — implementation evidence

Updated 2026-10-20. The requested result is a full native Swift copy of the Chrome
product, including its design, navigation, actions, data semantics and estimation board.
The replacement is **in progress**, not accepted as complete.

The rejected release-first interface has been removed from the active Swift target. Its
previous description is retained in `native-macos-implementation-2026-10-19.md` for
history and is not a description of the current app.

## Current implementation

The active app is SwiftUI/AppKit, without a web app wrapper. `PowerViewApp.swift` provides
Workspace/Reports/Gantt/Status/Estimation navigation using the Chrome tokens and layouts.
Setup supports Cloud and Data Center credentials, field mappings, completed statuses, JQL
and portable Chrome configuration. Workspace documents keep per-origin/per-board
estimation drafts, private dependencies and preferences.

Estimation directly ports the Chrome draft fields, stage rules and invalidation rules,
with client list import and handoff JSON. Gantt ports date inference, hierarchy, sort,
search, calendar, four dependency types and cascade scheduling. Jira write proposals
retain origin/session checks and read back successful writes. Status uses all loaded Jira
statuses. Reports reuse the ported calculations and now include metrics, changed issue
hierarchy, activity grouping, participants and local history. Current-sprint UI verifies
membership through Jira and provides participant issue lists.

## Evidence

- 84 Swift tests passed, including 19 hierarchy/filter/sort cases generated from the
  original Chrome functions, persistence revision guards, history caching and bounded
  parallel history fetching.
- The estimation workflow is compared against generated results from original TS.
- Cascade and external date-conflict cases are compared against original TS outputs.
- An independent auditor generated a configuration with the real Chrome SettingsStore,
  passed it through Swift, and reimported it with the strict original Chrome importer.
- Independent UI testing exposed an AppKit document-save deadlock. The app now uses an
  explicit atomic workspace store with debounced autosave and a quit-time flush. Both the
  implementation agent and independent auditor repeated editing 3.5 days to 4, Cmd-S and
  relaunch: the UI stayed responsive, 4 days persisted, and dependent estimation approvals
  reset correctly.
- Original Chrome and native estimation were exercised with the same synthetic inputs.
- Status and Gantt were opened in the native app after restart. Status showed two issues,
  one each in Done and In Review, 50% each. Gantt showed both tasks and the date scale.
  These observations do not prove all editing interactions.
- All four dependency types were created by dragging actual native Gantt handles on a
  synthetic file. Cycle creation was rejected, double-click removal succeeded, and the
  file saved. The first drag implementation failed UI testing and was replaced with a
  gesture inside the timeline before the successful repeat. Later changes to task-bar
  handles and previews compile but still need a fresh UI repeat.
- A structured PDF was rendered to a page image and visually inspected. Its metrics,
  Ukrainian issue text and grouped activity were readable; tests verify link annotations.
  This does not establish identical Chrome print styling.
- No production Jira or Drive writes were performed by the agent.

## Remaining acceptance work

The independent findings in `native-macos-copy-gap-audit.md` remain authoritative until
separately rechecked. Sprint report structure and issue-level change details have since
been revised against the original source; their fresh runtime comparison remains open.
Other remaining work includes Chrome-equivalent PDF styling, complete Gantt keyboard and
inline editing behavior, current-sprint status drilldowns, responsive layout verification,
and fresh end-to-end checks of the latest build.

The latest attempted screen check reported that macOS was locked, despite the previous
unlock acknowledgement. No successful UI verification is claimed for that attempt. Live
current-sprint loading and Jira inline edits need runtime verification. Native Drive
saving/sharing and two-user continuation are not proven. Distribution signing,
notarization and auto-update are incomplete.

Build: `sh scripts/build-native-macos.sh`; output `apps/macos/dist/Power View.app`. Tests
and successful compilation are component evidence, not product acceptance.

## Form design and usability pass — 2026-10-20

Shared fields now use consistent 40-point single-line controls, focus borders, disabled
backgrounds, accessible labels/help, and compact scrollable multiline input. Secure token
input uses the same field treatment. Estimation includes contextual placeholders, an
inline positive-estimate error, and an empty-input guard for adding issues. Its detail
form uses two columns at desktop width and adapts to one column when space is limited.
Report controls and calendar settings also use adaptive grids; setup field selectors have
consistent labels and control surfaces.

The packaged app was relaunched and the estimation form visually checked. A disposable
issue was given a zero-day estimate: the inline error appeared, Tab moved to
decomposition, and the test value was cleared and saved. The initial visual check exposed
an unused third column; the final build was corrected and visually checked with two
full-width columns. Narrow-window behavior is implemented but has not yet been manually
verified.

## Startup continuity — 2026-10-24

The root restores the last regular product page per Jira/board identity and reconnects
using the saved Keychain credential once per session. It opens cached board data while
reconnecting and retains it on failure, with Retry and Settings controls. The stored
credential is not rewritten during a saved-account reconnect. An origin check prevents a
saved board from automatically connecting to a different Jira site. Settings metadata
reloads when asynchronous authentication succeeds. Atomic saves also mirror opened
workspace files into the permanent Application Support recovery location.

86 Swift tests passed, including cross-origin resume rejection and allowed-page fallback.
A live launch restored the saved Jira account without token entry. The requested board
2563 (8.2 Aria) was loaded into permanent recovery storage. After selecting Gantt,
quitting and relaunching the packaged app, Gantt and its real issue list reappeared while
automatic reconnect ran. No production Jira edits were performed during this check.

## Gantt interaction fixes — 2026-10-24

Dependency labels now have keyboard focus, a visible selected outline and Delete support.
Labels sharing an endpoint are separated horizontally. Dependency lines highlight the
selected link and external-date conflicts. Table keyboard focus scrolls the selected row
into view. Post-write reloads preserve absent date-field mappings instead of inventing
field IDs.

The packaged native UI was tested on two synthetic offline tasks. SS, FS, FF and SF were
each removed with Backspace and recreated with actual handle drags. A reverse dependency
was rejected as a cycle. All four types were verified in the saved JSON. Search reduced
the visible rows to TEST-2 and clearing it restored both rows. Focusing the table divider
and pressing Left changed its width from 520 to 500. 86 Swift tests passed. The real 8.2
Aria workspace (157 issues) was explicitly saved in dist/8.2 Aria.pvworkspace before
switching fixtures, and reopened after testing. No production Jira writes occurred. A
subsequent collapse/expand UI check timed out in computer automation; that check is not
counted as passed. Real Jira date-write interaction remains unverified; existing mocked
transport tests do not establish that UI acceptance.

### 2026-10-25 — backlog implementation and acceptance evidence

- Workspace Open/New/Save operations are serialized. Edits made before debounce are
  preserved, including unnamed documents, with Open Previous Workspace recovery.
  Corrupt/missing preferred document falls back to recovery. Two application lifecycle
  tests pass. Independent source audit rechecked the current serialization and archive
  initializer; its earlier concurrency findings are closed for these paths. Recovery write
  failure now leaves saved=false and reports that the document opened/was created while
  its recovery write failed.
- Per-board archive now includes setup and handoff path/fingerprint. Sprint owner identity
  and category filtering, distribution, and status drilldowns were implemented. A time
  estimate cannot silently become Story Points. These have source/model/transport
  evidence; fresh live Sprint UI acceptance is still outstanding.
- Gantt native fixture: actual center drag moved TEST-1 Oct19→21 to Oct21→23; finish
  resize changed due to Oct24, start resize changed start to Oct22. Each generated the
  expected mock PUT and verified readback. Fixed the preview feedback by measuring drag in
  the stable named timeline coordinate space. No real Jira writes were made.
- Report printable HTML was ported from Chrome and checked against generated original
  fixtures. WebKit is used solely for system PDF rendering; the app remains SwiftUI.
  One-page output has 1,033 text characters. Stress output has 9 A4 pages, 12,875 text
  characters, all 80 additional synthetic issue keys, and 83 URL annotations. Removed
  screen-only tree height clipping from PDF styles. Full visual parity is not claimed.
- Estimation was exercised in the actual packaged app with an isolated synthetic
  .pvworkspace: two issues, 3.5-day estimate, Tech Lead, decomposition, scope
  confirmation, all QA fields, QA submission and Ready to dev. Native Save handoff wrote
  version1 JSON; simulated external file change was refused on save; importing the latest
  handoff restored the draft and ready count. The real 8.2 Aria workspace was preserved
  and reopened afterwards. Cross-Mac/two-account Drive sync remains unverified; local file
  coordination is not a distributed lock.
- Update app now checks a published macOS GitHub release, independently of Refresh Jira.
  Native runtime correctly showed an unavailable check, rather than pretending that Jira
  refresh updated the application. Local arm64 ZIP and checksum are produced by the
  package script. No Developer ID identity is available; notarization/public release
  remains external work.
- Current live Jira reconnect is blocked inside macOS Keychain SecItemCopyMatching.
  Automatic reads request no interaction and the UI wait is bounded to 15 seconds; a
  pending system read cannot create an endless spinner or parallel credential reads. Saved
  board remains usable offline. No token was printed, exported, or requested here.

See native-macos-delivery-backlog.md for unchecked acceptance work; the local build is not
a declaration of full Chrome/native product equivalence.

### 2026-10-25 — live reporting followup

Jira reconnected and the actual native application refreshed board2563. Daily and Weekly
both generated over all157 issues with completeness.complete=true and persisted separate
history JSON files. Daily showed no tracked period changes. Weekly showed1 completed
in-period,3 created and694800seconds of worklog (193h); these matched the persisted
result. No Jira writes were performed. Sprint generation/drilldown and history deletion
are not counted as accepted: the UI tool stopped exposing report controls and menu input
did not produce a verifiable selection. System stack sampling showed a native popup menu
event loop rather than a demonstrated report calculation deadlock.

Implemented followup usability fixes: lock report parameters while generation is active;
move cache/force-refresh technical explanation into the Generate button help; restore a
saved report's language; provide compact page navigation below860pt; wrap Daily/Weekly,
Sprint and Current Sprint metric cards adaptively. Current Sprint reads current
board/sprint membership directly and does not fetch issue history; an unnecessary cache
argument was removed after verifying the Core path. Build/package completed and all96
tests passed; fresh visual acceptance of this latest binary is still required.

The independent followup found and rechecked three reporting corrections: period start→end
is now separate from data cutoff; sprint choice defaults to the first available server
sprint; Current Sprint reload identity includes the verified account and rejects stale
responses via per-load UUID/account guards. Reports context reloads on
account/origin/board change and cancels an old generation. Progress, error and result
callbacks now also check their generation UUID/context, so a cancelled request cannot
clear or overwrite a newer operation's state. Native menu input remains unverified; a text
clarification about Mac availability is pending.

### 2026-10-27 — native acceptance resumed with Mac unlocked

- Reconnected the saved Jira account through the existing setup button; no token was
  requested or printed. Compact navigation works in the narrow window.
- Current Sprint verified actual Aria Sprint3:98issues,10done,70in-progress,18not-started.
  Completed opens a sheet with10 Jira issue links. Andrii Lysachenko expands to3of6 open
  issues; Show finished yields6of6 and includes the3completed issues.
- Generated active Sprint13609 on board2563. Result98issues,10completed,77.5h worklog,
  issue-count completion10.204%. Two Jira history/worklog denials are shown and
  completeness is false; this is accepted partial reporting behavior, not complete data.
  Changing the basis to Original Estimate immediately produced1.9% from the same snapshot.
- Actual Generate PDF native save-dialog flow wrote a local test PDF:9A4 pages,17230text
  characters, both affected issue keys preserved. File stays local and is not in the
  release ZIP.
- Opened the Sprint from history after app restart. Delete removed it and cleared the
  displayed result. New Undo restored the same report. Core recovery test also proves that
  restore cannot overwrite a competing immutable report. Deleted reports are moved into
  the private history Deleted folder, not permanently removed.
- Hierarchy Gantt fixture proved collapse/expand and exposed a keyboard bug: status and
  assignee buttons were not keyboard-focusable under the Mac's normal settings. Added
  explicit focusable(); actual Tab/Right/Down/Home/Ctrl+Home/Ctrl+End/F2/Escape paths
  passed. Fixture editor cannot fetch full assignable metadata by design; opening/closing
  that editor is verified, not a production assignment write.
- Cleared stale offline notice after successful manual reconnect. All97 tests pass and the
  local arm64 package is rebuilt. No production Jira writes or public uploads.
- Direct Dock accessibility still times out; no closed pinned Dock acceptance is claimed.

After replacing the ad-hoc-signed local app, macOS required access approval for the saved
Keychain item. The user explicitly approved the system dialog on the Mac. Reconnect then
succeeded as the saved account; the stale offline notice disappeared in the actual UI. No
keychain ACL workaround, new token, password extraction or signing-identity bypass was
used. The SecurityAgent UI was left to the user because the automation tool forbids it.

## 2026-11-04 Chrome additions

Timesheet, GitHub Day Off, Atlassian Teams Time Report and section visibility have native
implementations. See
[synchronization evidence and acceptance limits](native-macos-chrome-sync-2026-11-04.md).
Final desktop automation stopped after the user reported floating menus; remaining
verification continued without controlling windows.

## 2026-11-05 synchronization follow-up

See
[the current implementation and verification inventory](native-macos-sync-2026-11-05.md)
and [delivery backlog](native-macos-delivery-backlog.md). The final source passes 110 Core
and 28 application tests. Production views are rendered in a prohibited-activation
background process; real keyboard/pointer/scroll and external two-Mac acceptance remain
unverified. No native desktop control was used for this follow-up.
