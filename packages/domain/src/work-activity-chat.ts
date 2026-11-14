import {
  reportColumns,
  type DescriptionChatMessage,
  type ReportChatSection,
} from "./description-chat";
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
const eventIcons: Record<WorkActivityChange["type"], string> = {
  "status-changed": "🔄",
  "assignee-changed": "🤝",
  "description-changed": "✏️",
  "sprint-added": "➕",
  "sprint-removed": "➖",
};
const statusIcons = new Map([
  ["To Do", "⚪"],
  ["In Progress", "🟡"],
  ["In Review", "🔎"],
  ["In Testing", "🧪"],
  ["Acceptance", "🤝"],
  ["Done", "✅"],
]);
function eventLine(change: WorkActivityChange, text: string): string {
  const dateTime = localDateTime(change.occurredAt);
  return `<b>${dateTime.slice(0, 5)} ${dateTime.slice(11)}</b> ${eventIcons[change.type]} ${text} · <i>${actor(change)}</i>`;
}
function owner(row: WorkActivityRow): string {
  return `<b>👤 Виконавець зараз:</b> ${html(row.currentAssignee?.displayName ?? "Не призначено")}`;
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
  ancestors: WorkActivityRow[];
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
  for (const unit of units) {
    if (!current || current.key !== unit.section) {
      current = { key: unit.section, title: unit.title, rows: [] };
      result.push(current);
    }
    current.rows.push({
      issue: unit.row,
      ancestors: unit.ancestors,
      detail: unit.detail,
    });
  }
  return result;
}

function message(
  report: WorkActivityReport,
  units: readonly Unit[],
  index: number,
  count: number,
): DescriptionChatMessage {
  const boardName = report.boardName.replace(/[\r\n]/g, " ");
  const cardSections: ReportChatSection[] = [];
  if (index === 0)
    cardSections.push({
      header: "📌 Підсумок",
      widgets: [
        {
          textParagraph: {
            text: `<b>${taskCount(report.changedIssueCount)} зі змінами</b> · Подій: <b>${report.changeCount}</b><br>🗂️ ${html(boardName)}`,
          },
        },
        reportColumns(
          `🔄 Статус: <b>${report.statusChangedIssueCount}</b><br>🤝 Виконавець: <b>${report.assigneeChangedIssueCount}</b>`,
          `✏️ Опис: <b>${report.descriptionChangedIssueCount}</b><br>🏁 Спринт: <b>${report.sprintChangedIssueCount}</b>`,
        ),
      ],
    });
  for (const [sectionIndex, section] of sections(units).entries()) {
    const widgets: Array<Record<string, unknown>> = [];
    if (sectionIndex === 0)
      widgets.push(reportColumns("<b>Задача</b>", "<b>Зміни / виконавець</b>"));
    for (const [rowIndex, row] of section.rows.entries()) {
      const summary =
        row.issue.summary.length > 240
          ? row.issue.summary.slice(0, 240) + "…"
          : row.issue.summary;
      const breadcrumb = row.ancestors
        .map(
          (ancestor) =>
            `<a href="${html(report.jiraBaseUrl + "/browse/" + encodeURIComponent(ancestor.issueKey))}">${html(ancestor.issueKey)}</a> (${html(ancestor.issueType)})`,
        )
        .join(" → ");
      const issue =
        `<a href="${html(report.jiraBaseUrl + "/browse/" + encodeURIComponent(row.issue.issueKey))}">${html(row.issue.issueKey)}</a> · ${html(row.issue.issueType)}<br>${html(summary)}` +
        (breadcrumb ? `<br><i>${breadcrumb}</i>` : "");
      if (rowIndex > 0) widgets.push({ divider: {} });
      widgets.push(reportColumns(issue, row.detail));
    }
    cardSections.push({ header: html(section.title), widgets });
  }
  if (index === count - 1)
    cardSections.push({
      widgets: [
        {
          textParagraph: {
            text: `<i>🕒 Поточний стан: ${localDateTime(report.generatedAt)} · Київ.</i>`,
          },
        },
      ],
    });
  return {
    text: "",
    cardsV2: [
      {
        cardId: `work-activity-${report.period.date}-${index + 1}`,
        card: {
          header: {
            title:
              "📊 Що змінилося в роботі" + (count > 1 ? ` · ${index + 1}/${count}` : ""),
            subtitle: `📅 ${localDateTime(report.period.start)} — ${localDateTime(report.period.end)} · Київ`,
          },
          sections: cardSections,
        },
      },
    ],
  };
}

/** One table entry per changed issue, bounded chunks and compact ancestor breadcrumbs.
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
  const groups = new Map<
    string,
    { statusId?: string; statusName: string; rows: WorkActivityRow[] }
  >();
  for (const row of report.rows.filter((row) => !row.contextOnly)) {
    const key = row.currentStatus.id ?? row.currentStatus.name;
    const group = groups.get(key) ?? {
      ...(row.currentStatus.id ? { statusId: row.currentStatus.id } : {}),
      statusName: row.currentStatus.name,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  const statusOrder = [...statusIcons.keys()];
  const orderedGroups = [...groups.values()].sort((left, right) => {
    const order = (name: string) => {
      const index = statusOrder.indexOf(name);
      return index < 0 ? statusOrder.length : index;
    };
    return (
      order(left.statusName) - order(right.statusName) ||
      left.statusName.localeCompare(right.statusName, "uk")
    );
  });
  for (const group of orderedGroups) {
    const title = `${statusIcons.get(group.statusName) ?? "🔹"} ${group.statusName} · ${taskCount(group.rows.length)}`;
    for (const row of group.rows) {
      const transitions = row.changes.map((change) => {
        switch (change.type) {
          case "status-changed":
            return eventLine(
              change,
              `${html(value(change.from, "Невідомо"))} → ${html(value(change.to, "Невідомо"))}`,
            );
          case "assignee-changed":
            return eventLine(
              change,
              `Виконавець: ${html(value(change.from, "Не призначено"))} → ${html(value(change.to, "Не призначено"))}`,
            );
          case "description-changed":
            return eventLine(change, "Оновлено опис");
          case "sprint-added":
            return eventLine(
              change,
              `Додано до спринту: ${html(value(change.to, "Sprint " + change.sprintId))}`,
            );
          case "sprint-removed":
            return eventLine(
              change,
              `Знято зі спринту: ${html(value(change.from, "Sprint " + change.sprintId))}`,
            );
        }
      });
      add(
        "status:" + (group.statusId ?? group.statusName),
        title,
        row,
        owner(row) + "<br>" + transitions.join("<br>"),
      );
    }
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
