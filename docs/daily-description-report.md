# Daily Jira description changes

Implemented 7 November 2026. The daily worker runs in GitHub Actions in a separate,
private automation repository. Power View and the user's Mac can be closed or powered off
after setup. The public product repository contains the source, tests and deployment
template; it does not run the daily job or hold delivery state.

## Report behavior

- The primary schedule is **21:00 Europe/Kyiv**, with a recovery check at **21:20**.
  GitHub supports the IANA timezone directly. Scheduled jobs can start late; the report
  still uses the intended period, rather than the runner's start time.
- A report dated 7 November covers **6 November 21:00 inclusive → 7 November 21:00
  exclusive**, in Kyiv. Civil calendar boundaries handle the 23-hour spring and 25-hour
  autumn days without gaps or overlapping periods.
- The scope is the selected saved Jira board and issues currently accessible through its
  filter. This does not reconstruct historical board membership or include issues already
  removed from that filter or hidden by Jira permissions.
- Only Description changes count. A change and subsequent revert still count. Editing
  status, estimates or comments alone does not produce a description report.
- Every changed issue appears once, with all distinct editors. The table includes its
  available ancestors in order and marks unchanged ancestors as context. Unchanged
  siblings are omitted. Missing authors are explicitly labeled unavailable.
- A complete empty period advances the checkpoint and sends **no Chat message**. Failed or
  partial Jira reads do not produce an empty-success report or advance the checkpoint.

## Reading Jira

`packages/domain/src/description-report.ts` defines the shared report and exact period
rules. `packages/jira-client/src/description-report.ts` reads the board and lightweight
issue metadata, requires complete per-issue changelog pagination, and loads ancestors
outside the candidate list. Jira identity is verified before and after collection.

Candidate JQL pads the lower updated boundary by a day to accommodate Jira user timezones,
then filters actual changelog instants to the exact Kyiv window. There is no upper updated
boundary: later edits to an issue must not hide its earlier description changes. The
collector requests `summary,parent,issuetype,updated`, rather than issue description
bodies. Changelog responses can contain old/new descriptions; those contents are discarded
during normalization and never enter this report, its outbox or logs.

This audit uses per-issue GET history with confirmed totals instead of the generic bulk
optimization, because bulk responses have no total per issue and can omit empty issues.
Repeated/missing pages, malformed times, identity changes and unavailable ancestry stop
the report. Limits are 5,000 candidates and 1,000 history pages per issue, requesting at
most 100 entries per page; exceeding a limit stops delivery. The native Swift
implementation uses the same report rules and TypeScript-generated golden fixtures.

## Delivery and recovery

`apps/report-bot` builds to `dist/report-bot/description-report.mjs`, a bundled Node 22
worker without runtime dependency installation. The job stores its checkpoint and exact
pending Chat payloads under `state/description-report.json` in the private repository.
GitHub content SHAs protect against stale state writes; workflow concurrency serializes
scheduled and manual runs.

Before sending, the complete outbox is committed. Every part has a stable UUID derived
from its scope, period, position and body. Retries reuse the exact saved body and Google
Chat custom `messageId` (`client-` plus the internal UUID). Incoming webhooks reject the
`requestId` query parameter. A repeated custom ID returns `409 ALREADY_EXISTS`, which
confirms the existing message alias instead of creating another message. Other conflicts
remain failures. Confirmed receipts are saved after each part. A lost response or failed
receipt write leaves that request pending; it is not regenerated from newly read Jira
data. Settings and webhook identity changes cannot silently reuse an old outbox.

Cards use two aligned columns for issue/hierarchy and authors. Large reports split into
bounded parts with repeated ancestor context, at most 20 rows and under 28 KB per message.
Changed tasks and authors are never silently dropped to fit. The sender spaces requests at
least 1.1 seconds apart and backs off on HTTP 429 and server errors. Permanent failures
leave the outbox for investigation. Each run catches up at most seven closed periods in
order; recovery or subsequent scheduled runs continue from the checkpoint.

## One-time protected setup

1. Build with `pnpm build:report-bot`.
2. Prepare a mode-600 `.secrets/description-report.local.json` containing a `repository`
   (`owner/private-repo`), `config` matching `config/description-report.example.json`, and
   optional prefilled `jiraEmail`. Use `setup-required` as the unverified account ID. All
   names in the example configuration are synthetic.
