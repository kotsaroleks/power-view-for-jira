import {
  buildDescriptionChangeReport,
  descriptionReportPeriod,
  type DescriptionChangeReport,
} from "./description-report";
import type { ReportChangeEvent, ReportingIssueSnapshot } from "./reporting";
export const descriptionIssue = (
  id: string,
  parent?: string,
): ReportingIssueSnapshot => ({
  id,
  key: `TEST-${id}`,
  summary: `Task ${id}`,
  browseUrl: `https://fixture.atlassian.net/browse/TEST-${id}`,
  issueType: { id: "1", name: "Task" },
  status: { name: "Open" },
  sprintIds: [],
  ...(parent ? { parentId: parent, parentKey: `TEST-${parent}` } : {}),
});
export const descriptionEvent = (
  id: string,
  issueId = "2",
  author = "a",
  occurredAt = "2026-11-06T10:00:00Z",
): ReportChangeEvent => ({
  id,
  issueId,
  issueKey: `TEST-${issueId}`,
  type: "description-changed",
  occurredAt,
  actor: { id: author, displayName: author },
});
export function descriptionFixture(
  issues = [descriptionIssue("1"), descriptionIssue("2", "1")],
  events = [descriptionEvent("e")],
): DescriptionChangeReport {
  return buildDescriptionChangeReport({
    jiraBaseUrl: "https://fixture.atlassian.net",
    boardId: "7",
    boardName: "Test board",
    period: descriptionReportPeriod("2026-11-06"),
    generatedAt: "2026-11-06T19:05:00Z",
    issues,
    events,
  });
}
