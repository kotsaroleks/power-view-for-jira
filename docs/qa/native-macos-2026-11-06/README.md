# Native completion evidence — 6 November 2026

Current scope and limits: [implementation report](../../native-macos-sync-2026-11-06.md).
All records shown here are synthetic. No production Jira/GitHub writes, user desktop
input, user application restart or publication were used to produce this evidence.

## Results

- 148 Swift tests passed: 110 Core and 38 application tests; [full log](tests.log).
- Two current production Chrome scenarios passed in a private headless browser profile
  with fixture Jira/GitHub responses; [browser log](chrome-tests.log).
- 26 production native layouts rendered with zero visible windows and zero real network
  transports. Rendering did not change fixture request counts. The checker remained
  inactive with activation prohibited; AppKit retained one hidden editor window. See
  [verification.json](verification.json) and [check.log](check.log).
- Local app version 0.1.0, build 5: archive integrity, ad-hoc signature, icon/config
  consistency, checksum and source hashes are recorded in
  [package-verification.json](package-verification.json). Previous executable files remain
  intact, including their original inode and hash.

## Same Chrome and native scene

[Shared scene data](shared-chrome-timesheet-scene.json) is generated from the actual
`e2e/timesheet-production.spec.ts` source. The expected hierarchy is computed with the
current Chrome `weeklyRows` function, rather than copied into a separate expectation. Both
implementations have the same ten visible rows and 37,800 seconds (10h 30m) in six
original worklogs. Native production models perform create → edit → delete against the
fixture transport, retain the original data and total, close details and show confirmed
deletion feedback. All three writes use `adjustEstimate=leave`.

| Viewport | Native full application                     | Current Chrome reference                          |
| -------- | ------------------------------------------- | ------------------------------------------------- |
| 1440×900 | [Native](chrome-scene-full-native-1440.png) | [Chrome](chrome/timesheet-agreed-groups-1440.png) |
| 1280×800 | [Native](chrome-scene-full-native-1280.png) | [Chrome](chrome/timesheet-agreed-groups-1280.png) |

Native PNGs are rendered at 2× pixel scale. Component views are also available at
[1440 reference width](chrome-scene-native-1440.png) and
[1280 reference width](chrome-scene-native-1280.png). These images document the actual
production layouts; they do not establish complete pixel identity or real native
interaction acceptance.

## Additional production states

| Area                                 | Evidence                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full navigation and narrow layout    | [1440](full-timesheet-1440.png), [1280](full-timesheet-1280.png), [minimum width](full-timesheet-minimum.png)                                        |
| Worklog forms and individual records | [New](worklog-new.png), [edit](worklog-edit.png), [multiple-record details](worklog-details-multiple.png)                                            |
| Unknown mutation outcome             | [Actual own records](worklog-unknown-result.png), [retained input](worklog-retained-unknown-draft.png)                                               |
| Time Report                          | [Team](time-report-team.png), [single employee](time-report-individual.png), [partial read](time-report-partial.png)                                 |
| Timesheet data states                | [Empty](timesheet-empty.png), [refreshing](timesheet-refreshing.png), [read failure](timesheet-read-error.png), [month](timesheet-month-compact.png) |
| Existing product sections            | [Gantt](gantt.png), [Status](status.png), [Estimation](estimation.png), [setup](jira-setup.png), [section settings](section-settings.png)            |
| Icon lookup                          | [Bundle resource](bundle-icon.png), [system file icon](system-file-icon.png)                                                                         |

The recovery form retains duration and description while showing actual reread records,
including their descriptions and start times in the original operation's timezone. It does
not replay the request. A successful reread and explicit user acknowledgement are required
before a new attempt is allowed.

## Unverified acceptance

Both detached production ScrollViewReader checks remained at x=0/y=0. They are listed
under `unverifiedInteractions`, with no fabricated scrolled image or interaction pass.
Real keyboard/pointer input, focus restoration, scroll/header synchronization, display
scaling, complete visual acceptance and an independent final UI audit remain unverified.
The repository's desktop coexistence rule prohibits using the user's desktop for these
checks.

The Dock URL and bookmark resolve to the current app, and both icon APIs decode the
intended image. The bookmark reports stale metadata. This is not a screenshot or live
acceptance of the pinned Dock icon while the app is closed.

Live production Jira writes and Drive continuation across two real users/Macs remain
unverified. Local file handoff and in-memory concurrent calendar tests do not establish
cross-device atomic locking. Public Developer ID signing/notarization is unavailable; the
local archive uses an ad-hoc signature and has not been published.
