import { describe, expect, it, vi } from "vitest";
import { workReportPeriod, type DescriptionReportPeriod } from "@power-view/domain";
import {
  type DescriptionReportState,
  type ReportStateStore,
  stableRequestId,
} from "./job";
import { runMorningReportJob, type MorningReportJob } from "./morning-job";
import { GitHubReportStateStore } from "./runtime";

interface Report {
  period: DescriptionReportPeriod;
}

function setup() {
  let state: DescriptionReportState | undefined;
  const store = {
    load: vi.fn<ReportStateStore["load"]>(() =>
      Promise.resolve(state ? structuredClone(state) : undefined),
    ),
    save: vi.fn<ReportStateStore["save"]>((next) => {
      state = structuredClone(next);
      return Promise.resolve();
    }),
  };
  const job: MorningReportJob<Report> = {
    scope: "work-activity-v1:fixture",
    startDate: "2026-11-09",
    now: new Date("2026-11-09T08:01:00+02:00"),
    dryRun: false,
    store,
    collect: vi.fn<MorningReportJob<Report>["collect"]>((_date, period) =>
      Promise.resolve({ period: structuredClone(period) }),
    ),
    format: vi.fn(() => [{ text: "No changes for today" }]),
    send: vi.fn<MorningReportJob<Report>["send"]>((part) =>
      Promise.resolve("spaces/fixture/messages/client-" + part.requestId),
    ),
    preview: vi.fn(() => Promise.resolve()),
  };
  return {
    job,
    store,
    getState: () => structuredClone(state),
    setState: (next: DescriptionReportState) => {
      state = structuredClone(next);
    },
  };
}

