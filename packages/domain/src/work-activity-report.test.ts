import { describe, expect, it } from "vitest";
import type { ReportChangeEvent, ReportingIssueSnapshot } from "./reporting";
import { buildWorkActivityReport } from "./work-activity-report";
import { workActivityChatMessages } from "./work-activity-chat";

const period = {
  date: "2026-11-11",
  start: "2026-11-10T06:00:00.000Z",
  end: "2026-11-11T06:00:00.000Z",
  timeZone: "Europe/Kyiv" as const,
};
const person = (id: string) => ({ id, displayName: id });
function issue(
  id: string,
  status = "In Progress",
  parentId?: string,
): ReportingIssueSnapshot {
  return {
    id,
    key: "TEST-" + id,
    browseUrl: "https://fixture.atlassian.net/browse/TEST-" + id,
    summary: "Issue " + id,
    issueType: { id: "task", name: "Task" },
    status: { id: status, name: status },
    assignee: person("Current owner"),
    sprintIds: ["1", "3"],
    ...(parentId ? { parentId, parentKey: "TEST-" + parentId } : {}),
  };
}
function event(
  id: string,
  type: ReportChangeEvent["type"] = "status-changed",
  issueId = "2",
  occurredAt = "2026-11-10T12:00:00.000Z",
  from: string | null = "To Do",
  to: string | null = "In Progress",
): ReportChangeEvent {
  return {
    id,
    issueId,
    issueKey: "TEST-" + issueId,
    type,
    occurredAt,
    actor: person("Editor"),
    from,
    to,
  };
}
function report(events: ReportChangeEvent[] = [], issues = [issue("2")]) {
  return buildWorkActivityReport({
    jiraBaseUrl: "https://fixture.atlassian.net",
    boardId: "7",
    boardName: "TEST DATA",
    period,
    generatedAt: "2026-11-11T06:01:00.000Z",
    events,
    issues,
  });
}

