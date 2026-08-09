import type {
  GeneratedReportSnapshot,
  ReportLanguage,
  PersonReportBlock,
} from "@power-view/domain";

import { buildActivityLog } from "./activity-log";

function dateTime(value: string, language: ReportLanguage): string {
  return new Intl.DateTimeFormat(language === "uk" ? "uk-UA" : "en-GB", {
    timeZone: "Europe/Kyiv",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function hours(seconds: number, language: ReportLanguage): string {
  const value = (seconds / 3_600).toFixed(1);
  return language === "uk" ? `${value} год` : `${value}h`;
}

function personBlock(block: PersonReportBlock, language: ReportLanguage): string[] {
  const uk = language === "uk";
  const heading = block.user.displayName;
  const done = uk ? "Виконано" : "Done";
  const active = uk ? "Поточні задачі" : "Current tasks";
  const logged = uk ? "Залоговано" : "Logged";
  const changedHeading = uk ? "Змінені задачі" : "Changed issues";
  const lines = [
    heading,
    `- ${done}: ${block.completedIssues.length}`,
    `- ${active}: ${block.assignedIssues.length}`,
    `- ${logged}: ${hours(block.worklogSeconds, language)}`,
  ];
  const activityLog = buildActivityLog(block.changes);
  if (activityLog.length > 0) {
    lines.push(`- ${changedHeading}:`);
    for (const entry of activityLog) {
      lines.push(
        `  - ${entry.issueKey}: ${entry.change} (${dateTime(entry.occurredAt, language)})`,
      );
    }
  }
  return lines;
}

export function renderStandupText(
  snapshot: GeneratedReportSnapshot,
  language: ReportLanguage,
): string {
  const summary = snapshot.result.executiveSummary;
  const uk = language === "uk";
  const lines = [
    `${uk ? "Звіт" : "Report"}: ${snapshot.request.type.toUpperCase()} · ${snapshot.board.name}`,
    `${uk ? "Період" : "Period"}: ${dateTime(snapshot.request.period.start, language)} — ${dateTime(snapshot.request.period.end, language)}`,
    `${uk ? "Станом на" : "Data as of"}: ${dateTime(snapshot.request.period.dataCutoff, language)}`,
    "",
    uk ? "Executive Summary" : "Executive Summary",
    `- ${uk ? "Задачі" : "Issues"}: ${summary.totalIssues}`,
    `- ${uk ? "Виконано" : "Completed"}: ${summary.completedIssues}`,
    `- ${uk ? "Створено за період" : "Created in period"}: ${summary.createdIssues}`,
    `- ${uk ? "Завершено за період" : "Completed in period"}: ${summary.completedDuringPeriod}`,
    `- ${uk ? "Worklog" : "Worklog"}: ${hours(summary.worklogSeconds, language)}`,
    `- ${uk ? "Без виконавця" : "Unassigned"}: ${summary.unassignedIssues}`,
  ];
  if (snapshot.result.sprint) {
    const sprint = snapshot.result.sprint;
    const percentage =
      sprint.completion.percentage === null
        ? "N/A"
        : `${sprint.completion.percentage.toFixed(1)}%`;
    lines.push(`- ${uk ? "Виконання спринту" : "Sprint completion"}: ${percentage}`);
    lines.push(
      `- ${uk ? "Додано після старту" : "Added after start"}: ${sprint.addedAfterStart.length}`,
    );
    lines.push(
      `- ${uk ? "Виключено після старту" : "Removed after start"}: ${sprint.removedAfterStart.length}`,
    );
  }
  lines.push("", uk ? "Учасники" : "People");
  for (const block of snapshot.result.people)
    lines.push(...personBlock(block, language), "");
  lines.push(
    uk ? "Unassigned" : "Unassigned",
    `- ${uk ? "Задачі" : "Issues"}: ${snapshot.result.unassigned.issues.length}`,
  );
  if (snapshot.completeness.warnings.length > 0) {
    lines.push("", uk ? "Попередження" : "Warnings");
    for (const warning of snapshot.completeness.warnings)
      lines.push(`- ${warning.message}`);
  }
  return lines.join("\n");
}