describe("Morning report delivery", () => {
  it.each(["08:00:00", "08:00:59.999"])(
    "does not read or deliver the new period at %s Kyiv",
    async (time) => {
      const { job, store } = setup();
      job.now = new Date("2026-11-09T" + time + "+02:00");
      expect(await runMorningReportJob(job)).toEqual({
        processed: 0,
        messages: 0,
        dryRun: false,
      });
      expect(job.collect).not.toHaveBeenCalled();
      expect(job.format).not.toHaveBeenCalled();
      expect(job.send).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
    },
  );

  it("delivers at 08:01, persists the exact outbox first, and does not repeat the period", async () => {
    const { job, store, getState } = setup();
    expect(await runMorningReportJob(job)).toEqual({
      processed: 1,
      messages: 1,
      dryRun: false,
    });
    expect(job.collect).toHaveBeenCalledWith("2026-11-09", {
      date: "2026-11-09",
      start: "2026-11-06T06:00:00.000Z",
      end: "2026-11-09T06:00:00.000Z",
      timeZone: "Europe/Kyiv",
    });
    const part = vi.mocked(job.send).mock.calls[0]![0];
    expect(store.save.mock.calls[0]?.[0].pending).toEqual({
      date: "2026-11-09",
      parts: [part],
    });
    expect(store.save.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(job.send).mock.invocationCallOrder[0]!,
    );
    expect(getState()).toEqual({
      schemaVersion: 1,
      scope: job.scope,
      processedThrough: "2026-11-09",
    });
    expect(await runMorningReportJob(job)).toMatchObject({ processed: 0, messages: 0 });
    expect(job.collect).toHaveBeenCalledOnce();
    expect(job.send).toHaveBeenCalledOnce();
  });

  it("resumes after Friday with one Monday window covering the entire weekend", async () => {
    const { job, setState } = setup();
    job.startDate = "2026-11-06";
    setState({ schemaVersion: 1, scope: job.scope, processedThrough: "2026-11-06" });
    expect(await runMorningReportJob(job)).toMatchObject({ processed: 1, messages: 1 });
    expect(vi.mocked(job.collect).mock.calls.map(([date]) => date)).toEqual([
      "2026-11-09",
    ]);
    const period = vi.mocked(job.collect).mock.calls[0]![1];
    expect((Date.parse(period.end) - Date.parse(period.start)) / 3_600_000).toBe(72);
  });

  it.each(["01:00:00", "04:00:00", "08:00:59"])(
    "keeps the previous report date when delayed until Tuesday %s Kyiv",
    async (time) => {
      const { job, getState } = setup();
      job.now = new Date("2026-11-10T" + time + "+02:00");
      expect(await runMorningReportJob(job)).toMatchObject({ processed: 1 });
      expect(vi.mocked(job.collect).mock.calls.map(([date]) => date)).toEqual([
        "2026-11-09",
      ]);
      expect(getState()?.processedThrough).toBe("2026-11-09");
    },
  );

  it("catches up working dates without gaps and limits each run to seven periods", async () => {
    const { job, getState } = setup();
    job.startDate = "2026-10-29";
    job.now = new Date("2026-11-11T08:01:00+02:00");
    expect(await runMorningReportJob(job)).toMatchObject({ processed: 7 });
    expect(getState()?.processedThrough).toBe("2026-11-06");
    expect(await runMorningReportJob(job)).toMatchObject({ processed: 3 });
    const calls = vi.mocked(job.collect).mock.calls;
    expect(calls.map(([date]) => date)).toEqual([
      "2026-10-29",
      "2026-10-30",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
    ]);
    for (let index = 1; index < calls.length; index++)
      expect(calls[index]![1].start).toBe(calls[index - 1]![1].end);
    expect(
      new Set(vi.mocked(job.send).mock.calls.map(([part]) => part.requestId)).size,
    ).toBe(10);
    expect(getState()?.processedThrough).toBe("2026-11-11");
  });

  it("keeps stream checkpoints and message IDs independent for the same date and payload", async () => {
    const work = setup();
    const description = setup();
    description.job.scope = "description-morning-v1:fixture";
    await runMorningReportJob(work.job);
    expect(description.getState()).toBeUndefined();
    await runMorningReportJob(description.job);
    expect(work.job.collect).toHaveBeenCalledOnce();
    expect(description.job.collect).toHaveBeenCalledOnce();
    const workPart = vi.mocked(work.job.send).mock.calls[0]![0];
    const descriptionPart = vi.mocked(description.job.send).mock.calls[0]![0];
    expect(workPart.payload).toEqual(descriptionPart.payload);
    expect(workPart.requestId).not.toBe(descriptionPart.requestId);
    description.setState(work.getState()!);
    await expect(runMorningReportJob(description.job)).rejects.toThrow(/settings differ/);
    expect(description.job.send).toHaveBeenCalledOnce();
  });

  it.each(["date", "start", "end"] as const)(
    "refuses a collected report with the wrong period %s before formatting or saving",
    async (field) => {
      const { job, store } = setup();
      job.collect = vi.fn<MorningReportJob<Report>["collect"]>((_date, period) =>
        Promise.resolve({
          period: {
            ...period,
            [field]: field === "date" ? "2026-11-10" : "2026-11-09T06:00:01.000Z",
          },
        }),
      );
      await expect(runMorningReportJob(job)).rejects.toThrow(/fixed morning period/);
      expect(job.format).not.toHaveBeenCalled();
      expect(job.send).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
    },
  );

  it("retains the exact persisted body and ID after an unknown outcome without recollecting", async () => {
    const { job, getState } = setup();
    job.send = vi
      .fn<MorningReportJob<Report>["send"]>()
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValue("spaces/fixture/messages/receipt");
    await expect(runMorningReportJob(job)).rejects.toThrow("Response lost");
    const pending = getState()!.pending!;
    expect(pending.date).toBe("2026-11-09");
    job.now = new Date("2026-11-10T04:00:00+02:00");
    vi.mocked(job.collect).mockRejectedValue(new Error("Must not recollect"));
    vi.mocked(job.format).mockImplementation(() => {
      throw new Error("Must not reformat");
    });
    expect(await runMorningReportJob(job)).toMatchObject({ processed: 1, messages: 1 });
    expect(vi.mocked(job.send).mock.calls.map(([part]) => part)).toEqual([
      pending.parts[0],
      pending.parts[0],
    ]);
    expect(job.collect).toHaveBeenCalledOnce();
    expect(job.format).toHaveBeenCalledOnce();
    expect(getState()?.processedThrough).toBe("2026-11-09");
  });

  it("retries the same ID when a successful send receipt could not be saved", async () => {
    const { job, store, getState } = setup();
    const save = store.save.getMockImplementation()!;
    let saves = 0;
    store.save.mockImplementation(async (next) => {
      if (++saves === 2) throw new Error("Receipt checkpoint unavailable");
      await save(next);
    });
    await expect(runMorningReportJob(job)).rejects.toThrow(
      "Receipt checkpoint unavailable",
    );
    expect(getState()?.pending?.parts[0]?.messageName).toBeUndefined();
    await runMorningReportJob(job);
    const attempts = vi.mocked(job.send).mock.calls;
    expect(attempts).toHaveLength(2);
    expect(attempts[0]![0]).toEqual(attempts[1]![0]);
    expect(job.collect).toHaveBeenCalledOnce();
    expect(job.format).toHaveBeenCalledOnce();
  });

  it("does not resend a confirmed receipt when only the final period checkpoint failed", async () => {
    const { job, store, getState } = setup();
    const save = store.save.getMockImplementation()!;
    let saves = 0;
    store.save.mockImplementation(async (next) => {
      if (++saves === 3) throw new Error("Final checkpoint unavailable");
      await save(next);
    });
    await expect(runMorningReportJob(job)).rejects.toThrow(
      "Final checkpoint unavailable",
    );
    expect(getState()?.pending?.parts[0]?.messageName).toContain(
      "spaces/fixture/messages/",
    );
    expect(await runMorningReportJob(job)).toMatchObject({ processed: 1, messages: 0 });
    expect(job.send).toHaveBeenCalledOnce();
    expect(job.collect).toHaveBeenCalledOnce();
    expect(getState()?.processedThrough).toBe("2026-11-09");
  });

  it("resumes a multipart outbox at its first unconfirmed part", async () => {
    const { job } = setup();
    job.format = vi.fn(() => [1, 2, 3].map((part) => ({ text: "Part " + part })));
    job.send = vi
      .fn<MorningReportJob<Report>["send"]>()
      .mockResolvedValueOnce("spaces/fixture/messages/first")
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockImplementation((part) =>
        Promise.resolve("spaces/fixture/messages/client-" + part.requestId),
      );
    await expect(runMorningReportJob(job)).rejects.toThrow("Response lost");
    await runMorningReportJob(job);
    const attempts = vi.mocked(job.send).mock.calls.map(([part]) => part);
    expect(attempts).toHaveLength(4);
    expect(attempts[1]).toEqual(attempts[2]);
    expect(attempts[0]!.requestId).not.toBe(attempts[2]!.requestId);
    expect(attempts[2]!.requestId).not.toBe(attempts[3]!.requestId);
    expect(job.collect).toHaveBeenCalledOnce();
    expect(job.format).toHaveBeenCalledOnce();
  });

  it("clips the first description period to legacy coverage and joins the next window exactly", async () => {
    const { job, getState } = setup();
    const coveredThrough = "2026-11-10T19:00:00.000Z";
    job.scope = "description-morning-v1:fixture";
    job.startDate = "2026-11-11";
    job.now = new Date("2026-11-12T08:01:00+02:00");
    job.period = (date) => {
      const period = workReportPeriod(date);
      return date === job.startDate ? { ...period, start: coveredThrough } : period;
    };
    job.format = vi.fn<MorningReportJob<Report>["format"]>((report) => [
      { text: `${report.period.start} → ${report.period.end}` },
    ]);
    expect(await runMorningReportJob(job)).toMatchObject({ processed: 2, messages: 2 });
    const periods = vi.mocked(job.collect).mock.calls.map(([, period]) => period);
    expect(periods).toEqual([
      { ...workReportPeriod("2026-11-11"), start: coveredThrough },
      workReportPeriod("2026-11-12"),
    ]);
    expect(periods[0]!.end).toBe(periods[1]!.start);
    const parts = vi.mocked(job.send).mock.calls.map(([part]) => part);
    expect(parts.map((part) => part.payload.text)).toEqual([
      "2026-11-10T19:00:00.000Z → 2026-11-11T06:00:00.000Z",
      "2026-11-11T06:00:00.000Z → 2026-11-12T06:00:00.000Z",
    ]);
    expect(parts[0]!.requestId).toBe(
      stableRequestId(job.scope + ":2026-11-11:0:" + JSON.stringify(parts[0]!.payload)),
    );
    expect(getState()?.processedThrough).toBe("2026-11-12");
  });

  it("keeps preview entirely free of state writes, formatting and delivery", async () => {
    const { job, store, getState } = setup();
    job.dryRun = true;
    expect(await runMorningReportJob(job)).toMatchObject({ processed: 1, dryRun: true });
    expect(job.preview).toHaveBeenCalledWith({ period: workReportPeriod("2026-11-09") });
    expect(job.format).not.toHaveBeenCalled();
    expect(job.send).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(getState()).toBeUndefined();
  });

  it("does not acknowledge partial reads or advance their checkpoint", async () => {
    const { job, store } = setup();
    job.collect = vi
      .fn<MorningReportJob<Report>["collect"]>()
      .mockRejectedValue(new Error("Incomplete Jira history"));
    await expect(runMorningReportJob(job)).rejects.toThrow("Incomplete Jira history");
    expect(job.format).not.toHaveBeenCalled();
    expect(job.send).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("requires a payload for a complete period instead of silently checkpointing it", async () => {
    const { job, store } = setup();
    job.format = vi.fn(() => []);
    await expect(runMorningReportJob(job)).rejects.toThrow(
      /acknowledgement or report payload/,
    );
    expect(job.send).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("refuses a future override period before reading Jira", async () => {
    const { job } = setup();
    job.period = () => workReportPeriod("2026-11-10");
    await expect(runMorningReportJob(job)).rejects.toThrow(/still open/);
    expect(job.collect).not.toHaveBeenCalled();
    expect(job.send).not.toHaveBeenCalled();
  });

  it("refuses pending dates that skip the expected working day", async () => {
    const { job, setState } = setup();
    const payload = { text: "No changes for today" };
    setState({
      schemaVersion: 1,
      scope: job.scope,
      pending: {
        date: "2026-11-10",
        parts: [
          {
            payload,
            requestId: stableRequestId(
              job.scope + ":2026-11-10:0:" + JSON.stringify(payload),
            ),
          },
        ],
      },
    });
    await expect(runMorningReportJob(job)).rejects.toThrow(/skip or repeat/);
    expect(job.collect).not.toHaveBeenCalled();
    expect(job.send).not.toHaveBeenCalled();
  });

  it("rejects altered persisted payloads before sending them", async () => {
    const { job, getState, setState } = setup();
    job.send = vi
      .fn<MorningReportJob<Report>["send"]>()
      .mockRejectedValue(new Error("Response lost"));
    await expect(runMorningReportJob(job)).rejects.toThrow("Response lost");
    const state = getState()!;
    state.pending!.parts[0]!.payload.text = "Changed after persistence";
    setState(state);
    await expect(runMorningReportJob(job)).rejects.toThrow(/altered/);
    expect(job.send).toHaveBeenCalledOnce();
  });
});

describe("Private report state paths", () => {
  it.each([
    "state/description-report.json",
    "state/morning-description-report.json",
    "state/work-activity-report.json",
  ])("reads and writes only its configured stream path: %s", async (path) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ private: true, default_branch: "main" })),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: { sha: "saved-sha" } })),
      );
    const store = new GitHubReportStateStore(
      "fixture/reports",
      "fixture-only",
      fetcher,
      path,
    );
    await expect(store.load()).resolves.toBeUndefined();
    await store.save({ schemaVersion: 1, scope: "fixture" });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `https://api.github.com/repos/fixture/reports/contents/${path}?ref=main`,
    );
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      `https://api.github.com/repos/fixture/reports/contents/${path}`,
    );
    expect(fetcher.mock.calls[2]?.[1]?.method).toBe("PUT");
  });

  it.each([
    "state/../config.json",
    "state/other-report.json",
    "state/work-activity-report.json?ref=other",
  ])("rejects an unsupported state path before a request: %s", (path) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      () => new GitHubReportStateStore("fixture/reports", "fixture-only", fetcher, path),
    ).toThrow(/state file/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
