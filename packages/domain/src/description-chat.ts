import {
  type DescriptionChangeReport,
  type DescriptionReportRow,
} from "./description-report";

export interface ReportChatSection {
  header?: string;
  widgets: Array<Record<string, unknown>>;
}

export interface DescriptionChatMessage {
  text: string;
  cardsV2?: Array<{
    cardId: string;
    card: {
      header: { title: string; subtitle: string };
      sections: ReportChatSection[];
    };
  }>;
}
const html = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

export function reportColumns(left: string, right: string): Record<string, unknown> {
  return {
    columns: {
      columnItems: [left, right].map((text) => ({
        horizontalSizeStyle: "FILL_AVAILABLE_SPACE",
        verticalAlignment: "TOP",
        widgets: [{ textParagraph: { text } }],
      })),
    },
  };
}

function message(
  report: DescriptionChangeReport,
  rows: DescriptionReportRow[],
  index: number,
  count: number,
): DescriptionChatMessage {
  const dateTime = (instant: string) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Kyiv",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  };
  const period = `${dateTime(report.period.start)} — ${dateTime(report.period.end)} · Київ`;
  const boardName = report.boardName.replace(/[\r\n]/g, " ");
  const widgets = [reportColumns("<b>Задача й ієрархія</b>", "<b>Автори правок</b>")];
  for (const row of rows) {
    const prefix = row.depth ? "　".repeat(Math.min(row.depth - 1, 10)) + "↳ " : "";
    const issue = `${prefix}<a href="${html(report.jiraBaseUrl + "/browse/" + encodeURIComponent(row.issueKey))}">${html(row.issueKey)}</a> · ${html(row.issueType)}<br>${html(row.summary.slice(0, 240))}`;
    const authors = row.contextOnly
      ? "🔗 <i>Батьківська задача</i>"
      : `👤 ${row.authors.map((author) => html(author.displayName)).join(", ")}<br>✏️ Правок: ${row.changeCount}`;
    if (widgets.length > 1 && row.depth === 0) widgets.push({ divider: {} });
    widgets.push(reportColumns(issue, authors));
  }
  const sections: ReportChatSection[] = [{ header: "🧾 Правки за задачами", widgets }];
  if (index === 0)
    sections.unshift({
      header: "📌 Підсумок",
      widgets: [
        reportColumns(
          `🗂️ <b>${report.changedIssueCount}</b><br>Задачі зі змінами`,
          `✏️ <b>${report.changeCount}</b><br>Правки описів`,
        ),
      ],
    });
  return {
    text: `📝 Зміни описів · ${boardName.replaceAll("<", "‹").replaceAll(">", "›")}`,
    cardsV2: [
      {
        cardId: `descriptions-${report.period.date}-${index + 1}`,
        card: {
          header: {
            title:
              "📝 Зміни описів задач" + (count > 1 ? ` · ${index + 1}/${count}` : ""),
            subtitle: `📅 ${period}`,
          },
          sections,
        },
      },
    ],
  };
}
/** Every changed task survives chunking; each part repeats its necessary parent context.
 * One columns widget per row keeps author cells aligned when Chat wraps on mobile. */
export function descriptionChatMessages(
  report: DescriptionChangeReport,
): DescriptionChatMessage[] {
  if (!report.changedIssueCount) return [{ text: "No changes for today" }];
  const byId = new Map(report.rows.map((row) => [row.issueId, row]));
  const parts: DescriptionReportRow[][] = [];
  let current: DescriptionReportRow[] = [];
  const ids = () => new Set(current.map((row) => row.issueId));
  for (const row of report.rows.filter((value) => !value.contextOnly)) {
    const ancestors: DescriptionReportRow[] = [];
    let parent = row.parentId ? byId.get(row.parentId) : undefined;
    const seen = new Set<string>();
    while (parent) {
      if (seen.has(parent.issueId)) throw new Error("Cannot send a cyclic hierarchy.");
      seen.add(parent.issueId);
      ancestors.unshift({ ...parent, contextOnly: true, authors: [], changeCount: 0 });
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    let addition = [...ancestors.filter((value) => !ids().has(value.issueId)), row];
    if (
      current.length &&
      (current.length + addition.length > 20 ||
        size(message(report, [...current, ...addition], 0, 1)) > 27000)
    ) {
      parts.push(current);
      current = [];
      addition = [...ancestors, row];
    }
    if (addition.length > 20 || size(message(report, addition, 0, 1)) > 27000)
      throw new Error(
        "A report row exceeds Google Chat limits. No truncated message was sent.",
      );
    current.push(...addition);
  }
  if (current.length) parts.push(current);
  const result = parts.map((rows, index) => message(report, rows, index, parts.length));
  if (result.some((value) => size(value) > 28000))
    throw new Error("The report exceeds Google Chat's message size limit.");
  return result;
}
