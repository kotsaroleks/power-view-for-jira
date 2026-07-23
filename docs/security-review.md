# Security review

## Trust boundaries

- Jira page content is untrusted and must pass Zod/domain validation.
- Extension-page requests are accepted only from this extension ID.
- Jira REST reads and writes must match the stored Jira origin and exact host permission.
- The main-world bridge accepts only packaged function arguments validated by the service
  worker; Jira cannot choose an arbitrary URL, method, header, or body.

## Data handling

Power View uses the existing browser session with `credentials: include`. It never reads
or stores cookies, authorization headers, API tokens, or passwords. Setup preferences and
sanitized context are stored locally. Issue descriptions are not requested; loaded issues
remain in memory. Diagnostics exclude issue content and session material.

## Request controls

Read endpoints, query keys, headers, concurrency, timeout, response size, and retries are
allowlisted. Mutations are limited to configured start/due fields, assignee, and issue
links. Every mutation requires confirmation and is never retried automatically. Jira
permissions and edit metadata remain authoritative.

## Extension controls

The manifest has no mandatory host permissions, external connection point, remote code,
cookies permission, or broad `tabs` permission. Custom hosts require a user-initiated
exact-site optional permission. CSP allows only self-hosted scripts and objects.

`scripts/validate-extension.mjs` enforces the expected MV3 entry points, permissions,
optional host scope, content-script scope, CSP, and absence of externally connectable or
web-accessible resources. CI reruns validation before packaging.

Any new Jira endpoint, mutation field, Chrome permission, externally reachable resource,
analytics destination, or persistent issue-data cache requires a fresh threat-model and
privacy review.
