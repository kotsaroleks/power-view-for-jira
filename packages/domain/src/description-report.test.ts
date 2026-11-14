import { describe, expect, it } from "vitest";
import {
  descriptionCandidateJql,
  descriptionReportPeriod,
  latestDescriptionReportDate,
} from "./description-report";
import { descriptionChatMessages } from "./description-chat";
import {
  descriptionEvent,
  descriptionFixture,
  descriptionIssue,
} from "./description-report.test-fixtures";
describe("Daily description report", () => {
  it("uses civil Kyiv evenings across both DST transitions", () => {
    for (const [date, hours] of [
      ["2026-03-29", 23],
      ["2026-10-25", 25],
      ["2026-11-06", 24],
    ] as const) {
      const period = descriptionReportPeriod(date);
      expect((Date.parse(period.end) - Date.parse(period.start)) / 3600000).toBe(hours);
    }
  });
  it("chooses the last closed period even when a schedule is late or run before 21", () => {
    expect(latestDescriptionReportDate(new Date("2026-11-06T18:59:59Z"))).toBe(
      "2026-11-05",
    );
    expect(latestDescriptionReportDate(new Date("2026-11-06T19:00:00Z"))).toBe(
      "2026-11-06",
    );
    expect(latestDescriptionReportDate(new Date("2026-11-07T00:05:00Z"))).toBe(
      "2026-11-06",
    );
  });
  it("rejects invalid calendar dates and does not upper-bound issue updates", () => {
    expect(() => descriptionReportPeriod("2026-02-30")).toThrow();
    expect(descriptionCandidateJql(descriptionReportPeriod("2026-11-06"))).toContain(
      'updated >= "2026-11-04 19:00"',
    );
    expect(descriptionCandidateJql(descriptionReportPeriod("2026-11-06"))).not.toContain(
      "updated <",
    );
  });
  it("includes the start, excludes 21:00 at the end, and ignores other fields", () => {
    const events = [
      descriptionEvent("start", "2", "a", "2026-11-05T19:00:00Z"),
      descriptionEvent("end", "2", "b", "2026-11-06T19:00:00Z"),
      { ...descriptionEvent("status"), type: "status-changed" as const },
    ];
    const report = descriptionFixture(undefined, events);
    expect(report.changeCount).toBe(1);
    expect(report.rows[1]?.authors.map((a) => a.id)).toEqual(["a"]);
  });
  it("preserves every editor and reverted edits, deduplicating repeated event pages", () => {
    const first = descriptionEvent("first");
    const second = {
      ...descriptionEvent("second", "2", "b"),
      from: "later",
      to: "original",
    };
    const report = descriptionFixture(undefined, [
      first,
      first,
      second,
      descriptionEvent("third"),
    ]);
    expect(report.changedIssueCount).toBe(1);
    expect(report.changeCount).toBe(3);
    expect(report.rows[1]?.authors.map((a) => a.id)).toEqual(["a", "b"]);
  });
  it("keeps only changed branches and their ancestors, including cross-project context", () => {
    const report = descriptionFixture(
      [
        descriptionIssue("1"),
        descriptionIssue("2", "1"),
        descriptionIssue("3", "2"),
        descriptionIssue("4", "1"),
      ],
      [descriptionEvent("e", "3")],
    );
    expect(report.rows.map((row) => [row.issueKey, row.depth, row.contextOnly])).toEqual([
      ["TEST-1", 0, true],
      ["TEST-2", 1, true],
      ["TEST-3", 2, false],
    ]);
  });
  it("does not invent an editor when Jira hides their identity", () => {
    const event = descriptionEvent("e");
    delete event.actor;
    expect(descriptionFixture(undefined, [event]).rows[1]?.authors).toEqual([
      { id: "unavailable", displayName: "Автор недоступний" },
    ]);
  });
  it("rejects missing parents, cycles and invalid change timestamps", () => {
    expect(() => descriptionFixture([descriptionIssue("2", "1")])).toThrow(/ancestor/);
    expect(() =>
      descriptionFixture([descriptionIssue("1", "2"), descriptionIssue("2", "1")]),
    ).toThrow(/cyclic/);
    expect(() =>
      descriptionFixture(undefined, [descriptionEvent("e", "2", "a", "not a time")]),
    ).toThrow(/time/);
  });
  it("returns the exact plaintext message when no description changed", () => {
    expect(descriptionChatMessages(descriptionFixture(undefined, []))).toEqual([
      { text: "No changes for today" },
    ]);
  });
  it("escapes Jira text and retains every changed task across bounded Chat cards", () => {
    const issues = [
      descriptionIssue("1"),
      ...Array.from({ length: 55 }, (_, i) => descriptionIssue(String(i + 2), "1")),
    ];
    issues[1]!.summary = '<script>alert("x")</script>';
    const report = descriptionFixture(
      issues,
      issues
        .slice(1)
        .map((issue, i) => descriptionEvent(String(i), issue.id, "Editor & <script>")),
    );
    const messages = descriptionChatMessages(report);
    expect(messages.length).toBeGreaterThan(1);
    expect(
      messages.reduce(
        (sum, m) =>
          sum +
          m
            .cardsV2![0]!.card.sections.find(
              (section) => section.header === "🧾 Правки за задачами",
            )!
            .widgets.filter((widget) => "columns" in widget).length -
          1,
        0,
      ),
    ).toBeGreaterThanOrEqual(55);
    const text = JSON.stringify(messages);
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<script>");
    for (const message of messages)
      expect(
        new TextEncoder().encode(JSON.stringify(message)).length,
      ).toBeLessThanOrEqual(28000);
    for (const issue of issues.slice(1)) expect(text).toContain(issue.key);
    for (const message of messages) expect(JSON.stringify(message)).toContain("TEST-1");
  });
});
