# Authentication

Power View accesses Jira through the user's existing browser session. It never reads,
copies, logs, or persists cookie or authorization values.

The connection test requests only:

- Jira Cloud: `GET /rest/api/3/serverInfo` and `GET /rest/api/3/myself`;
- Jira Data Center or Server: `GET /rest/api/2/serverInfo` and `GET /rest/api/2/myself`.

After a successful connection, setup additionally reads `field` and `project` metadata.
Cloud project search uses `GET /rest/api/3/project/search`; compatible Data Center and
Server instances use `GET /rest/api/2/project`. No setup action writes to Jira.

Issue loading uses `GET /rest/api/3/search/jql` for Jira Cloud and
`GET /rest/api/2/search` for Data Center or Server. Requests contain JQL, an explicit
field list, and pagination values. Jira returns only issues visible to the current user;
Power View does not request issue descriptions in this milestone.

Edit mode first reads issue edit metadata, assignable users, and issue-link types. Its
write allowlist is limited to:

- `PUT /issue/{key}` with only configured start/due date fields;
- `PUT /issue/{key}/assignee` with only the deployment-specific user identifier;
- `POST /issueLink` with only a type and two issue keys;
- `DELETE /issueLink/{id}`.

Writes are injected into the detected Jira tab's main world so they use that same-origin
browser session. The service worker independently validates the active Jira base URL,
endpoint, query parameters, body shape, headers, tab origin, and exact-site host
permission before injection. Mutations are never retried automatically.

HTTP 401 becomes `AUTH_REQUIRED`; HTTP 403 becomes `PERMISSION_DENIED`. A 404 indicates an
unsupported detected deployment. Read-only rate limits and temporary 5xx failures are
retried at most twice, respecting a bounded `Retry-After` delay.

If an allowlisted read cannot reuse the session from the service worker, Power View falls
back to its Jira page bridge and then the page main world. Manual API-token storage is not
implemented.

## Timesheet (Cloud)

Timesheet has separate exact policies for read-only POST `/rest/api/3/search/jql`, minimal
issue reads (`fields=summary,project`), worklog details, and worklog CRUD. Mutations are
limited to `started`, integer `timeSpentSeconds`, optional plain-text ADF `comment`, and
`adjustEstimate=leave`. No author or visibility edits are accepted. The client rereads
current account and record version before editing/deleting. Read-only search POST follows
the read transport/retry path; worklog mutations use the single-attempt main-world path.
An uncertain result is not replayed automatically. Worklog 404 errors may mean a
removed/inaccessible record and are not automatically classified as an unsupported
deployment.

Worklog write timestamps use Jira's numeric timezone offset (`+0000`, `+0200`), including
milliseconds. ISO `Z` and colon offsets from the time editor are normalized without moving
the represented instant. HTTP 400 worklog errors may identify rejected start time,
duration or description using allowlisted field names; raw error bodies and echoed input
are not forwarded to diagnostics. A definite rejection is never retried automatically.

## Day Off: shared GitHub access without a server

Current requirements: [Day Off specification](tasks/day-off-shared-spec.md). The extension
identifies the current user through the existing Jira session (`/myself`). It writes Day
Off JSON directly through GitHub Contents API using one shared, repository-scoped
fine-grained token included in the installed build. Participants do not sign in to
Google/GitHub or supply individual tokens. No backend is required.

The token is extractable by recipients of the extension and grants access to the whole
selected data repository, not just a single file or the caller's Jira records. Client-side
ownership checks are not server-enforced Jira isolation. Do not claim otherwise. Keep the
source token out of version control and diagnostics. Replacement/revocation requires
distributing updated configuration/builds. GitHub host access and Jira host access are
distinct Chrome permissions; reuse existing grants.

GitHub persistence is implemented locally through `GitHubDayOffStore`; both Timesheet and
Time Report use its shared browser instance. The private data repository
`kotsaroleks/power-view-jira-data` and its scoped token are configured locally. Direct
GitHub API create/read/delete verification passed; live two-installation verification
remains outstanding. The Google Day Off store and OAuth build configuration have been
removed, together with Chrome identity permission. The external Google spreadsheet and its
data have not been changed. See [local setup](tasks/day-off-github-setup.md).
