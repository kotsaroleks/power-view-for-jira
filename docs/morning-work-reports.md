# Morning Jira work reports

The private automation runs two reports in the configured Google Chat space:

- **Що змінилося в роботі** — all in-period status transitions grouped by the issue's
  current status, current owner separately from the actor, complete assignment history,
  description-edit authors and sprint membership changes. Ancestors provide context.
- **Зміни описів задач** — the existing description-only table and hierarchy. Complete
  empty reports retain the agreed `No changes for today` acknowledgement.

## Calendar

Target trigger: **08:01 Europe/Kyiv, Monday–Friday**. Recovery triggers: 08:11 and 08:31.
The report date is the date of the closing 08:00 boundary. Tuesday's report covers Monday
08:00 inclusive → Tuesday 08:00 exclusive. Monday covers Friday 08:00 → Monday 08:00,
including weekend changes. There is no public-holiday calendar. The current period only
becomes eligible at 08:01. All closed weekday periods catch up separately, at most seven
per invocation. Late-night or next-day starts never change the event boundaries.

GitHub cron is a best-effort trigger, not a delivery-time guarantee. Actual earlier runs
were created several hours late; changing the cron expression does not remove that
platform limitation. No paid external scheduler is created by this change. The workflow
remains manually dispatchable with `check`, `preview` and `deliver` modes.

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

Two-column cards preserve hierarchy, headings and every event when splitting messages.
Each part has at most 20 displayed rows and stays below 28 KB. An individually oversized
row fails preflight rather than silently losing history. A generation error never turns
into an empty-success acknowledgement.

## Delivery and migration

`morningReports` in the protected configuration selects calendar `kyiv-workdays-08-v1` and
its first weekday report date. A description cutover may additionally set
`descriptionCoveredThrough` to the exact end of the last confirmed legacy report.

The migration must first confirm that the legacy outbox is empty. It preserves the legacy
checkpoint and starts new, separately scoped outboxes at `state/work-activity-report.json`
and `state/morning-description-report.json`. The first morning description period starts
at the old delivered end, rather than replaying its overlapping part. Subsequent periods
use the ordinary 08:00 boundary. For the deployed cutover, a confirmed 9 November 21:00
legacy end joins 10 November 08:00, then ordinary daily morning periods continue.

Both streams save exact payloads before posting, derive stable per-stream/period/message
IDs, confirm Chat receipts, then advance their own checkpoint. Unknown outcomes retry the
same custom `messageId`; only HTTP409 `ALREADY_EXISTS` confirms an existing message. The
old state file is never reset or repurposed. The existing encrypted Jira and Chat
credentials are reused; no browser or Mac session is needed.

## Validation

Focused checks cover weekday/DST periods, delayed execution, current-status grouping,
every transition and assignment loop, strict raw-history pagination, sprint set diffs,
description redaction, message chunking, separate state paths, unknown outcomes and
receipt/checkpoint failures. The first deployment also requires a private preview, an
actual Chat delivery receipt and a repeat run proving that delivery is not duplicated.
