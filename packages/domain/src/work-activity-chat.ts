import type { DescriptionChatMessage } from "./description-chat";
import type {
  WorkActivityChange,
  WorkActivityReport,
  WorkActivityRow,
} from "./work-activity-report";

const html = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const time = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const local = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function localDateTime(instant: string): string {
  const p = Object.fromEntries(
    local.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
  );
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}
function actor(change: WorkActivityChange): string {
  return html(change.actor?.displayName ?? "Автор недоступний");
}
function value(value: string | number | null | undefined, missing: string): string {
  return value === null || value === undefined || value === "" ? missing : String(value);
}
function eventLine(change: WorkActivityChange, text: string): string {
  return `${time.format(new Date(change.occurredAt))} · ${text} · ${actor(change)}`;
}
function owner(row: WorkActivityRow): string {
  return `<b>Поточний виконавець:</b> ${html(row.currentAssignee?.displayName ?? "Не призначено")}`;
}
function taskCount(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const word =
    lastTwo >= 11 && lastTwo <= 14
      ? "задач"
      : last === 1
        ? "задача"
        : last >= 2 && last <= 4
          ? "задачі"
          : "задач";
  return `${count} ${word}`;
}

interface Unit {
  section: string;
  title: string;
  row: WorkActivityRow;
  ancestors: WorkActivityRow[];
  detail: string;
}
interface DisplayRow {
  issue: WorkActivityRow;
  context: boolean;
  detail: string;
}
interface DisplaySection {
  key: string;
  title: string;
  rows: DisplayRow[];
}

function sections(units: readonly Unit[]): DisplaySection[] {
  const result: DisplaySection[] = [];
  let current: DisplaySection | undefined;
  let seen = new Set<string>();
  for (const unit of units) {
    if (!current || current.key !== unit.section) {
      current = { key: unit.section, title: unit.title, rows: [] };
      result.push(current);
      seen = new Set<string>();
    }
    for (const ancestor of unit.ancestors) {
      if (!seen.has(ancestor.issueId)) {
        current.rows.push({
          issue: ancestor,
          context: true,
          detail: "— <i>контекст</i>",
        });
        seen.add(ancestor.issueId);
      }
    }
    current.rows.push({ issue: unit.row, context: false, detail: unit.detail });
    seen.add(unit.row.issueId);
  }
  return result;
}

function message(
  report: WorkActivityReport,
  units: readonly Unit[],
  index: number,
  count: number,
): DescriptionChatMessage {
  const widgets: Array<Record<string, unknown>> = [
    {
      textParagraph: {
        text: `<b>Задач зі змінами: ${report.changedIssueCount}</b><br>Статус: ${report.statusChangedIssueCount} · Виконавець: ${report.assigneeChangedIssueCount} · Опис: ${report.descriptionChangedIssueCount} · Спринт: ${report.sprintChangedIssueCount}<br>В одній задачі можуть змінюватися кілька полів.`,
      },
    },
    {
      textParagraph: {
        text: `Поточні статуси й виконавці прочитані під час формування: ${localDateTime(report.generatedAt)} · Київ. Переходи нижче належать лише звітному періоду.`,
      },
    },
  ];
  for (const section of sections(units)) {
    widgets.push({ textParagraph: { text: `<b>${html(section.title)}</b>` } });
    for (const row of section.rows) {
      const prefix = row.issue.depth
        ? "　".repeat(Math.min(row.issue.depth - 1, 10)) + "↳ "
        : "";
      const summary =
        row.issue.summary.length > 240
          ? row.issue.summary.slice(0, 240) + "…"
          : row.issue.summary;
      const issue = `${prefix}<a href="${html(report.jiraBaseUrl + "/browse/" + encodeURIComponent(row.issue.issueKey))}">${html(row.issue.issueKey)}</a> · ${html(row.issue.issueType)}<br>${html(summary)}`;
      widgets.push({
        columns: {
          columnItems: [
            {
              horizontalSizeStyle: "FILL_AVAILABLE_SPACE",
              widgets: [{ textParagraph: { text: issue } }],
            },
            {
              horizontalSizeStyle: "FILL_AVAILABLE_SPACE",
              widgets: [{ textParagraph: { text: row.detail } }],
            },
          ],
        },
      });
    }
  }
  const boardName = report.boardName.replace(/[\r\n]/g, " ");
  return {
    text: `Що змінилося в роботі · ${report.period.date} · ${report.changedIssueCount} задач · ${boardName.replaceAll("<", "‹").replaceAll(">", "›")}`,
    cardsV2: [
      {
        cardId: `work-activity-${report.period.date}-${index + 1}`,
        card: {
          header: {
            title: "Що змінилося в роботі",
            subtitle: `${boardName.slice(0, 120)} · ${localDateTime(report.period.start)} — ${localDateTime(report.period.end)} · Київ · ${index + 1}/${count}`,
          },
          sections: [{ widgets }],
        },
      },
    ],
  };
}