describe("Work activity report", () => {
  it("groups once by the current Jira status while retaining all chronological transitions", () => {
    const result = report(
      [
        event("third", "status-changed", "2", "2026-11-10T15:00:00Z"),
        event("first", "status-changed", "2", "2026-11-10T10:00:00Z"),
        event(
          "second",
          "status-changed",
          "2",
          "2026-11-10T14:00:00Z",
          "In Progress",
          "To Do",
        ),
      ],
      [issue("2", "In Testing")],
    );
    expect(result.statusGroups).toHaveLength(1);
    expect(result.statusGroups[0]?.statusName).toBe("In Testing");
    expect(result.statusGroups[0]?.rows).toHaveLength(1);
    expect(result.rows[0]?.changes.map((change) => [change.from, change.to])).toEqual([
      ["To Do", "In Progress"],
      ["In Progress", "To Do"],
      ["To Do", "In Progress"],
    ]);
    expect(result.changedIssueCount).toBe(1);
    expect(result.changeCount).toBe(3);
  });

  it("applies start-inclusive/end-exclusive boundaries to changes, not the collection date", () => {
    const result = report([
      event("before", "status-changed", "2", "2026-11-10T05:59:59.999Z"),
      event("start", "status-changed", "2", period.start),
      event("inside", "status-changed", "2", "2026-11-10T23:00:00+02:00"),
      event("end", "status-changed", "2", period.end),
    ]);
    expect(result.rows[0]?.changes.map((change) => change.id)).toEqual([
      "start",
      "inside",
    ]);
  });

  it("deduplicates repeated entries and rejects conflicting IDs", () => {
    expect(report([event("same"), event("same")]).changeCount).toBe(1);
    expect(() => report([event("same"), { ...event("same"), to: "Done" }])).toThrow(
      /conflicting change IDs/,
    );
  });

  it("keeps current owner separate from event actors and redacts old/new descriptions", () => {
    const result = report([
      event("status"),
      event(
        "owner",
        "assignee-changed",
        "2",
        "2026-11-10T12:01:00Z",
        "Editor",
        "Current owner",
      ),
      event(
        "description",
        "description-changed",
        "2",
        "2026-11-10T12:02:00Z",
        "private old body",
        "private new body",
      ),
    ]);
    expect(result.rows[0]?.currentAssignee?.displayName).toBe("Current owner");
    expect(result.rows[0]?.changes[0]?.actor?.displayName).toBe("Editor");
    expect(result.assigneeChangedIssueCount).toBe(1);
    expect(result.descriptionChangedIssueCount).toBe(1);
    expect(result.changedIssueCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private old body");
    expect(JSON.stringify(result)).not.toContain("private new body");
    expect(result.rows[0]?.changes[2]).not.toHaveProperty("from");
    expect(result.rows[0]?.changes[2]).not.toHaveProperty("to");
  });

  it("retains only normalized sprint additions/removals rather than the full current membership", () => {
    const result = report([
      {
        ...event(
          "remove",
          "sprint-removed",
          "2",
          "2026-11-10T10:00:00Z",
          "Old sprint",
          null,
        ),
        sprintId: "2",
      },
      {
        ...event("add", "sprint-added", "2", "2026-11-10T10:00:00Z", null, "New sprint"),
        sprintId: "3",
      },
    ]);
    expect(result.sprintChangedIssueCount).toBe(1);
    expect(
      result.sprintChanges[0]?.changes.map((change) => change.sprintId).sort(),
    ).toEqual(["2", "3"]);
    expect(result.sprintChanges[0]?.changes).toHaveLength(2);
    expect(result.statusGroups).toHaveLength(0);
  });

  it("includes ancestors as context without unchanged siblings or additional changed-task counts", () => {
    const result = report(
      [event("status")],
      [issue("1", "To Do"), issue("2", "In Progress", "1"), issue("3", "To Do", "1")],
    );
    expect(result.rows.map((row) => [row.issueId, row.depth, row.contextOnly])).toEqual([
      ["1", 0, true],
      ["2", 1, false],
    ]);
    expect(result.changedIssueCount).toBe(1);
  });

  it("withholds work when ancestry, current status or times are incomplete", () => {
    expect(() => report([event("e")], [issue("2", "In Progress", "1")])).toThrow(
      /ancestor/,
    );
    expect(() =>
      report([event("e")], [issue("1", "To Do", "2"), issue("2", "In Progress", "1")]),
    ).toThrow(/cyclic/);
    expect(() => report([event("e")], [issue("2", " ")])).toThrow(/current Jira status/);
    expect(() => report([event("e", "status-changed", "2", "invalid")])).toThrow(
      /invalid change time/,
    );
    expect(() => report([event("e")], [issue("1")])).toThrow(/changed issue is missing/);
  });

  it("rejects an unclosed period and keeps unrelated events out of empty reports", () => {
    expect(() =>
      buildWorkActivityReport({
        jiraBaseUrl: "https://fixture.atlassian.net",
        boardId: "7",
        boardName: "TEST DATA",
        period,
        generatedAt: "2026-11-11T05:59:59Z",
        issues: [issue("2")],
        events: [],
      }),
    ).toThrow(/closed Kyiv period/);
    const result = report([event("estimate", "original-estimate-changed")]);
    expect(result.changedIssueCount).toBe(0);
    expect(workActivityChatMessages(result)).toEqual([{ text: "No changes for today" }]);
  });
});

describe("Work activity Google Chat cards", () => {
  it("preserves the full loop in its current status block and identifies actor/current owner", () => {
    const result = report(
      [
        event("a", "status-changed", "2", "2026-11-10T10:00:00Z"),
        event("b", "status-changed", "2", "2026-11-10T11:00:00Z", "In Progress", "To Do"),
        event("c", "status-changed", "2", "2026-11-10T12:00:00Z"),
      ],
      [issue("2", "In Testing", "1"), issue("1", "To Do")],
    );
    const messages = workActivityChatMessages(result);
    expect(messages).toHaveLength(1);
    const payload = JSON.stringify(messages);
    expect(payload).toContain("In Testing · 1 задача");
    expect(payload).toContain("10.11 12:00</b> 🔄 To Do → In Progress · <i>Editor</i>");
    expect(payload).toContain("10.11 13:00</b> 🔄 In Progress → To Do · <i>Editor</i>");
    expect(payload).toContain("10.11 14:00</b> 🔄 To Do → In Progress · <i>Editor</i>");
    expect(payload).toContain("Виконавець зараз:</b> Current owner");
    expect(payload).toContain("10.11.2026 08:00 — 11.11.2026 08:00");
    expect(payload).toContain("11.11.2026 08:01");
    expect(payload).not.toContain("In Progress · 1 задача");
    expect(payload.match(/>TEST-2<\/a>/g)).toHaveLength(1);
  });

  it("fits five changed issues, eight events and six context ancestors into one compact table", () => {
    const root = issue("100", "To Do");
    root.issueType = { id: "epic", name: "Epic" };
    root.summary = "Full epic context must not become another table row";
    const parents = Array.from({ length: 5 }, (_, index) => {
      const parent = issue(String(101 + index), "To Do", "100");
      parent.issueType = { id: "story", name: "Story" };
      parent.summary = "Long parent context " + index;
      return parent;
    });
    const currentStatuses = [
      "In Review",
      "In Review",
      "In Progress",
      "In Testing",
      "In Testing",
    ];
    const changed = parents.map((parent, index) =>
      issue(String(index + 2), currentStatuses[index], parent.id),
    );
    const changes = changed.map((task, index) =>
      event(
        "status-" + task.id,
        "status-changed",
        task.id,
        `2026-11-10T${String(10 + index).padStart(2, "0")}:00:00Z`,
      ),
    );
    changes.push(
      ...changed
        .slice(0, 3)
        .map((task, index) =>
          event(
            "owner-" + task.id,
            "assignee-changed",
            task.id,
            `2026-11-10T${String(10 + index).padStart(2, "0")}:01:00Z`,
            null,
            "Current owner",
          ),
        ),
    );
    const result = report(changes, [root, ...parents, ...changed]);
    expect(result.rows).toHaveLength(11);
    expect(result.changedIssueCount).toBe(5);
    expect(result.changeCount).toBe(8);
    const messages = workActivityChatMessages(result);
    expect(messages).toHaveLength(1);
    const payload = JSON.stringify(messages);
    for (const task of changed)
      expect(payload.match(new RegExp(">" + task.key + "</a>", "g"))).toHaveLength(1);
    expect(payload.match(/Виконавець зараз:/g)).toHaveLength(5);
    expect(payload.match(/<b>Задача<\/b>/g)).toHaveLength(1);
    expect(payload.match(/<b>Зміни \/ виконавець<\/b>/g)).toHaveLength(1);
    expect(payload).toContain("5 задач зі змінами");
    expect(payload).not.toContain(root.summary);
    for (const parent of parents) {
      expect(payload).toContain(">" + parent.key + "</a> (Story)");
      expect(payload).not.toContain(parent.summary);
    }
    const sections = messages[0]!.cardsV2![0]!.card.sections;
    expect(sections.map((section) => section.header).filter(Boolean)).toEqual([
      "📌 Підсумок",
      "🟡 In Progress · 1 задача",
      "🔎 In Review · 2 задачі",
      "🧪 In Testing · 2 задачі",
    ]);
    const issueWidgets = sections.slice(1, -1).flatMap((section) => section.widgets);
    expect(issueWidgets.filter((widget) => "columns" in widget)).toHaveLength(6);
    expect(issueWidgets.filter((widget) => "divider" in widget)).toHaveLength(2);
  });

  it("preserves assignment roundtrips and sprint names and emits description author metadata only", () => {
    const result = report([
      event("a", "assignee-changed", "2", "2026-11-10T10:00:00Z", null, "Editor"),
      event("b", "assignee-changed", "2", "2026-11-10T11:00:00Z", "Editor", null),
      event("c", "assignee-changed", "2", "2026-11-10T12:00:00Z", null, "Editor"),
      event(
        "d",
        "description-changed",
        "2",
        "2026-11-10T13:00:00Z",
        "OLD SECRET",
        "NEW SECRET",
      ),
      {
        ...event("e", "sprint-added", "2", "2026-11-10T14:00:00Z", null, "Aria Sprint 4"),
        sprintId: "4",
      },
      {
        ...event(
          "f",
          "sprint-removed",
          "2",
          "2026-11-10T15:00:00Z",
          "Aria Sprint 3",
          null,
        ),
        sprintId: "3",
      },
    ]);
    const payload = JSON.stringify(workActivityChatMessages(result));
    expect(payload).toContain("10.11 12:00</b> 🤝 Виконавець: Не призначено → Editor");
    expect(payload).toContain("10.11 13:00</b> 🤝 Виконавець: Editor → Не призначено");
    expect(payload).toContain("10.11 14:00</b> 🤝 Виконавець: Не призначено → Editor");
    expect(payload).toContain("✏️ Оновлено опис · <i>Editor</i>");
    expect(payload).toContain("Додано до спринту: Aria Sprint 4");
    expect(payload).toContain("Знято зі спринту: Aria Sprint 3");
    expect(payload).not.toContain("OLD SECRET");
    expect(payload).not.toContain("NEW SECRET");
    expect(payload.match(/>TEST-2<\/a>/g)).toHaveLength(1);
    expect(payload.match(/Виконавець зараз:/g)).toHaveLength(1);
    expect(payload).toContain("In Progress · 1 задача");
  });

  it("keeps interleaved changes and distinct actors in one issue's chronological history", () => {
    const changes = [
      event("status-1", "status-changed", "2", "2026-11-10T10:00:00Z"),
      event(
        "owner",
        "assignee-changed",
        "2",
        "2026-11-10T10:01:00Z",
        "Earlier owner",
        "Current owner",
      ),
      event(
        "description",
        "description-changed",
        "2",
        "2026-11-10T10:02:00Z",
        "OLD SECRET",
        "NEW SECRET",
      ),
      {
        ...event(
          "sprint",
          "sprint-added",
          "2",
          "2026-11-10T10:03:00Z",
          null,
          "Next sprint",
        ),
        sprintId: "4",
      },
      event(
        "status-2",
        "status-changed",
        "2",
        "2026-11-10T10:04:00Z",
        "In Progress",
        "To Do",
      ),
    ];
    changes.forEach((change, index) => {
      change.actor = person("Actor " + index);
    });
    const payload = JSON.stringify(
      workActivityChatMessages(report(changes.reverse(), [issue("2", "To Do")])),
    );
    expect(payload).toContain("To Do · 1 задача");
    for (let index = 0; index < 5; index++) {
      expect(payload).toContain(`10.11 12:0${index}</b>`);
      expect(payload).toContain("Actor " + index);
      if (index > 0)
        expect(payload.indexOf(`10.11 12:0${index - 1}</b>`)).toBeLessThan(
          payload.indexOf(`10.11 12:0${index}</b>`),
        );
    }
    expect(payload).toContain("Виконавець зараз:</b> Current owner");
    expect(payload.match(/>TEST-2<\/a>/g)).toHaveLength(1);
    expect(payload).not.toContain("OLD SECRET");
    expect(payload).not.toContain("NEW SECRET");
  });

  it("dates every transition across the Friday-to-Monday reporting window", () => {
    const result = buildWorkActivityReport({
      jiraBaseUrl: "https://fixture.atlassian.net",
      boardId: "7",
      boardName: "TEST DATA",
      period: {
        ...period,
        date: "2026-11-09",
        start: "2026-11-06T06:00:00Z",
        end: "2026-11-09T06:00:00Z",
      },
      generatedAt: "2026-11-09T06:01:00Z",
      issues: [issue("2")],
      events: [
        event("friday", "status-changed", "2", "2026-11-06T10:00:00Z"),
        event(
          "saturday",
          "assignee-changed",
          "2",
          "2026-11-07T10:00:00Z",
          "Earlier owner",
          "Current owner",
        ),
        event("sunday", "description-changed", "2", "2026-11-08T10:00:00Z"),
        event("monday", "status-changed", "2", "2026-11-09T05:00:00Z"),
      ],
    });
    const payload = JSON.stringify(workActivityChatMessages(result));
    for (const timestamp of ["06.11 12:00", "07.11 12:00", "08.11 12:00", "09.11 07:00"])
      expect(payload).toContain(timestamp);
    expect(payload.match(/>TEST-2<\/a>/g)).toHaveLength(1);
  });

  it("escapes issue/actor/status/sprint text and makes only origin-scoped issue links", () => {
    const malicious = issue("2", "<b>Current & status</b>");
    malicious.summary = '<img src="x"> & more';
    const change = event("a", "status-changed", "2", undefined, "<old>", "<new>");
    change.actor = person("<actor>");
    const payload = JSON.stringify(
      workActivityChatMessages(report([change], [malicious])),
    );
    expect(payload).toContain("&lt;img src=&quot;x&quot;&gt; &amp; more");
    expect(payload).toContain("&lt;old&gt; → &lt;new&gt;");
    expect(payload).toContain("&lt;actor&gt;");
    expect(payload).toContain("https://fixture.atlassian.net/browse/TEST-2");
    expect(payload).not.toContain('<img src="x">');
  });

  it("chunks by changed issues, keeping one column header per part and compact parent links", () => {
    const issues = [
      issue("1", "To Do"),
      ...Array.from({ length: 55 }, (_, i) => issue(String(i + 2), "In Testing", "1")),
    ];
    const events = issues.slice(1).map((i) => event("e" + i.id, "status-changed", i.id));
    const messages = workActivityChatMessages(report(events, issues));
    expect(messages).toHaveLength(3);
    const bytes = (value: unknown) =>
      new TextEncoder().encode(JSON.stringify(value)).length;
    for (const message of messages) {
      expect(bytes(message)).toBeLessThan(28000);
      const payload = JSON.stringify(message);
      expect(payload).toContain("In Testing · 55 задач");
      expect(payload).toContain(">TEST-1</a>");
      const widgets = message
        .cardsV2![0]!.card.sections.filter((section) =>
          section.header?.includes("In Testing"),
        )
        .flatMap((section) => section.widgets);
      expect(widgets.filter((widget) => "columns" in widget).length).toBeLessThanOrEqual(
        21,
      );
      expect(payload.match(/<b>Задача<\/b>/g)).toHaveLength(1);
      expect(payload.match(/<b>Зміни \/ виконавець<\/b>/g)).toHaveLength(1);
    }
    const payload = JSON.stringify(messages);
    expect(payload.match(/55 задач зі змінами/g)).toHaveLength(1);
    expect(payload.match(/Поточний стан:/g)).toHaveLength(1);
    for (const i of issues.slice(1))
      expect(payload.match(new RegExp(">" + i.key + "</a>", "g"))).toHaveLength(1);
  });

  it("also chunks on UTF-8 bytes before twenty issues without losing any event details", () => {
    const issues = Array.from({ length: 5 }, (_, index) => issue(String(index + 2)));
    const changes = issues.flatMap((task) =>
      Array.from({ length: 4 }, (_, index) => ({
        ...event(
          task.id + "-" + index,
          "status-changed",
          task.id,
          `2026-11-10T12:0${index}:00Z`,
          "я".repeat(400),
          "ї".repeat(400),
        ),
        actor: person("Редактор" + "є".repeat(800)),
      })),
    );
    const messages = workActivityChatMessages(report(changes, issues));
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages)
      expect(new TextEncoder().encode(JSON.stringify(message)).length).toBeLessThan(
        28000,
      );
    const payload = JSON.stringify(messages);
    for (const task of issues)
      expect(payload.match(new RegExp(">" + task.key + "</a>", "g"))).toHaveLength(1);
    expect(payload.match(/я{400} → ї{400}/g)).toHaveLength(20);
    expect(payload.match(/Редакторє{800}/g)).toHaveLength(20);
  });

  it("fails an individually oversized event chain instead of dropping transitions", () => {
    const changes = Array.from({ length: 200 }, (_, i) =>
      event(
        "e" + i,
        "status-changed",
        "2",
        "2026-11-10T12:00:00Z",
        "x".repeat(120),
        "y".repeat(120),
      ),
    );
    expect(() => workActivityChatMessages(report(changes))).toThrow(
      /No events were dropped/,
    );
  });
});
