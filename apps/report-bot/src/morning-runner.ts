import { createHash } from "node:crypto";
import type { WorkActivitySource } from "@power-view/jira-client";
import {
  buildWorkActivityReport,
  buildDescriptionChangeReport,
  descriptionChatMessages,
  workActivityChatMessages,
  workReportPeriod,
  latestWorkReportDate,
  type DescriptionReportPeriod,
  type DescriptionChangeReport,
  type WorkActivityReport,
} from "@power-view/domain";
import { type OutboxPart, type ReportStateStore } from "./job";
import { runMorningReportJob } from "./morning-job";
import type { ReportBotConfig } from "./runtime";

export type MorningReportStatePath =
  "state/work-activity-report.json" | "state/morning-description-report.json";
export type MorningReportPreview =
  | { kind: "work"; report: WorkActivityReport }
  | { kind: "descriptions"; report: DescriptionChangeReport };
export interface MorningReportsOptions {
  config: ReportBotConfig;
  now: Date;
  dryRun: boolean;
  previewOnly: boolean;
  collect: (date: string, period: DescriptionReportPeriod) => Promise<WorkActivitySource>;
  storeFor: (path: MorningReportStatePath) => ReportStateStore;
  send: (part: OutboxPart) => Promise<string>;
  preview?: (value: MorningReportPreview) => Promise<void>;
}

/** Shared collection, separate durable outboxes. A failed stream never prevents the
 * other stream from reconciling its saved delivery before the run reports failure. */
export async function runMorningReports(options: MorningReportsOptions) {
  const { config, now, previewOnly } = options;
  const calendar = config.morningReports;
  if (!calendar) throw new Error("The morning reporting calendar is not configured.");
  const dryRun = options.dryRun || previewOnly;
  const startDate = previewOnly ? latestWorkReportDate(now) : calendar.firstReportDate;
  const firstPeriod = workReportPeriod(calendar.firstReportDate);
  if (
    calendar.descriptionCoveredThrough &&
    (Date.parse(calendar.descriptionCoveredThrough) < Date.parse(firstPeriod.start) ||
      Date.parse(calendar.descriptionCoveredThrough) >= Date.parse(firstPeriod.end))
  )
    throw new Error(
      "The legacy description checkpoint does not join the first morning period.",
    );
  const sourceCache = new Map<string, Promise<WorkActivitySource>>();
  function source(date: string) {
    let promise = sourceCache.get(date);
    if (!promise) {
      promise = Promise.resolve().then(() =>
        options.collect(date, workReportPeriod(date)),
      );
      sourceCache.set(date, promise);
    }
    return promise;
  }
  const scopeFor = (kind: string) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          config.jiraBaseUrl,
          config.boardId,
          config.expectedJiraAccountId,
          config.chatSpace,
          config.chatWebhookFingerprint,
          calendar,
          kind,
        ]),
      )
      .digest("hex");
  const storeFor = (path: MorningReportStatePath): ReportStateStore =>
    previewOnly
      ? {
          load: () => Promise.resolve(undefined),
          save: () => Promise.reject(new Error("Preview cannot write state.")),
        }
      : options.storeFor(path);
  const errors: unknown[] = [];
  let work: Awaited<ReturnType<typeof runMorningReportJob>> | undefined;
  let descriptions: Awaited<ReturnType<typeof runMorningReportJob>> | undefined;
  try {
    work = await runMorningReportJob({
      scope: scopeFor("work-activity-v1"),
      startDate,
      now,
      dryRun,
      store: storeFor("state/work-activity-report.json"),
      collect: async (date) => buildWorkActivityReport(await source(date)),
      format: workActivityChatMessages,
      send: options.send,
      preview: (report) =>
        options.preview?.({ kind: "work", report }) ?? Promise.resolve(),
    });
  } catch (error) {
    errors.push(error);
  }
  const descriptionPeriod = (date: string): DescriptionReportPeriod => {
    const period = workReportPeriod(date);
    return date === calendar.firstReportDate && calendar.descriptionCoveredThrough
      ? { ...period, start: calendar.descriptionCoveredThrough }
      : period;
  };
  try {
    descriptions = await runMorningReportJob({
      scope: scopeFor("description-morning-v1"),
      startDate,
      now,
      dryRun,
      store: storeFor("state/morning-description-report.json"),
      period: descriptionPeriod,
      collect: async (date, period) =>
        buildDescriptionChangeReport({ ...(await source(date)), period }, period),
      format: descriptionChatMessages,
      send: options.send,
      preview: (report) =>
        options.preview?.({ kind: "descriptions", report }) ?? Promise.resolve(),
    });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length)
    throw new AggregateError(errors, "Morning report streams did not both complete.");
  return { calendar: calendar.calendar, work: work!, descriptions: descriptions! };
}
