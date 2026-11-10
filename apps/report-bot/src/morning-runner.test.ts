import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  workReportPeriod,
  type ReportChangeEvent,
  type ReportingIssueSnapshot,
} from "@power-view/domain";
import type { WorkActivitySource } from "@power-view/jira-client";
import type { DescriptionReportState, ReportStateStore } from "./job";
import {
  runMorningReports,
  type MorningReportsOptions,
  type MorningReportPreview,
  type MorningReportStatePath,
} from "./morning-runner";
import type { ReportBotConfig } from "./runtime";

const config: ReportBotConfig = {
  schemaVersion: 1,
  jiraBaseUrl: "https://fixture.atlassian.net",
  boardId: "7",
  expectedJiraAccountId: "viewer",
  chatSpace: "fixture-space",
  firstReportDate: "2026-11-07",
  chatWebhookFingerprint: "a".repeat(64),
  morningReports: {
    calendar: "kyiv-workdays-08-v1",
    firstReportDate: "2026-11-10",
    descriptionCoveredThrough: "2026-11-09T19:00:00.000Z",
  },
};
const issues: ReportingIssueSnapshot[] = [
  {
    id: "1",
    key: "TEST-1",
    summary: "Feature context",
    browseUrl: "https://fixture.atlassian.net/browse/TEST-1",
    issueType: { id: "epic", name: "Epic" },
    status: { id: "todo", name: "To Do" },
    sprintIds: [],
  },
  {
    id: "2",
    key: "TEST-2",
    summary: "Task with current QA owner",
    browseUrl: "https://fixture.atlassian.net/browse/TEST-2",
    issueType: { id: "task", name: "Task" },
    status: { id: "testing", name: "In Testing" },
    assignee: { id: "qa", displayName: "QA owner" },
    parentId: "1",
    parentKey: "TEST-1",
    sprintIds: [],
  },
];
function event(
  id: string,
  type: ReportChangeEvent["type"],
  occurredAt: string,
): ReportChangeEvent {
  return {
    id,
    type,
    occurredAt,
    issueId: "2",
    issueKey: "TEST-2",
    actor: { id: "dev", displayName: "Developer" },
  };
}
const events: ReportChangeEvent[] = [
  {
    ...event("before-legacy-end", "description-changed", "2026-11-09T10:00:00Z"),
    from: "PRIVATE OLD",
    to: "PRIVATE NEW",
  },
  {
    ...event("legacy-join", "description-changed", "2026-11-09T19:00:00Z"),
    from: "PRIVATE OLD",
    to: "PRIVATE NEW",
  },
  {
    ...event("status", "status-changed", "2026-11-10T05:00:00Z"),
    from: "In Progress",
    to: "In Testing",
  },
  {
    ...event("handoff", "assignee-changed", "2026-11-10T05:01:00Z"),
    from: "Developer",
    to: "QA owner",
  },
  event("next-period", "description-changed", "2026-11-10T06:00:00Z"),
];

function setup() {
  const state = new Map<string, DescriptionReportState>();
  const legacy = {
    schemaVersion: 1 as const,
    scope: "legacy-scope",
    processedThrough: "2026-11-09",
  };
  state.set("state/description-report.json", legacy);
  const writes: Array<{ path: string; value: DescriptionReportState }> = [];
  const stores = new Map<MorningReportStatePath, ReportStateStore>();
  const previews: MorningReportPreview[] = [];
  const options: MorningReportsOptions = {
    config: structuredClone(config),
    now: new Date("2026-11-10T06:01:00Z"),
    dryRun: false,
    previewOnly: false,
    collect: vi.fn<MorningReportsOptions["collect"]>(
      (_date, period): Promise<WorkActivitySource> =>
        Promise.resolve({
          jiraBaseUrl: config.jiraBaseUrl,
          boardId: config.boardId,
          boardName: "TEST DATA",
          period: structuredClone(period),
          generatedAt: options.now.toISOString(),
          issues: structuredClone(issues),
          events: structuredClone(events),
        }),
    ),
    storeFor: vi.fn<MorningReportsOptions["storeFor"]>((path) => {
      let store = stores.get(path);
      if (!store) {
        store = {
          load: vi.fn<ReportStateStore["load"]>(() =>
            Promise.resolve(structuredClone(state.get(path))),
          ),
          save: vi.fn<ReportStateStore["save"]>((value) => {
            writes.push({ path, value: structuredClone(value) });
            state.set(path, structuredClone(value));
            return Promise.resolve();
          }),
        };
        stores.set(path, store);
      }
      return store;
    }),
    send: vi.fn<MorningReportsOptions["send"]>((part) =>
      Promise.resolve("spaces/fixture-space/messages/client-" + part.requestId),
    ),
    preview: vi.fn<NonNullable<MorningReportsOptions["preview"]>>((value) => {
      previews.push(value);
      return Promise.resolve();
    }),
  };
  return { options, state, writes, stores, previews, legacy };
}

