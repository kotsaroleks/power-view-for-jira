# Chrome top navigation — 10 November 2026

## Fixes

- Settings no longer clears the last loaded workspace when editing a query or changing a
  board invalidates its issue preview. The draft remains available on returning to
  Settings, and Save and continue can load and apply a replacement query.
- Gantt refreshes retain the workspace that initiated the Jira update. An unsaved Settings
  query cannot be adopted by Reports or overwrite the active workspace after that refresh;
  the independent draft preview is left untouched.
- Workspace and brand/home navigation no longer depend on Jira context, metadata or issue
  loading completing. Authenticated feature destinations remain reachable before board
  data is ready and display an explicit setup/retry state instead of a blank page.
- Completing workspace setup in the background preserves a newer menu choice. This
  includes selecting Settings again while an initial load is still running.
- Unfinished Timesheet cells continue to protect edits. A blocked navigation or Update app
  action now explains that the user must save or cancel those changes. A blocked
  Diagnostics click does not load diagnostics in the background.
- Diagnostics has the same current-page indication as the other destinations.
- Timesheet is consistently disabled in both the menu and Workspace on Data Center, with
  an explanation that it requires Jira Cloud. Disabled buttons do not gain an enabled
  hover appearance.
- Update app saves a short-lived, one-use reload handoff before reloading the extension.
  The new worker reopens the app and restores the Jira context only if its tab still
  matches the site and host access remains granted. Ordinary startup, expired handoffs,
  closed Jira tabs, changed sites, revoked access and storage failures have coverage.

## Functional coverage

| Check                                                                              | Result                                                           |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| All eight destinations from all eight pages, including same-page selections        | 64 combinations passed                                           |
| Enter/Space activation and brand/home from every page                              | Passed                                                           |
| Exactly one current-page indicator                                                 | Passed                                                           |
| Background setup completion after choosing Timesheet, Diagnostics or Settings      | Passed                                                           |
| Edit query/board, leave Settings, return to the draft, then save the filtered view | Passed                                                           |
| Leave Settings during pending/failed metadata and an unresponsive context request  | Passed                                                           |
| All five section switches, Workspace cards and persistence after reload            | Passed                                                           |
| Every menu exit, home and Update app with an unfinished Timesheet cell             | Passed; input retained, no Jira writes                           |
| Canceling the cell edit and navigating afterward                                   | Passed                                                           |
| Update app from every page, then reopen Gantt with loaded data                     | Passed                                                           |
| Missing Jira context, support/back/home and app reload                             | Passed                                                           |
| Signed-out session, support/settings and successful reconnection                   | Passed                                                           |
| Cloud/Data Center menu and card availability                                       | Passed                                                           |
| Widths 320, 390, 560, 768, 1100, 1110, 1280, 1440 and 1920px                       | All menu controls reachable and unobscured                       |
| Actual Chrome zoom at 200%, set through `chrome.tabs.setZoom`                      | Passed; effective viewport verified at 640px for a 1280px window |
| Existing extension, Timesheet, Time Report and description-report browser flows    | Passed                                                           |

The new navigation checks use the built extension, real extension messaging and routed
Jira responses. They also assert that menu-only flows do not mutate Jira and report no
unexpected fixture requests or application errors.

## Settings follow-up

The first menu matrix did not edit the Settings query or change its selected board. The
user's follow-up exposed that gap. Before this correction, three added browser regressions
failed: editing Settings disabled Workspace, pending metadata blocked leaving Settings,
and a metadata error left the same navigation block in place.

All three now pass. The edit regression also returns to the unchanged draft, clears and
reselects the board, saves a query limited to POWER-2 and verifies that Gantt contains
POWER-2 with POWER-1 absent. A component regression verifies Workspace and home while the
Jira context request never resolves. These checks exercise actual Settings editing and
saving, in addition to opening the page and toggling optional sections.

The follow-up also transitions a fixture issue from Gantt after entering a different
unsaved Settings query. It verifies fresh status totals in Status, the original loaded
query in Reports, and the unchanged draft with no unrelated issue preview in Settings. The
refresh is scoped to its original workspace and tracked for cleanup on unmount.

## Validation

- `pnpm exec vitest run --maxWorkers=2`: **734 tests passed in 104 files**.
- `pnpm exec playwright test --workers=1 --reporter=line`: **19 browser tests passed**,
  including 15 navigation scenarios. A single browser worker avoids resource contention on
  the shared Mac.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and `git diff --check`: passed.
- Fixture-configured production build and regular production build: passed; extension
  entry points validated and ZIP packaged.

The browser build used the explicit test calendar configuration documented in
[testing.md](../../testing.md). The regular package was rebuilt afterward without that
override. Existing extension assertions were updated to check the current weekly empty
state and the Jira-profile time-zone selection; the Jira fixture explicitly supplies
Europe/Kyiv. ESLint now excludes local `.secrets` build files, and an existing
release-note paragraph received formatting-only line wrapping so the repository quality
checks pass. An existing weekly-row test now waits for asynchronous pinned-cell loading
before checking its seven hour inputs, rather than assuming that the pin button becoming
available also means the worklog read has finished.

All browser acceptance used headless Chrome for Testing 149.0.7827.55 with disposable
profiles and fixture Jira/GitHub data. Developer mode was configured only inside those
temporary profiles to exercise unpacked extension reloads. The user's native desktop and
Chrome profile were not controlled. Live Jira versions, account permissions and the
installed user's extension remain outside this fixture-based verification.

## Evidence

- [Browser results](browser-tests.log)
- [Unit/component results](unit-tests.log)
- [320px menu](menu-320.png)
- [200% browser zoom](menu-200-percent.png)
