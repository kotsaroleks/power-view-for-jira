import {
  shiftDescriptionDate,
  type DescriptionChangeReport,
  type DescriptionReportRow,
} from "./description-report";

export interface DescriptionChatMessage {
  text: string;
  cardsV2: Array<{
    cardId: string;
    card: {
      header: { title: string; subtitle: string };
      sections: Array<{ widgets: Array<Record<string, unknown>> }>;
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
function message(
  report: DescriptionChangeReport,
  rows: DescriptionReportRow[],
  index: number,
  count: number,
): DescriptionChatMessage {
  const period = `${shiftDescriptionDate(report.period.date, -1)} 21:00 — ${report.period.date} 21:00 · Київ`;
  const widgets: Array<Record<string, unknown>> = [
    {
      textParagraph: {
        text: `<b>Тікет та ієрархія · Хто змінив опис</b><br>Задач зі змінами: ${report.changedIssueCount}. Правок: ${report.changeCount}. Батьківські задачі без правок наведені як контекст.`,
      },
    },
  ];
  for (const row of rows) {
    const prefix = row.depth ? "　".repeat(Math.min(row.depth - 1, 10)) + "↳ " : "";
    const issue = `${prefix}<a href="${html(report.jiraBaseUrl + "/browse/" + encodeURIComponent(row.issueKey))}">${html(row.issueKey)}</a> · ${html(row.issueType)}<br>${html(row.summary.slice(0, 240))}`;
    const authors = row.contextOnly
      ? "— <i>контекст</i>"
      : row.authors.map((author) => html(author.displayName)).join(", ");
    widgets.push({
      columns: {
        columnItems: [
          {
            horizontalSizeStyle: "FILL_AVAILABLE_SPACE",
            widgets: [{ textParagraph: { text: issue } }],
          },
          {
            horizontalSizeStyle: "FILL_AVAILABLE_SPACE",
            widgets: [{ textParagraph: { text: authors } }],
          },
        ],
      },
    });
  }
  return {
    text: `Зміни описів · ${report.period.date} · ${report.changedIssueCount} задач · ${report.boardName
      .replaceAll("<", "‹")
      .replaceAll(">", "›")
      .replace(/[\r\n]/g, " ")}`,
    cardsV2: [
      {
        cardId: `descriptions-${report.period.date}-${index + 1}`,
        card: {
          header: {
            title: "Зміни описів задач",
            subtitle: `${report.boardName.slice(0, 120)} · ${period} · ${index + 1}/${count}`,
          },
          sections: [{ widgets }],
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
  if (!report.changedIssueCount) return [];
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