describe("Morning CLI report orchestration", () => {
  it("collects one full source for both real formatters, isolates state paths and preserves legacy state", async () => {
    const { options, state, writes, legacy } = setup();
    const result = await runMorningReports(options);
    expect(result).toEqual({
      calendar: "kyiv-workdays-08-v1",
      work: { processed: 1, messages: 1, dryRun: false },
      descriptions: { processed: 1, messages: 1, dryRun: false },
    });
    expect(options.collect).toHaveBeenCalledExactlyOnceWith(
      "2026-11-10",
      workReportPeriod("2026-11-10"),
    );
    const parts = vi.mocked(options.send).mock.calls.map(([part]) => part);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.payload.cardsV2?.[0]?.card.header.title).toContain(
      "Що змінилося в роботі",
    );
    expect(JSON.stringify(parts[0]!.payload)).toContain("In Testing · 1 задача");
    expect(JSON.stringify(parts[0]!.payload)).toContain("Developer");
    expect(JSON.stringify(parts[0]!.payload)).toContain("QA owner");
    expect(parts[1]!.payload.text).toContain("Зміни описів");
    expect(JSON.stringify(parts[1]!.payload)).toContain(
      "2026-11-09 21:00 — 2026-11-10 08:00",
    );
    expect(JSON.stringify(parts[1]!.payload)).toContain("Правок: 1");
    expect(parts[0]!.requestId).not.toBe(parts[1]!.requestId);
    expect(new Set(writes.map((write) => write.path))).toEqual(
      new Set([
        "state/work-activity-report.json",
        "state/morning-description-report.json",
      ]),
    );
    expect(state.get("state/work-activity-report.json")?.processedThrough).toBe(
      "2026-11-10",
    );
    expect(state.get("state/morning-description-report.json")?.processedThrough).toBe(
      "2026-11-10",
    );
    expect(state.get("state/description-report.json")).toEqual(legacy);
    expect(JSON.stringify(parts)).not.toContain("PRIVATE OLD");
    expect(JSON.stringify(parts)).not.toContain("PRIVATE NEW");
    const scope = (kind: string) =>
      createHash("sha256")
        .update(
          JSON.stringify([
            config.jiraBaseUrl,
            config.boardId,
            config.expectedJiraAccountId,
            config.chatSpace,
            config.chatWebhookFingerprint,
            config.morningReports,
            kind,
          ]),
        )
        .digest("hex");
    expect(state.get("state/work-activity-report.json")?.scope).toBe(
      scope("work-activity-v1"),
    );
    expect(state.get("state/morning-description-report.json")?.scope).toBe(
      scope("description-morning-v1"),
    );
    expect(await runMorningReports(options)).toMatchObject({
      work: { processed: 0, messages: 0 },
      descriptions: { processed: 0, messages: 0 },
    });
    expect(options.collect).toHaveBeenCalledOnce();
    expect(options.send).toHaveBeenCalledTimes(2);
  });

  it("retains a failed work outbox while delivering descriptions, then resumes without recollection or duplicates", async () => {
    const { options, state } = setup();
    let fail = true;
    options.send = vi.fn<MorningReportsOptions["send"]>((part) =>
      fail && part.payload.cardsV2?.[0]?.cardId.startsWith("work-activity-")
        ? Promise.reject(new Error("Work response lost"))
        : Promise.resolve("spaces/fixture-space/messages/client-" + part.requestId),
    );
    await expect(runMorningReports(options)).rejects.toThrow(/did not both complete/);
    const workPending = structuredClone(
      state.get("state/work-activity-report.json")!.pending!,
    );
    expect(workPending.parts[0]!.messageName).toBeUndefined();
    expect(state.get("state/morning-description-report.json")?.processedThrough).toBe(
      "2026-11-10",
    );
    expect(state.get("state/morning-description-report.json")?.pending).toBeUndefined();
    expect(options.collect).toHaveBeenCalledOnce();
    fail = false;
    vi.mocked(options.collect).mockRejectedValue(new Error("No recollection allowed"));
    expect(await runMorningReports(options)).toMatchObject({
      work: { processed: 1, messages: 1 },
      descriptions: { processed: 0, messages: 0 },
    });
    const parts = vi.mocked(options.send).mock.calls.map(([part]) => part);
    expect(parts[0]).toEqual(parts[2]);
    expect(parts[0]).toEqual(workPending.parts[0]);
    expect(options.collect).toHaveBeenCalledOnce();
    expect(state.get("state/work-activity-report.json")?.pending).toBeUndefined();
  });

  it("reconciles a saved description delivery even when the next work period cannot be read", async () => {
    const { options, state } = setup();
    options.send = vi.fn<MorningReportsOptions["send"]>((part) =>
      part.payload.cardsV2?.[0]?.cardId.startsWith("descriptions-")
        ? Promise.reject(new Error("Description response lost"))
        : Promise.resolve("spaces/fixture-space/messages/client-" + part.requestId),
    );
    await expect(runMorningReports(options)).rejects.toThrow(/did not both complete/);
    const descriptionPending = structuredClone(
      state.get("state/morning-description-report.json")!.pending!,
    );
    expect(state.get("state/work-activity-report.json")?.processedThrough).toBe(
      "2026-11-10",
    );
    options.now = new Date("2026-11-11T06:01:00Z");
    options.collect = vi.fn<MorningReportsOptions["collect"]>(() =>
      Promise.reject(new Error("Jira temporarily unavailable")),
    );
    options.send = vi.fn<MorningReportsOptions["send"]>((part) =>
      Promise.resolve("spaces/fixture-space/messages/client-" + part.requestId),
    );
    await expect(runMorningReports(options)).rejects.toThrow(/did not both complete/);
    expect(options.collect).toHaveBeenCalledExactlyOnceWith(
      "2026-11-11",
      workReportPeriod("2026-11-11"),
    );
    expect(options.send).toHaveBeenCalledExactlyOnceWith(descriptionPending.parts[0]);
    expect(state.get("state/morning-description-report.json")?.processedThrough).toBe(
      "2026-11-10",
    );
    expect(state.get("state/morning-description-report.json")?.pending).toBeUndefined();
  });

  it("dry-runs both reports with shared reads and bridge clipping but no delivery or state writes", async () => {
    const { options, state, writes, previews } = setup();
    options.dryRun = true;
    expect(await runMorningReports(options)).toMatchObject({
      work: { processed: 1, messages: 0, dryRun: true },
      descriptions: { processed: 1, messages: 0, dryRun: true },
    });
    expect(options.collect).toHaveBeenCalledOnce();
    expect(options.send).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(state.size).toBe(1);
    expect(previews).toHaveLength(2);
    const work = previews.find((value) => value.kind === "work")!;
    const descriptions = previews.find((value) => value.kind === "descriptions")!;
    expect(work.report.period).toEqual(workReportPeriod("2026-11-10"));
    expect(work.report.descriptionChangedIssueCount).toBe(1);
    expect(
      work.report.rows
        .find((row) => row.issueId === "2")
        ?.changes.filter((change) => change.type === "description-changed"),
    ).toHaveLength(2);
    expect(descriptions.report.period.start).toBe(
      config.morningReports!.descriptionCoveredThrough,
    );
    expect(descriptions.report.changeCount).toBe(1);
    expect(JSON.stringify(previews)).not.toContain("PRIVATE OLD");
  });

  it("preview-only selects the latest closed weekday and never accesses either private state store", async () => {
    const { options, previews, writes } = setup();
    options.previewOnly = true;
    options.now = new Date("2026-11-11T06:01:00Z");
    expect(await runMorningReports(options)).toMatchObject({
      work: { processed: 1, messages: 0, dryRun: true },
      descriptions: { processed: 1, messages: 0, dryRun: true },
    });
    expect(options.storeFor).not.toHaveBeenCalled();
    expect(options.collect).toHaveBeenCalledExactlyOnceWith(
      "2026-11-11",
      workReportPeriod("2026-11-11"),
    );
    expect(options.send).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(previews.map((preview) => preview.report.period)).toEqual([
      workReportPeriod("2026-11-11"),
      workReportPeriod("2026-11-11"),
    ]);
  });

  it("rejects a legacy cutover that leaves an uncollected gap before touching Jira or state", async () => {
    const { options } = setup();
    options.config.morningReports!.firstReportDate = "2026-11-11";
    await expect(runMorningReports(options)).rejects.toThrow(/does not join/);
    expect(options.collect).not.toHaveBeenCalled();
    expect(options.storeFor).not.toHaveBeenCalled();
    expect(options.send).not.toHaveBeenCalled();
  });
});
