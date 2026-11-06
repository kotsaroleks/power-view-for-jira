# Time Report: implementation checkpoint, 2026-11-01

> Public copy: personal addresses, live account identifiers and private spreadsheet URLs
> are redacted. Local originals are kept outside Git.

> Superseded by the [current Day Off specification](tasks/day-off-shared-spec.md): direct
> GitHub JSON storage using one shared repository-scoped token embedded in the extension,
> with no backend or per-participant Google/GitHub sign-in. Jira `/myself` identifies the
> record owner. The token is extractable and does not enforce per-Jira-user isolation. The
> sections below preserve legacy Google implementation/setup history; they are not current
> requirements. Google Day Off code, OAuth configuration and Google fixtures were later
> removed at the user's request. GitHub persistence is implemented locally; live storage
> configuration and two-installation verification remain outstanding. The external Sheet
> and its data have not been changed.

Source: agreed Time Report specification in chat `REDACTED_ID`, including AC-01–AC-13.
This checkpoint is not an acceptance claim.

## Repository audit

- Web Reports enter through `ReportsService`, with existing Board Health and
  `ReportsView`. Existing team selection derives from loaded issue assignees, which omits
  employees without board issues.
- Web Timesheet uses CloudTimesheetClient and a separate React feature. Its JQL discovery
  is explicitly limited by Jira worklog search indexing. Per-issue worklogs are already
  paginated. Electron shares the React app; native Swift has separate Reports and no
  Timesheet found in Sources.
- Settings and report history use local storage/IndexedDB. No authoritative shared Day Off
  service with server-side authorization was found. Native release/estimation team
  membership is not an approved Time Report roster.
- The working tree already contained substantial unrelated edits. Existing report content
  and Timesheet worklog writes remain intact; Reports now wraps existing content in tabs.

## Implemented independently

1. `packages/domain/src/time-report.ts`: pure calculations, issue breakdown, seven-day
   logged totals, 40h weekday capacity, unique weekday Day Off adjustments, ratio-of-sums
   team utilization, zero-capacity N/A, missing/overtime, preserved conflict hours. Inputs
   do not mutate.
2. `apps/web/src/app/time-report/time-report-loader.ts`: current default discovers issues
   using selected worklog authors and a widened date envelope around the selected week. It
   has no board/project/assignee filter. Exact worklog authors and local dates are checked
   after paginated reads. Author groups respect both the 50-user and 10,000-character
   request limits; repeated candidate issues are read once. There is no automatic
   site-wide fallback. Coverage is explicitly `jql-limited`: Jira's
   latest-1,000-worklogs-per-issue search index and permissions can omit history. Full
   historic completeness is not claimed.
3. `TimeReportView.tsx`: standalone Team/Individual presentation, employee filter, week
   navigation, issue links, adjusted totals, soft red Day Off conflicts. Integrated
   through `TimeReportPanel` into Reports tabs in the shared React App. The My teams
   dropdown loads automatically for the signed-in Jira user. `CloudTeamsClient` discovers
   the site organization and retrieves membership-filtered teams with pagination, then
   reads the selected team roster and names. No team links or organization/team IDs are
   requested from the user. No roster is embedded in source code. Partial reads withhold
   the table. While Google identity mapping/Day Off storage are deferred, the panel
   explicitly withholds expected hours, utilization, conflicts and deficit styling
   (`capacityKnown=false`), rather than treating unknown Day Off as zero.

Separate agents implemented calculations and loader; another agent independently audited
and reviewed them and the presentation. Independent review found and prompted fixes for
incorrect per-issue deficit coloring and obsolete employee filters after roster changes.

## Acceptance status

| AC                                    | Status                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 Reports tabs                       | Integrated, tab state retention regression-tested                                                                                                                |
| 02 Team View                          | Integrated with Atlassian Teams membership and employee filter; hours only pending Day Off                                                                       |
| 03 Individual View                    | Integrated with issue links                                                                                                                                      |
| 04 All Jira worklogs                  | Not fully accepted: narrowed team/week JQL is search-index-limited; warning shown. Full historic coverage still requires separate indexing/reconciliation design |
| 05 Day Off subtracts 8h               | Unit-tested calculation; storage integration pending                                                                                                             |
| 06 Set/cancel Day Off                 | Pending authorized storage and date policy                                                                                                                       |
| 07 Block Day Off if worklogs exist    | Pending complete-data/authorized write boundary                                                                                                                  |
| 08 Block PowerView logging on Day Off | Pending integration at write boundary                                                                                                                            |
| 09 Soft red conflict                  | Component-tested; production refresh integration pending                                                                                                         |
| 10 Preserve external logs             | New reader/calculation/presentation are read-only; end-to-end integration pending                                                                                |
| 11 Team ratio of sums                 | Unit-tested                                                                                                                                                      |
| 12 Independent of current board       | Reader tested without board/project/Setup filters                                                                                                                |
| 13 Existing behavior retained         | Targeted Reports, Timesheet, API regression tests passed; full end-to-end validation pending                                                                     |

