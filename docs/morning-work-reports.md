# Daily Jira work reports

The private automation runs two reports in the configured Google Chat space:

- **Що змінилося в роботі** — all in-period status transitions grouped by the issue's
  current status, current owner separately from the actor, complete assignment history,
  description-edit authors and sprint membership changes. Ancestors provide context.
- **Зміни описів задач** — the existing description-only table and hierarchy. Complete
  empty reports retain the agreed `No changes for today` acknowledgement.

## Calendar

Cloudflare dispatches the private workflow daily at **00:05 Europe/Kyiv**, with GitHub
recovery at 00:15 and 00:35. Each report covers the previous calendar day, including
weekends, from 00:00 inclusive to the following 00:00 exclusive. The report date names the
closing boundary. The period becomes eligible at 00:05. Missed days catch up separately,
at most seven per invocation. Late starts keep the same event boundaries.

GitHub can start scheduled workflows late. The workflow also supports manual `check`,
`preview` and `deliver` runs. Preview builds both messages for the latest eligible day.

## Cloudflare timer

The [Cloudflare Worker](../automation/description-report/cloudflare-timer) checks the
scheduled UTC timestamp against 00:05 in `Europe/Kyiv`. This selects one of the two UTC
slots every day, including across clock changes. GitHub Actions still runs the report
workflow and controls delivery through `REPORT_ENABLED`.

From the Worker directory, run `node --test worker.test.mjs` and
`npx wrangler@4.161.0 deploy --dry-run` to validate the timer and bundle.

1. Create a fine-grained GitHub token for `kotsaroleks/power-view-report-automation` with
   repository **Actions: Read and write**. The Jira and Chat credentials stay in GitHub.
   [GitHub workflow dispatch permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
2. On a new Cloudflare account, open Workers & Pages once to initialize Workers before
   attaching a schedule. Deploy a temporary copy of `wrangler.json` with `REPORT_MODE` set
   to `check` and an empty `triggers.crons` list. In the Worker settings, save the GitHub
   token as the encrypted secret `GITHUB_ACTIONS_TOKEN`. Then run
   `npx wrangler@4.161.0 deploy --var REPORT_MODE:check --triggers '<test cron>'` from the
   Worker directory for a single upcoming UTC slot, with at least 15 minutes for the
   schedule to propagate. Verify the run ID in Workers Logs and the successful `check` run
   in GitHub.
   [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
3. After the Cloudflare `check` succeeds, deploy the checked-in `wrangler.json` for daily
   delivery and verify the live secret and schedule. Replace the GitHub 00:05 entry with
   the `Cloudflare dispatches the primary report` comment used by the setup script. Keep
   GitHub recovery at 00:15 and 00:35. Existing delivery checkpoints cover overlap. Rotate
   the Worker secret before its GitHub token expires.

## Exact history and presentation

The worker reads all candidate pages and all per-issue history pages, checking totals,
offsets, repeated identities, changing totals and invalid timestamps. Candidate JQL pads
the lower boundary by a day for Jira-user timezone differences and has no upper updated
boundary. Actual events are filtered to the fixed half-open period. Account identity is
verified before and after collection. Ancestors outside the candidate list are fetched;
missing or cyclic ancestry fails the read. Jira remains read-only.

Status groups use **current status at generation time**, as requested, even if a late run
observes a status later than the reporting window. All in-period transitions remain in
chronological order, including To Do → In Progress → To Do → In Progress. Cards label the
fixed period and the current-state read time separately. Sprint changes diff the complete
raw ID sets and resolve sprint names; display-name digits never become sprint IDs.
Description bodies never enter the normalized report, saved outbox or logs.

The cards open with counts and use separate sections and dividers for the detail rows.
Icons distinguish statuses, assignments, edits and sprint changes. Two-column rows
preserve hierarchy, timestamps and actors when the report spans several messages. Each
part has at most 20 displayed rows and stays below 28 KB. An oversized row stops the
report before delivery.

## Delivery and migration

`morningReports` selects `kyiv-calendar-days-00-v1` and the date of the first closing
midnight. The previous weekday calendar remains readable for its existing checkpoints.
Confirm both earlier outboxes are empty before switching calendars. Daily delivery uses
`state/work-activity-midnight-report.json` and `state/midnight-description-report.json`.

The first daily report closes at 00:00 on 12 November 2026. It covers all of 11 November,
including the first eight hours that were covered by that morning's report.

Both streams save exact payloads before posting, derive stable per-stream/period/message
IDs, confirm Chat receipts, then advance their own checkpoint. Unknown outcomes retry the
same custom `messageId`; only HTTP409 `ALREADY_EXISTS` confirms an existing message. The
old state file is never reset or repurposed. The existing encrypted Jira and Chat
credentials are reused; no browser or Mac session is needed.

## Validation

Focused checks cover calendar days, weekends, DST, delayed execution, current-status
grouping, every transition and assignment loop, strict raw-history pagination, sprint set
diffs, description redaction, message chunking, separate state paths, unknown outcomes and
receipt/checkpoint failures. Scheduled deliveries record Chat receipts and advance each
checkpoint independently.
