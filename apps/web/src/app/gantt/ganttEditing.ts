import { isJiraClientError, type JiraIssueEditField } from "@power-view/jira-client";

export function editableField(field: JiraIssueEditField | undefined): boolean {
  return Boolean(
    field && (field.operations.length === 0 || field.operations.includes("set")),
  );
}

export function jiraDateValue(value: string, field: JiraIssueEditField | undefined) {
  if (!value) {
    return null;
  }
  if (field?.schema?.type?.toLowerCase() !== "datetime") {
    return value;
  }

  const [year, month, day] = value.split("-").map(Number);
  const localNoon = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12);
  const offsetMinutes = -localNoon.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const minutes = String(absoluteOffset % 60).padStart(2, "0");
  return `${value}T12:00:00.000${sign}${hours}${minutes}`;
}

export function mutationErrorMessage(error: unknown): string {
  return isJiraClientError(error)
    ? (error.appError.details ?? error.appError.message)
    : "Jira could not apply this change. Reload the issue and retry.";
}
