# Shared Day Off — legacy Google OAuth implementation

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

Day Off is a calendar-date flag, not a Jira worklog. A checkbox under each Timesheet
column date marks/unmarks the signed-in user's date. Time Report reads the same flags for
the authorized Atlassian Team roster. Existing worklogs remain intact and appear as Day
Off conflicts; missing mappings/calendars remain unknown, withholding capacity.

## Historical storage and authorization

The user approved using the existing `Test DB` spreadsheet, ID
`1Fs_hojSIot18h8uWeRQwGneKow71d_9KHF428Du53H4`, and explicitly approved storing their Jira
account ID/name, Google email, 2026–2027 calendar checkboxes and protected ranges. The
original `Sheet1` was left untouched. All new dates were initialized false; no real Day
Off was marked during setup or testing.

- `PowerView Users` (sheet ID 2026110200), A:F: `jiraBaseUrl`, `jiraAccountId`,
  `displayName`, `googleEmail`, `year`, `dayOffSheet`. Admin-protected, 1001 rows.
- `DayOff 2026 Oleksandr` (2026110201) and `DayOff 2027 Oleksandr` (2026110202): complete
  annual calendars in A, native boolean checkbox input in B.
- Dates and headers are protected separately from B2:B366. The Day Off input editor is
  `google-user@example.com`. The initial setup administrator was
  `setup-admin@example.com`; Google required a temporary two-account handover, then Gmail
  was removed from both input ranges under the work session. File owners retain their
  inherent Google rights. Other employees require separate administrator mappings and
  input protections.
- No service account, server, Apps Script or browser-local authoritative fallback. Reads
  and writes use each employee's own Google OAuth grant.

The client validates enforced protections, rejects editable exceptions, and verifies
Google's email verification against the admin mapping before writing. Each write is one
existing B cell, `RAW` boolean, never append. Unknown outcomes are not retried; changes
stay locked until the user explicitly confirms checking the Sheet. Tokens remain only in
the extension page/Chrome identity memory and are not logged or stored in localStorage,
Jira transports or diagnostics.

## Google OAuth setup

An isolated Google Cloud project `PowerView for Jira` was created:
`lucid-forklift-513516-f7`, project number `299016109076`. OAuth branding uses the same
app name, support/contact `setup-admin@example.com`, external testing mode. The user
explicitly approved accepting Google's API Services User Data Policy and saving this
configuration. The user separately approved creating the Chrome Extension client, enabling
Sheets API and adding their Gmail as the sole test user. Created public client ID:
`299016109076-9v0di5ns6cgtle3h7biipt9kbu6k7pg6.apps.googleusercontent.com`.

Google Sheets API was enabled. The OAuth test user was corrected to
`google-user@example.com` and personal Gmail removed from the audience. The declared
scopes are exactly Sheets read/write, verified-email identity and OpenID. The app remains
in testing mode; it was not published.

The created Chrome Extension OAuth client is bound to stable extension ID
`fdamaaiccihofpoadiibmgkbioegclcb`. Enable Google Sheets API and add approved test users.
The public client ID is in `apps/extension/src/google-oauth-config.json`;
`POWERVIEW_GOOGLE_CLIENT_ID` can override it at build time. The extension build emits the
corresponding manifest oauth2 settings. Scopes are spreadsheets, openid and email. There
is no client secret in the extension. The Connect Google action requests only the required
Google API host permissions.

A build without the client ID reports that setup is missing. It never pretends the shared
connection is live. Standalone web/Electron/Safari Google auth is not implemented; the UI
reports the unavailable connection instead of substituting local storage.

## Write and completeness limits

Marking known worklogged dates is disabled; unmarking preserves worklogs. Once shared Day
Off is established, time writes recheck the target date before Jira mutation. Known flags
survive refresh/failure; incomplete refreshed data cannot bypass checks. These client
checks cannot atomically coordinate direct Google edits and Jira writes. The existing Jira
search is index-limited, so absence of discovered worklogs is not a proof that no external
worklog exists. No strict cross-system atomicity is claimed.

119 relevant tests and two production Chrome E2Es passed. Browser tests use isolated
Google/Jira fixtures, not live OAuth tokens or shared data. The client is created; live
checkbox verification still requires installing/reloading the OAuth-enabled extension in
the matching Google profile and granting Google access.

## Final checkpoint

Live Google Cloud UI confirmed the client exists, Sheets API status Enabled, one test user
(the confirmed work account after correction) and exactly three declared scopes. Native
Sheets UI was inspected for the protected mapping and both annual calendar tabs; checkbox
validation and readable headers were verified. Setup initialized only false flags. The
packaged extension contains the real public OAuth client ID. Its live Google access
consent remains for the user in the matching Chrome profile.

Final affected-suite validation: 119 tests across 18 files, two production Chrome E2E
scenarios, root/web/extension TypeScript checks, targeted ESLint and extension entry-point
validation passed. See `docs/qa/day-off-2026-11-02/` for fixture screenshots.

## Confirmed Google ↔ Jira identity and team synchronization

The user clarified and confirmed two identities for the same person:

- Google Drive authentication: `google-user@example.com`.
- Jira: `jira-user@example.com`, verified through Jira current-user API, account ID
  `REDACTED_JIRA_ACCOUNT_ID`.

The live PowerView Users rows for 2026/2027 now map that stable Jira ID to the work Google
email. Both input ranges were verified in the work Google session as “Only you can edit.”
The personal Gmail remains the original Cloud project/setup administrator; it is not the
application's OAuth test user or Day Off input editor. Project ownership was not migrated.

The complete Aria Team membership was read from Jira, following the final empty alumni
page: 14 current members. It was synchronized into `PowerView Team Members`, sheet ID
2026110203, with columns jiraBaseUrl/teamId/teamName/jiraAccountId/jiraDisplayName/
jiraEmail/googleEmail/mappingStatus/membershipStatus/syncedAt. That sheet is protected for
the work Google account. No Jira users or memberships were changed.

Only the user's confirmed cross-domain mapping is approved; the other 13 Google emails
remain empty/unmapped. Corporate Google addresses are not guessed from names or Jira email
local parts. Name collisions are marked review. All storage keys use Jira account IDs, so
later name/email changes cannot move another person's Day Off history.

The explicit Sync Jira team button in Time Report reloads the selected team's Jira roster
and writes it through a verified Google-admin boundary. It never scans worklogs or
automatically syncs during report loading. Existing Google mappings are preserved, removed
members become inactive, and past records are not deleted. Concurrent manual
roster/protection changes fail the preflight rather than being silently overwritten.

Validation after team sync:15 Google Day Off store tests (including work identity accepted
and personal identity rejected),8 roster sync tests,7 sync UI tests and15 Jira Teams
client tests passed. Independent model review found no blockers. Production Chrome
roster-sync E2E passed with fixture-only Google/Jira calls; screenshots in QA folder.
Updated extension archive repackaged; live OAuth consent remains an end-user action.