3. Create a private setup environment and install its encryption dependency:

   ```sh
   python3 -m venv .secrets/report-setup-env
   .secrets/report-setup-env/bin/python -m pip install PyNaCl==1.6.2
   .secrets/report-setup-env/bin/python scripts/configure-description-report.py
   .secrets/report-setup-env/bin/python scripts/complete-description-report.py
   ```

4. Open the printed loopback-only form manually. Setup automatically reuses the saved Jira
   login for the configured site, without opening an app or a system dialog. When that
   login is available, the form asks only for the incoming webhook from the selected
   Google Chat space; it never embeds the saved Jira email or token. If no saved login is
   available, enter the Jira email and API token as well. The form explains where to copy
   the webhook: space title → **Apps & integrations → Add webhooks**. Availability depends
   on that Workspace's permissions. The webhook is restricted to its exact configured
   space. No Google sign-in, browser session, separate Google Cloud project or Mac
   scheduler is required to configure delivery with an existing webhook.
5. **Verify and enable** checks Jira identity and a complete production report read, then
   uploads encrypted Actions secrets, writes the verified configuration, enables the
   schedule and dispatches the first due report. A valid empty report sends nothing. A
   dispatch acknowledgement confirms only that GitHub accepted the run; check its result
   for actual delivery. If dispatch fails after setup, the page reports that the schedule
   is enabled but the first run is unconfirmed.

The local form is only an initial configuration tool. It binds to `127.0.0.1`, expires
after 24 hours by default (`--lifetime` overrides this), uses an unguessable route and a
one-time form nonce, checks Host/Origin, rejects cross-site POSTs and disables caching and
external resources. Credentials remain in memory until they are uploaded; they are not
saved to the local JSON or Git files. The form can be closed and the Mac switched off
after activation.

Run the protected-form checks without network calls, saved credentials or a browser:

```sh
python3 -m unittest discover -s scripts -p 'test_complete_description_report.py'
```

These checks cover saved-login secrecy, webhook-only submission, resumed-session routing,
Host/Origin/nonce rejection, and the distinction between deployment and dispatch success.

The repository secrets are `JIRA_EMAIL`, `JIRA_API_TOKEN` and `GOOGLE_CHAT_WEBHOOK_URL`.
The runtime uses its repository's short-lived `github.token` to save state, rather than
the owner's GitHub credential. Jira and Chat secrets do not enter the public source,
packaged product or Actions output. Delivery is disabled by default with
`REPORT_ENABLED=false` until setup succeeds.

Manual workflow modes:

| Mode      | Behavior                                                                       |
| --------- | ------------------------------------------------------------------------------ |
| `check`   | Validate the deployed bundle and parse configuration; no Jira/Chat calls.      |
| `preview` | Read due Jira reports, log counts only, and make no Chat or checkpoint writes. |
| `deliver` | Deliver/reconcile due reports; requires `REPORT_ENABLED=true`.                 |

To pause delivery, set the repository's `REPORT_ENABLED` variable to `false`. A webhook
replacement or scope change needs explicit state reconciliation; do not delete an
unknown-outcome outbox to force a retry.

## Product preview and acceptance

**Reports → Description changes** provides an explicit dated preview in Chrome, Electron,
Safari's shared web UI, and the native Swift app (0.1.0 build 6). It does not send to
Chat. Account, board or date changes cancel an obsolete preview. Reading errors remain
distinct from a verified empty report.

The automated checks cover Kyiv boundaries and DST, edits/reverts/editors, hierarchy,
missing history and ancestors, unchanged settings, empty periods, chunking, throttling,
unknown delivery outcomes and failed checkpoint writes. A production browser scenario
reads two changelog pages, loads an out-of-candidate parent and renders both authors.
Swift golden/API tests and background-only production renders check native behavior
without activating a window. See
[verification evidence](qa/description-report-2026-11-07/README.md).

Deployment state and actual Chat delivery must be checked separately. Passing fixture
tests or the GitHub `check` mode does not establish live Jira access or a real Chat
receipt.

Primary API references:
[GitHub schedule syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule),
[Google Chat webhook setup and quotas](https://developers.google.com/workspace/chat/quickstart/webhooks),
[Chat create-message idempotency](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create).
