# Power View for macOS

Native SwiftUI/AppKit implementation of the Chrome Power View product, macOS 14+. The
previous release-first UI has been removed from the active app. This replacement is still
being checked against the original; it is not yet a completed migration.

Build from the repository root:

```sh
sh scripts/build-native-macos.sh
```

The output is `apps/macos/dist/Power View.app`, with a local ad-hoc signature.

To create the Apple Silicon installation archive and checksum:

```sh
sh scripts/package-native-macos.sh
```

Unzip `apps/macos/dist/power-view-macos-arm64.zip` and move Power View.app to
Applications. Quit the previous copy before replacing it. The local archive is ad-hoc
signed; Developer ID signing and Apple notarization require an Apple signing identity,
which is not available on this machine. No public release has been published. The app's
Update app action checks this repository's GitHub releases and offers a matching macOS
download when available. Installation is manual.

The app opens Jira workspace setup, then the original Workspace, Reports, Gantt, Status
and Estimation navigation. Connect to Jira Cloud with an API token or Data Center with a
PAT using the app's credential fields. Credentials stay in Keychain. Existing Chrome board
configuration can be imported in Settings. Save the native workspace with CmdS; its
`.pvworkspace` document contains scope and estimation drafts. Estimation uses the original
Tech estimation → PM clarification → Scope confirmation → QA preparation → Ready to dev
workflow and Chrome handoff JSON.

Save handoff writes a Chrome-compatible JSON file. Choose a local folder or an already
available shared Google Drive folder in the standard file dialog. The next person imports
that file, continues the estimation, and saves it back. Pass the file to one person at a
time: this is file handoff, not simultaneous cloud editing. A changed local file is
protected against stale overwrite; Save a copy preserves a competing draft. Google Drive's
eventual sync across two Macs cannot provide an atomic cross-device lock and has not been
accepted in a two-account live test. No Google Cloud project or separate Drive API setup
is needed for this file workflow.

Specification: `docs/native-macos-product-spec.md`. Current synchronization evidence and
remaining acceptance: `docs/native-macos-sync-2026-11-06.md` and
`docs/native-macos-delivery-backlog.md`. Earlier evidence:
`docs/native-macos-implementation.md`. Independent gap audit:
`docs/native-macos-copy-gap-audit.md`.

Core checks:

```sh
swift test --disable-sandbox --package-path apps/macos
```

To inspect native layouts without interacting with the user's desktop:

```sh
sh scripts/check-native-macos-background.sh /private/tmp/power-view-background-check
```

This compiles the production views with a separate entry point into a private
`LSBackgroundOnly` checker bundle. It renders production layouts, including complete
1440×900 and 1280×800 Timesheet screens, week/month, forms, reports, Gantt, Status,
Estimation and setup, directly into PNG files with `NSHostingView`. The rendered views are
never attached to an `NSWindow`. It requires the prohibited activation policy and checks
that the process stays inactive with zero visible windows before and after each render.
AppKit may keep hidden editor windows; they are never shown and the checker remains
prohibited from activation. All data access uses an in-memory fixture transport; the
user's Power View instance, saved credentials, desktop input and clipboard are unused.
`verification.json` records the result; a failed run cannot retain a previous success
status. The `check.log` file contains build/check diagnostics. This checks rendered
layouts, not real pointer/keyboard interaction or complete native menu behavior.
Unsupported detached scroll checks are recorded under `unverifiedInteractions` instead of
being counted as passed.

The user reported native Computer Use menus appearing over unrelated windows. The
project's `AGENTS.md` requires this background workflow instead of desktop automation. No
changes were made to the upstream Computer Use plugin or its permissions.

Tests cover model compatibility, calculations and request guards; passing them does not
establish visual or end-to-end parity. Live two-user Drive continuation and full product
visual acceptance remain unverified. Report PDF now uses the original report template and
styles through the system print engine; long-report pagination has a separate render
check.

## Chrome additions — 2026-11-04

The native app now includes Timesheet, GitHub-backed Day Off, Atlassian Teams Time Report,
and section visibility settings. Timesheet and Time Report use the same Jira worklog and
calendar rules as Chrome. Timesheet works independently of a saved board; board selection
only supplies optional task rows. Reports and Estimation can be enabled in Settings.

The build reads the same private Day Off configuration as Chrome, from
`POWERVIEW_DAY_OFF_GITHUB_CONFIG` or `.secrets/day-off-github.local.json`. It bundles that
configuration locally without printing its credentials. No separate login/server is
needed.

The 5 November follow-up adds task copying without hours, Jira/custom timezone selection,
current Chrome weekly grouping and board picker, month-specific rows, cancel/stale-result
guards and serialized inline saves on Enter/blur. Unread task hours stay unknown until
explicitly loaded. Closing, opening a different workspace and quitting protect pending
time input. The final bundle is staged and replaced by rename; the previous bundle stays
intact under `dist/.previous-builds`, so a running executable is never overwritten.

The 6 November correction removes the generic Log time action, adds a separate record from
details, explicit report loading/cancellation, one-person drilldown, partial-result
suppression and unknown-result reconciliation. Assigned/pinned/priority tasks are read
directly when discovery omits them. Timesheet layout and full-root navigation now wrap at
narrow widths. Current validation: 148 Swift tests and two headless production Chrome
scenarios, plus current Chrome/native shared-fixture renders. See the current QA manifest
for the exact render count and unsupported scroll probes. The current shared-scene run
renders 26 states. Optional shared scene generation requires Node 24+:

```sh
node scripts/native-chrome-scene.mjs /private/tmp/power-view-native-chrome-scene.json
POWER_VIEW_NATIVE_CHROME_SCENE=/private/tmp/power-view-native-chrome-scene.json sh scripts/check-native-macos-background.sh /private/tmp/power-view-background-check
```

Detailed scope, verification and visual acceptance limits:
`docs/native-macos-sync-2026-11-06.md` (current), `docs/native-macos-sync-2026-11-05.md`
(earlier checkpoint), `docs/native-macos-chrome-sync-2026-11-04.md` (earlier checkpoint).

## Description reports — 2026-11-07

Build 6 adds **Reports → Description changes**: select a closed daily period and
explicitly preview changed descriptions, all editors and the parent hierarchy. Complete
empty periods and failed/incomplete reads are distinguished. The preview sends no
messages. The separate GitHub Actions worker handles daily Google Chat delivery without
this app running. See `docs/daily-description-report.md` for one-time setup and
activation.

Validation adds shared TypeScript/Swift golden fixtures, read-only Jira pagination and
identity tests, and five production description-report renders. The full Swift suites pass
152 tests; the shared Chrome-scene background check renders 31 states with zero visible
windows. Real native pointer/keyboard acceptance remains unverified.
