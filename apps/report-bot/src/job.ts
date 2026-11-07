import { createHash } from "node:crypto";
import {
  descriptionChatMessages,
  latestDescriptionReportDate,
  shiftDescriptionDate,
  descriptionReportPeriod,
  type DescriptionChangeReport,
  type DescriptionChatMessage,
} from "@power-view/domain";

export interface OutboxPart {
  requestId: string;
  payload: DescriptionChatMessage;
  messageName?: string;
}
export interface DescriptionReportState {
  schemaVersion: 1;
  scope: string;
  processedThrough?: string;
  pending?: { date: string; parts: OutboxPart[] };
}
export interface ReportStateStore {
  load: () => Promise<DescriptionReportState | undefined>;
  save: (value: DescriptionReportState) => Promise<void>;
}
export interface DescriptionReportJob {
  scope: string;
  startDate: string;
  now: Date;
  dryRun: boolean;
  store: ReportStateStore;
  collect: (date: string) => Promise<DescriptionChangeReport>;
  send: (part: OutboxPart) => Promise<string>;
  preview?: (report: DescriptionChangeReport) => Promise<void>;
}
export function stableRequestId(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
/** Save the exact outbox BEFORE posting. A timeout or failed receipt write retries the
 * same Google requestId and body, never a freshly regenerated/duplicated message. */
export async function runDescriptionReportJob(
  job: DescriptionReportJob,
): Promise<{ processed: number; messages: number; dryRun: boolean }> {
  descriptionReportPeriod(job.startDate);
  const latest = latestDescriptionReportDate(job.now);
  const loaded = await job.store.load();
  if (loaded && (loaded.schemaVersion !== 1 || loaded.scope !== job.scope))
    throw new Error(
      "Report settings differ from the saved state. Delivery is stopped until explicitly reconfigured.",
    );
  const state: DescriptionReportState = loaded
    ? structuredClone(loaded)
    : { schemaVersion: 1, scope: job.scope };
  if (state.processedThrough) {
    descriptionReportPeriod(state.processedThrough);
    if (state.processedThrough > latest)
      throw new Error("The saved checkpoint is ahead of the last closed period.");
  }
  if (state.pending) {
    descriptionReportPeriod(state.pending.date);
    if (state.processedThrough && state.pending.date <= state.processedThrough)
      throw new Error("Inconsistent report delivery state.");
    if (!state.pending.parts.length)
      throw new Error("The saved report outbox is invalid.");
    const expectedDate = state.processedThrough
      ? shiftDescriptionDate(state.processedThrough, 1)
      : job.startDate;
    if (state.pending.date !== expectedDate)
      throw new Error("The pending report would skip an unprocessed period.");
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
        throw new Error("The saved report request was altered. Delivery was stopped.");
    }
  }
  let date =
    state.pending?.date ??
    (state.processedThrough
      ? shiftDescriptionDate(state.processedThrough, 1)
      : job.startDate);
  if (date < job.startDate)
    throw new Error("Saved delivery precedes the configured first report.");
  let processed = 0;
  let messages = 0;
  while (date <= latest && processed < 7) {
    if (job.dryRun) {
      const report = await job.collect(date);
      await job.preview?.(report);
      processed++;
      date = shiftDescriptionDate(date, 1);
      continue;
    }
    if (!state.pending) {
      const report = await job.collect(date);
      if (
        report.period.date !== date ||
        report.period.end !== descriptionReportPeriod(date).end
      )
        throw new Error("The report did not match its scheduled period.");
      const payloads = descriptionChatMessages(report);
      if (payloads.length) {
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
    }
    if (state.pending) {
      for (const part of state.pending.parts) {
        if (part.messageName) continue;
        part.messageName = await job.send(structuredClone(part));
        messages++;
        await job.store.save(structuredClone(state));
      }
    }
    delete state.pending;
    state.processedThrough = date;
    await job.store.save(structuredClone(state));
    processed++;
    date = shiftDescriptionDate(date, 1);
  }
  return { processed, messages, dryRun: job.dryRun };
}
