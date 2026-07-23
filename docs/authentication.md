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