/** Two aligned Chat columns, bounded chunks and repeated status/ancestor context.
 * Every event is retained; an individually oversized row fails instead of truncating it. */
export function workActivityChatMessages(
  report: WorkActivityReport,
): DescriptionChatMessage[] {
  if (!report.changedIssueCount) return [{ text: "No changes for today" }];
  const byId = new Map(report.rows.map((row) => [row.issueId, row]));
  function ancestors(row: WorkActivityRow): WorkActivityRow[] {
    const result: WorkActivityRow[] = [];
    const seen = new Set<string>([row.issueId]);
    let current = row;
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent || seen.has(parent.issueId))
        throw new Error("The work report hierarchy is incomplete or cyclic.");
      seen.add(parent.issueId);
      result.unshift(parent);
      current = parent;
    }
    return result;
  }
  const units: Unit[] = [];
  function add(section: string, title: string, row: WorkActivityRow, detail: string) {
    units.push({ section, title, row, ancestors: ancestors(row), detail });
  }
  for (const group of report.statusGroups) {
    const title = `${group.statusName} · ${taskCount(group.rows.length)}`;
    for (const row of group.rows) {
      const transitions = row.changes
        .filter((change) => change.type === "status-changed")
        .map((change) =>
          eventLine(
            change,
            `${html(value(change.from, "Невідомо"))} → ${html(value(change.to, "Невідомо"))}`,
          ),
        );
      add(
        "status:" + (group.statusId ?? group.statusName),
        title,
        row,
        transitions.join("<br>") + "<br>" + owner(row),
      );
    }
  }
  for (const row of report.assigneeChanges) {
    const transitions = row.changes
      .filter((change) => change.type === "assignee-changed")
      .map((change) =>
        eventLine(
          change,
          `${html(value(change.from, "Не призначено"))} → ${html(value(change.to, "Не призначено"))}`,
        ),
      );
    add(
      "assignees",
      "Передача відповідальності",
      row,
      transitions.join("<br>") + "<br>" + owner(row),
    );
  }
  for (const row of report.descriptionChanges) {
    const edits = row.changes
      .filter((change) => change.type === "description-changed")
      .map((change) => eventLine(change, "Оновлено опис"));
    add("descriptions", "Оновлені описи", row, edits.join("<br>"));
  }
  for (const row of report.sprintChanges) {
    const changes = row.changes
      .filter(
        (change) => change.type === "sprint-added" || change.type === "sprint-removed",
      )
      .map((change) => {
        const added = change.type === "sprint-added";
        const sprint = value(
          added ? change.to : change.from,
          "Sprint " + change.sprintId,
        );
        return eventLine(
          change,
          `${added ? "Додано до спринту" : "Знято зі спринту"}: ${html(sprint)}`,
        );
      });
    add("sprints", "Зміни плану спринтів", row, changes.join("<br>"));
  }
  if (!units.length) throw new Error("The changed work report has no deliverable rows.");
  const parts: Unit[][] = [];
  let current: Unit[] = [];
  const rowCount = (units: readonly Unit[]) =>
    sections(units).reduce((sum, section) => sum + section.rows.length, 0);
  for (const unit of units) {
    const candidate = [...current, unit];
    if (
      current.length &&
      (rowCount(candidate) > 20 || size(message(report, candidate, 0, 1)) > 27000)
    ) {
      parts.push(current);
      current = [];
    }
    const next = [...current, unit];
    if (rowCount(next) > 20 || size(message(report, next, 0, 1)) > 27000)
      throw new Error(
        "A work report row exceeds Google Chat limits. No events were dropped.",
      );
    current = next;
  }
  if (current.length) parts.push(current);
  const result = parts.map((part, index) => message(report, part, index, parts.length));
  if (result.some((part) => size(part) > 28000))
    throw new Error("The work report exceeds Google Chat's message size limit.");
  return result;
}
