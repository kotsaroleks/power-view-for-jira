import { describe, expect, it } from "vitest";
import {
  buildDescriptionChangeReport,
  descriptionReportPeriod,
} from "./description-report";
import { descriptionChatMessages } from "./description-chat";
import { workReportPeriod } from "./work-report-period";
import { descriptionIssue, descriptionEvent } from "./description-report.test-fixtures";

describe("Description bot morning cutover", () => {
  const issue = descriptionIssue("2");
  const base = {
    jiraBaseUrl: "https://fixture.atlassian.net",
    boardId: "7",
    boardName: "TEST DATA",
    generatedAt: "2026-11-10T06:01:00Z",
    issues: [issue],
  };
  it("joins the legacy delivered end to the first morning without overlap or a gap", () => {
    const legacy = descriptionReportPeriod("2026-11-09");
    const period = { ...workReportPeriod("2026-11-10"), start: legacy.end };
    const events = [
      descriptionEvent("before", "2", "actor", "2026-11-09T18:59:59.999Z"),
      descriptionEvent("start", "2", "actor", period.start),
      descriptionEvent("last", "2", "actor", "2026-11-10T05:59:59.999Z"),
      descriptionEvent("next", "2", "actor", period.end),
    ];
    const report = buildDescriptionChangeReport({ ...base, period, events }, period);
    expect(report.changeCount).toBe(2);
    const payload = JSON.stringify(descriptionChatMessages(report));
    expect(payload).toContain("2026-11-09 21:00 — 2026-11-10 08:00");
  });
  it("labels a regular morning report with its actual 08:00 boundaries", () => {
    const period = workReportPeriod("2026-11-10");
    const report = buildDescriptionChangeReport(
      {
        ...base,
        period,
        events: [descriptionEvent("first", "2", "actor", period.start)],
      },
      period,
    );
    expect(JSON.stringify(descriptionChatMessages(report))).toContain(
      "2026-11-09 08:00 — 2026-11-10 08:00",
    );
  });
  it("keeps existing product previews on their original calendar unless explicitly configured", () => {
    const period = workReportPeriod("2026-11-10");
    expect(() => buildDescriptionChangeReport({ ...base, period, events: [] })).toThrow(
      /boundaries/,
    );
  });
});
