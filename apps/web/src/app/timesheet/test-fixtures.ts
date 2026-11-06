import type {
  TimesheetApi,
  TimesheetIssue,
  TimesheetWorklog,
} from "@power-view/jira-client";
import { vi } from "vitest";
import { dayInZone } from "./timesheet-model";
export const testIssue: TimesheetIssue = {
  id: "1",
  key: "PV-1",
  summary: "Release task",
  projectId: "100",
  projectKey: "PV",
};
export function testLog(
  id = "10",
  started = `${dayInZone(new Date(), "Europe/Kyiv")}T10:00:00+0200`,
  seconds = 1800,
): TimesheetWorklog {
  return {
    id,
    issueId: "1",
    issueKey: "PV-1",
    authorId: "me",
    started,
    timeSpentSeconds: seconds,
    updated: "2026-10-27T12:00:00Z",
    commentText: "Review",
  };
}
export function testApi() {
  return {
    getWorklogBoards: vi
      .fn<TimesheetApi["getWorklogBoards"]>()
      .mockResolvedValue([{ id: 1, name: "Power View" }]),
    getBoardPickerIssues: vi
      .fn<TimesheetApi["getBoardPickerIssues"]>()
      .mockResolvedValue([
        {
          ...testIssue,
          typeName: "Task",
          hierarchyLevel: 0,
          subtask: false,
          assigneeId: "me",
          parentKey: null,
        },
      ]),
    getUser: vi.fn<TimesheetApi["getUser"]>().mockResolvedValue({
      accountId: "me",
      displayName: "Alex",
      timeZone: "Europe/Kyiv",
    }),
    search: vi
      .fn<TimesheetApi["search"]>()
      .mockResolvedValue({ issues: [testIssue], isLast: true }),
    searchProjects: vi
      .fn<TimesheetApi["searchProjects"]>()
      .mockResolvedValue([{ id: "100", key: "PV", name: "Power View" }]),
    getIssue: vi.fn<TimesheetApi["getIssue"]>().mockResolvedValue(testIssue),
    getWorklogs: vi
      .fn<TimesheetApi["getWorklogs"]>()
      .mockResolvedValue([testLog(), testLog("11", undefined, 2700)]),
    getWorklog: vi.fn<TimesheetApi["getWorklog"]>().mockResolvedValue(testLog()),
    saveWorklog: vi.fn<TimesheetApi["saveWorklog"]>().mockResolvedValue(testLog("12")),
    deleteWorklog: vi.fn<TimesheetApi["deleteWorklog"]>().mockResolvedValue(undefined),
  };
}
