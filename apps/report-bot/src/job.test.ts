import { describe, expect, it, vi } from "vitest";
import {
  descriptionFixture,
  descriptionIssue,
  descriptionEvent,
} from "../../../packages/domain/src/description-report.test-fixtures";
import { descriptionReportPeriod } from "@power-view/domain";
import {
  runDescriptionReportJob,
  type DescriptionReportJob,
  type DescriptionReportState,
} from "./job";
function setup() {
  let state: DescriptionReportState | undefined;
  const store = {
    load: vi.fn(() => Promise.resolve(state ? structuredClone(state) : undefined)),
    save: vi.fn((next: DescriptionReportState) => {
      state = structuredClone(next);
      return Promise.resolve();
    }),
  };
  const job: DescriptionReportJob = {
    scope: "scope",
    startDate: "2026-11-06",
    now: new Date("2026-11-06T19:05Z"),
    dryRun: false,
    store,
    collect: vi.fn(() => Promise.resolve(descriptionFixture())),
    send: vi.fn<DescriptionReportJob["send"]>((part) =>
      Promise.resolve("spaces/test/messages/" + part.requestId),
    ),
    preview: vi.fn(() => Promise.resolve()),
  };
  return {
    job,
    store,
    getState: () => state,
    setState: (next: DescriptionReportState) => {
      state = next;
    },
  };
}
describe("Scheduled description report delivery", () => {
  it("sends one plaintext message for a fully read empty period through the durable outbox", async () => {
    const { job, store, getState } = setup();
    job.collect = vi.fn(() => Promise.resolve(descriptionFixture(undefined, [])));
    expect(await runDescriptionReportJob(job)).toMatchObject({
      processed: 1,
      messages: 1,
    });
    expect(job.send).toHaveBeenCalledOnce();
    const part = vi.mocked(job.send).mock.calls[0]![0];
    expect(part.payload).toEqual({ text: "No changes for today" });
    expect(store.save.mock.calls[0]?.[0].pending?.parts).toEqual([part]);
    expect(getState()?.processedThrough).toBe("2026-11-06");
    expect(store.save).toHaveBeenCalledTimes(3);
    expect(await runDescriptionReportJob(job)).toMatchObject({
      processed: 0,
      messages: 0,
    });
    expect(job.send).toHaveBeenCalledOnce();
    expect(job.collect).toHaveBeenCalledOnce();
  });
  it("does not recollect or duplicate a completed daily report", async () => {
    const { job } = setup();
    await runDescriptionReportJob(job);
    await runDescriptionReportJob(job);
    expect(job.collect).toHaveBeenCalledTimes(1);
    expect(job.send).toHaveBeenCalledTimes(1);
  });
  it("keeps dry-run preview completely free of state and Chat writes", async () => {
    const { job, store } = setup();
    job.dryRun = true;
    await runDescriptionReportJob(job);
    expect(job.preview).toHaveBeenCalledOnce();
    expect(store.save).not.toHaveBeenCalled();
    expect(job.send).not.toHaveBeenCalled();
  });
  it.each(["changed", "empty"])(
    "retains the exact pending %s request after an unknown Chat result",
    async (kind) => {
      const { job, getState } = setup();
      if (kind === "empty")
        job.collect = vi.fn(() => Promise.resolve(descriptionFixture(undefined, [])));
      const send = vi
        .fn<DescriptionReportJob["send"]>()
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockResolvedValue("spaces/test/messages/one");
      job.send = send;
      await expect(runDescriptionReportJob(job)).rejects.toThrow("Timeout");
      expect(getState()?.pending).toBeDefined();
      await runDescriptionReportJob(job);
      expect(send.mock.calls[0]?.[0]).toEqual(send.mock.calls[1]?.[0]);
      expect(job.collect).toHaveBeenCalledOnce();
      expect(getState()?.processedThrough).toBe("2026-11-06");
    },
  );
  it.each(["changed", "empty"])(
    "reuses the same %s delivery ID after posting succeeded but its receipt could not be saved",
    async (kind) => {
      const { job, store } = setup();
      if (kind === "empty")
        job.collect = vi.fn(() => Promise.resolve(descriptionFixture(undefined, [])));
      const original = store.save.getMockImplementation()!;
      let calls = 0;
      store.save.mockImplementation((next) => {
        calls++;
        return calls === 2
          ? Promise.reject(new Error("State unavailable"))
          : original(next);
      });
      await expect(runDescriptionReportJob(job)).rejects.toThrow("State unavailable");
      await runDescriptionReportJob(job);
      const callsToChat = vi.mocked(job.send).mock.calls;
      expect(callsToChat[0]?.[0]).toEqual(callsToChat[1]?.[0]);
      expect(job.collect).toHaveBeenCalledOnce();
    },
  );
  it("resumes a long report at the undelivered part", async () => {
    const { job } = setup();
    const issues = [
      descriptionIssue("1"),
      ...Array.from({ length: 45 }, (_, i) => descriptionIssue(String(i + 2), "1")),
    ];
    job.collect = vi.fn(() =>
      Promise.resolve(
        descriptionFixture(
          issues,
          issues.slice(1).map((issue, i) => descriptionEvent(String(i), issue.id)),
        ),
      ),
    );
    const send = vi
      .fn<DescriptionReportJob["send"]>()
      .mockResolvedValueOnce("spaces/test/messages/1")
      .mockRejectedValueOnce(new Error("Timeout"))
      .mockImplementation((part) =>
        Promise.resolve("spaces/test/messages/" + part.requestId),
      );
    job.send = send;
    await expect(runDescriptionReportJob(job)).rejects.toThrow();
    await runDescriptionReportJob(job);
    expect(send.mock.calls[0]?.[0].requestId).not.toBe(send.mock.calls[2]?.[0].requestId);
    expect(send.mock.calls[1]?.[0]).toEqual(send.mock.calls[2]?.[0]);
    expect(job.collect).toHaveBeenCalledOnce();
  });
  it("stops before sending if collection fails, leaving the period available for recovery", async () => {
    const { job, store } = setup();
    job.collect = vi.fn(() => Promise.reject(new Error("Partial Jira history")));
    await expect(runDescriptionReportJob(job)).rejects.toThrow();
    expect(job.send).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });
  it("catches up missed periods in order without gaps", async () => {
    const { job, getState } = setup();
    job.startDate = "2026-11-04";
    job.collect = vi.fn<DescriptionReportJob["collect"]>((date) =>
      Promise.resolve({
        ...descriptionFixture(undefined, []),
        period: descriptionReportPeriod(date),
      }),
    );
    expect((await runDescriptionReportJob(job)).processed).toBe(3);
    expect(vi.mocked(job.collect).mock.calls.map((args) => args[0])).toEqual([
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
    expect(getState()?.processedThrough).toBe("2026-11-06");
    const parts = vi.mocked(job.send).mock.calls.map(([part]) => part);
    expect(parts).toHaveLength(3);
    expect(new Set(parts.map((part) => part.requestId)).size).toBe(3);
    expect(parts.every((part) => part.payload.text === "No changes for today")).toBe(
      true,
    );
  });
  it("does not reuse delivery state after scope/recipient changes", async () => {
    const { job, setState } = setup();
    setState({ schemaVersion: 1, scope: "different", processedThrough: "2026-11-05" });
    await expect(runDescriptionReportJob(job)).rejects.toThrow(/settings differ/);
    expect(job.collect).not.toHaveBeenCalled();
    expect(job.send).not.toHaveBeenCalled();
  });
  it("rejects altered pending messages before retrying", async () => {
    const { job, getState, setState } = setup();
    job.send = vi.fn(() => Promise.reject(new Error("Timeout")));
    await expect(runDescriptionReportJob(job)).rejects.toThrow();
    const saved = getState()!;
    saved.pending!.parts[0]!.payload.text = "Changed payload";
    setState(saved);
    await expect(runDescriptionReportJob(job)).rejects.toThrow(/altered/);
    expect(job.send).toHaveBeenCalledOnce();
  });
});
