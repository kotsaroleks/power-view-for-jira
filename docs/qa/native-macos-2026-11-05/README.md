# Native macOS verification — 5 November 2026

All images here render the production SwiftUI/AppKit views with synthetic data. They are
not screenshots of the user's desktop or live Jira. Pixel dimensions are twice the logical
point dimensions. No native desktop input, launch, activation or restart of the user's
application was used.

| Evidence                                                                                                                       | What it establishes                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Full Timesheet 1440×900](full-timesheet-1440.png)                                                                             | Real root navigation, compact controls, weekly groups, today's header and more than five visible task rows.                                                                                             |
| [Full Timesheet 1280×800](full-timesheet-1280.png)                                                                             | Same production hierarchy at the narrower viewport; controls do not overlap.                                                                                                                            |
| [Week wide](timesheet-week-wide.png), [week compact](timesheet-week-compact.png), [month compact](timesheet-month-compact.png) | Native weekly inline fields, flat monthly rows/detail buttons and Day Off state.                                                                                                                        |
| [Refreshing](timesheet-refreshing.png), [read error](timesheet-read-error.png)                                                 | Production progress/cancel, stale result and error presentation.                                                                                                                                        |
| [New worklog](worklog-new.png), [edit worklog](worklog-edit.png)                                                               | Production date/time/duration/description forms, board picker and unchanged historical fields.                                                                                                          |
| [Team report](time-report-team.png), [individual report](time-report-individual.png)                                           | Shared capacity totals, current team membership and issue breakdown.                                                                                                                                    |
| [Section settings](section-settings.png), [Jira setup](jira-setup.png)                                                         | Production configuration layouts.                                                                                                                                                                       |
| [Gantt](gantt.png), [Status](status.png), [Estimation](estimation.png)                                                         | Existing native production layouts with fixture workspace data.                                                                                                                                         |
| [Verification manifest](verification.json), [render log](check.log)                                                            | Sixteen successful renders, prohibited activation, inactive process, zero visible windows, one hidden AppKit editor window, zero real transports and unchanged fixture request counts during rendering. |
| [Test log](tests.log)                                                                                                          | 110 Core + 28 application tests passed; production model/API journeys use in-memory transports.                                                                                                         |
| [Package verification](package-verification.json)                                                                              | Archive/app consistency, signature, icon/config checks, source hashes and preservation of the old executable's inode and content. Private configuration values are omitted.                             |

Run from the repository root:

```sh
swift test --disable-sandbox --package-path apps/macos
sh scripts/check-native-macos-background.sh /private/tmp/power-view-background-check
sh scripts/package-native-macos.sh
```

The checker compiles its own `LSBackgroundOnly` bundle with a separate entry point and
never attaches rendered views to a window. AppKit's hidden text-editor window is counted;
it never becomes visible. The user's running app, Keychain and clipboard are not used.

The two scroll probes could not obtain detached SwiftUI document geometry. They appear
under `unverifiedInteractions`; no scroll images or passed-scroll claims are supplied.
Actual keyboard/focus, pointer, scroll synchronization and display scaling remain
unverified. These renders are not complete Chrome/native visual acceptance or an
independent final UI audit. Live production writes, closed pinned Dock appearance, two
real accounts/Macs sharing through Drive, and public signing/notarization are separate
acceptance items in the [current report](../../native-macos-sync-2026-11-05.md).

Local output: `apps/macos/dist/Power View.app`, version 0.1.0, build 4, ad-hoc signed.
Archive: `apps/macos/dist/power-view-macos-arm64.zip`. SHA-256:
`4f4596b293ba87758421c71d298a0366360ad643d32db2b4c3a6470aaf30c6e4`.
