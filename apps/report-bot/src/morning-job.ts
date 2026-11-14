import type { DescriptionChatMessage, DescriptionReportPeriod } from "@power-view/domain";
import {
  latestWorkReportDate,
  nextWorkReportDate,
  workReportPeriod,
  type WorkReportCalendar,
} from "@power-view/domain";
import {
  stableRequestId,
  type ReportStateStore,
  type OutboxPart,
  type DescriptionReportState,
} from "./job";

export interface MorningReportJob<T extends { period: DescriptionReportPeriod }> {
  scope: string;
  startDate: string;
  calendar?: WorkReportCalendar;
  now: Date;
  dryRun: boolean;
  store: ReportStateStore;
  period?: (date: string) => DescriptionReportPeriod;
  collect: (date: string, period: DescriptionReportPeriod) => Promise<T>;
  format: (report: T) => DescriptionChatMessage[];
  send: (part: OutboxPart) => Promise<string>;
  preview?: (report: T) => Promise<void>;
}

/** Exact saved bodies and client IDs survive late starts, lost receipts and retries. */
export async function runMorningReportJob<T extends { period: DescriptionReportPeriod }>(
  job: MorningReportJob<T>,
) {
  const periodFor = job.period ?? ((date) => workReportPeriod(date, job.calendar));
  workReportPeriod(job.startDate, job.calendar);
  const latest = latestWorkReportDate(job.now, job.calendar);
  const loaded = await job.store.load();
  if (loaded && (loaded.schemaVersion !== 1 || loaded.scope !== job.scope))
    throw new Error("Morning report settings differ from the saved delivery state.");
  const state: DescriptionReportState = loaded
    ? structuredClone(loaded)
    : { schemaVersion: 1, scope: job.scope };
  if (state.processedThrough) {
    workReportPeriod(state.processedThrough, job.calendar);
    if (state.processedThrough < job.startDate || state.processedThrough > latest)
      throw new Error("The morning checkpoint is outside its configured period range.");
  }
  const expectedDate = state.processedThrough
    ? nextWorkReportDate(state.processedThrough, job.calendar)
    : job.startDate;
  if (state.pending) {
    if (state.pending.date !== expectedDate || !state.pending.parts.length)
      throw new Error("The morning outbox would skip or repeat a period.");
    for (const [index, part] of state.pending.parts.entries()) {
      if (
        part.requestId !==
        stableRequestId(
          job.scope +
            ":" +
            state.pending.date +
            ":" +
            index +
            ":" +
            JSON.stringify(part.payload),
        )
      )
        throw new Error("The saved morning outbox was altered.");
    }
  }
  let date = state.pending?.date ?? expectedDate;
  let processed = 0;
  let messages = 0;
  while (date <= latest && processed < 7) {
    const period = periodFor(date);
    if (Date.parse(period.end) > job.now.getTime())
      throw new Error("The morning reporting period is still open.");
    if (!state.pending || job.dryRun) {
      const report = await job.collect(date, period);
      if (
        report.period.date !== date ||
        report.period.start !== period.start ||
        report.period.end !== period.end
      )
        throw new Error("The report does not match its fixed morning period.");
      const payloads = job.format(report);
      if (!payloads.length)
        throw new Error(
          "A complete report must have an acknowledgement or report payload.",
        );
      if (job.dryRun) {
        await job.preview?.(report);
        processed++;
        date = nextWorkReportDate(date, job.calendar);
        continue;
      }
      state.pending = {
        date,
        parts: payloads.map((payload, index) => ({
          payload,
          requestId: stableRequestId(
            job.scope + ":" + date + ":" + index + ":" + JSON.stringify(payload),
          ),
        })),
      };
      await job.store.save(structuredClone(state));
    }
    for (const part of state.pending.parts) {
      if (part.messageName) continue;
      part.messageName = await job.send(structuredClone(part));
      messages++;
      await job.store.save(structuredClone(state));
    }
    delete state.pending;
    state.processedThrough = date;
    await job.store.save(structuredClone(state));
    processed++;
    date = nextWorkReportDate(date, job.calendar);
  }
  return { processed, messages, dryRun: job.dryRun };
}