## Decisions requested, not assumed

- Storage confirmed by user: Google Sheets at
  `https://docs.google.com/spreadsheets/d/EXAMPLE_SPREADSHEET_ID/edit`. User explicitly
  rejected an additional service and selected native Protected Ranges. Use Google-enforced
  range editors (`warningOnly: false`), with each employee's Day Off input range separated
  from protected identity/date metadata. Writes must run under that employee's Google
  authorization, not a shared privileged account. Google-to-Jira account mapping must be
  administrator-controlled. This can enforce who edits which cells; it does not enforce
  cross-system Jira-worklog business checks. Those checks remain in PowerView and external
  conflicts must be displayed without altering data. PM editing remains an open
  requirement, not implicitly granted by this choice. Initial metadata read returned HTTP
  403; access was subsequently granted and verified below. Protected Ranges and
  application schema remain unverified. The existing Apps Script lease experiment stays
  suspended; no additional backend or Apps Script service is authorized.
- Authoritative roster confirmed by user: Atlassian Teams, `Aria Team`. Live read found
  one matching team, ID `REDACTED_ID`, on cloud `REDACTED_ID`
  (`stryker-emergencycare.atlassian.net`). All 14 members were returned with
  `hasNextPage: false`; individual Jira profile reads confirmed their account IDs, active
  status and corporate email addresses. Membership must come from Teams, including people
  with no board issues; do not infer it from assignees or freeze this observed membership
  in source code. Corporate Jira email addresses are not automatically verified Google
  identities; Google-account mapping remains separate (the supplied
  `setup-admin@example.com` differs from the user's Jira corporate address).
- User explicitly deferred Google-account mapping. No additional service,
  account-permission configuration, or Day Off write path is introduced in this phase.
- Past/future Day Off dates, PM editing rights, holiday handling, export.
- Target platform: shared Chrome/web/Electron, native macOS, or both.

Access update: after the user shared the file with `setup-admin@example.com`, connector
metadata and bounded range reads succeeded. Verified title: `Test DB`; tab `Sheet1`
(sheetId 0), 1000 rows × 26 columns, spreadsheet time zone `Etc/GMT`. `Sheet1!A1:L12`
contains no values. The entire workbook has not been declared empty, and Protected Ranges
have not yet been inspected. No spreadsheet writes were performed.

No Day Off persistence, migration, server, role policy, holiday calendar, export or hidden
roster inference has been introduced.

Integration checks after review: Teams cursor/account-ID bounds aligned with transport
policy; loader test mock lint issues corrected. Relevant Teams/loader rerun: 16/16 passed,
lint passed for those files. Web and extension production builds passed. No Google-account
mapping or permissions were changed.

## Validation

The exhaustive-scan checks below describe earlier checkpoints, superseded by the narrowed
search update at the end of this document.

Screenshot regression: live Jira read reproduced HTTP 400 for the original
`ORDER BY id ASC` query ("Unbounded JQL queries are not allowed here"). A one-result read
of `created <= now() ORDER BY id ASC` succeeded on the same site with a continuation
token. The loader now uses that accepted query, retaining historical issues and
cross-project coverage. A regression fixture rejects ORDER BY-only queries. This verifies
search acceptance, not a full live worklog scan. Reports tabs, form, loading/error
messages and tables now use existing PowerView tokens and responsive styles. Independent
re-review: 21 tests passed, web TypeScript and lint passed; web build passed with the
existing bundle-size warning.

Production browser regression (`e2e/time-report-production.spec.ts`) passed using
synthetic Jira/Teams responses through the built App and request schema/policy. It covers
two search pages, old/admin issues outside the board, two authors, time-zone exclusions,
7h team total, unavailable Day Off metrics, issue links, no writes, and actual styled
controls at desktop and 390px mobile width. Desktop form/team/individual and mobile
screenshots were generated and visually inspected. This fixture validates the production
UI flow; it does not claim a live full worklog scan. Root TypeScript and targeted ESLint
passed. The current environment requires system Chrome via
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for Playwright.

Initial combined targeted run: 51 tests passed across nine files (new
calculation/loader/view and existing Reports, Timesheet, TimesheetClient). Root TypeScript
check passed. Next integration run: 83 tests across eleven files passed (App/DesktopApp,
Reports tabs, panel/view/loader, Teams client, extension policy/schema and request
handlers); root TypeScript check passed. Added unknown-capacity regression: all four view
tests passed. Web production build passed with a bundle-size warning. Independent
integration QA passed 47 relevant tests with no blockers, and requested aligned
cursor/account-ID bounds in client and transport. Live reads retrieved team
membership/profiles only; no live worklogs were read and no Jira/Sheets writes were made.

## My teams dropdown update

Replaced the team-link and advanced-ID inputs with automatic My teams discovery, explicit
selection for multiple teams, single-team preselection, and refresh/retry/empty states.
Site/org discovery and membership-filtered `teamSearchV2` use two exact read-only GraphQL
operations shared by the client and extension policy. The required siteId is obtained from
the current site's tenant context. Arbitrary GraphQL, introspection and mutations remain
blocked by the extension. No roster is hardcoded. Queries and variable types were verified
against Atlassian's actual public GraphQL schema. Live private team discovery has not yet
been validated in the installed extension.

Independent review found a passive-effect cancellation race after team selection. Report
invalidation now runs synchronously before paint, with unmount cleanup separate from
selection invalidation. A regression covers immediate initial Load and immediate
team-switch Load. Combined 62-test suite passed twice after the fix; web/root TypeScript
and production web/extension builds passed.

Final independent review passed 59 relevant tests. Updated production browser regression
passed with automatic tenant/My teams responses, two teams in the dropdown, explicit
choice before loading, and no link/ID inputs. Report totals, Individual View, read-only
request policy, desktop/mobile layout and screenshots were rechecked on the built App with
synthetic data.

## Narrowed team/week discovery

User reported 18,500 issues in the all-site scan and requested rational JQL narrowing.
Default discovery now uses
`worklogAuthor in (...) AND worklogDate >= ... AND worklogDate < ... ORDER BY id ASC`,
restricted to the selected roster and the week with a two-day boundary buffer for time
zones. The exact selected seven calendar days and authors are still filtered locally. No
created-date restriction, board restriction, project restriction, assignee restriction or
site-wide retry is used. Candidate paging and bounded worklog reads remain cancellable.
The UI help and visible coverage notice disclose search-index limits; totals are observed
records, not proof of all historical worklogs.

A one-author, one-result read on the actual Jira accepted the new query and returned no
issues for that selection. This validates syntax/access, not completeness or the full
team's totals. Independent loader/Panel review passed 22 tests. Initial regression run
passed 37 tests plus web typecheck/build; a subsequent long-ID batching regression passed
separately. Earlier screenshots showing the team-link form are from the previous UI;
current source and build use My teams.

Final narrowed-search verification: loader 13/13 tests passed, production browser flow 1/1
passed (8 seconds, synthetic records), root typecheck and targeted lint passed. The
browser fixture checks author/date restrictions, cross-project hours, exact local-date
exclusions and continued My teams selection.

## Weekly / Monthly

Added Weekly / Monthly period buttons, with week-containing date or calendar-month picker.
Monthly loads every calendar day in the selected month (28–31); period mode participates
in request identity, so switching modes clears the old result and aborts an in-flight
read. Both Team and Individual View use the chosen period, with previous/next week or
previous/next month navigation. Targeted JQL uses the period boundaries and the same
time-zone buffer; no broad scan fallback was added.

Updated for build 0.3.2 on 2026-11-03: the user approved eight hours for each
Monday–Friday in the selected calendar month, excluding unique weekday Day Off dates.
Weekend Day Off dates do not reduce capacity. Team utilization divides summed logged hours
by summed capacity; zero capacity retains N/A utilization. Missing shared Day Off data
withholds capacity in both weekly and monthly views. The earlier undefined monthly
capacity rule is superseded by this approval.

Independent verification: domain 14, loader 18, View 5, Panel 12 tests all passed (49
total); web/root TypeScript, targeted ESLint and web build passed. Tests cover leap
February, 28/29/30/31-day months, exact local boundaries, month/year navigation, weekly
regression and late responses after mode changes.

Production browser scenario passed (20.7 seconds, synthetic data): weekly total 7h,
October monthly total 7h30m including an additional month-only record, monthly Individual
total 3h30m, 31 day columns, correct monthly JQL bounds, and mode selection at
desktop/mobile widths. Monthly and mobile screenshots were visually inspected.

## Shared Day Off update — 2026-11-02

The user now explicitly requested header checkboxes in Timesheet and the same Day Off in
Time Report, and selected completing the shared Google Sheet connection. They approved
storing their Jira/Google mapping, calendars and protected ranges; original Sheet1 remains
untouched. Protected 2026/2027 calendars were created with every flag false. The prior
deferred-storage status above is historical.

Implemented a Google Sheets store, verified-email mapping, Chrome OAuth client
configuration, date-header checkboxes, day-column styling, shared report markers,
known-conflict handling and write guards. The user separately approved the Google User
Data Policy and creating a Chrome Extension OAuth client in an isolated project. See
`day-off-google-sheets.md` for schema, Google project/client and build details.

119 relevant tests and two production Chrome E2Es passed using isolated Google/Jira
fixtures. Native browser testing caught a default fetch binding bug; independent audit
caught editable protection exceptions and a refresh bypass. All were fixed, with
regression tests. No actual Day Off or Jira worklog was changed during live setup. Real
Google consent and signed-in extension verification are separate from fixture QA.

Only the current approved account has an annual mapping; other members remain unknown
until an administrator provisions them. Reports continue to withhold team capacity when
any required calendar is incomplete. Google owner/setup-admin rights and the lack of an
atomic transaction across Sheets and Jira are documented limitations.
