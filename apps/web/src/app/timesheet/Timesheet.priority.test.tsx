import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorklogPickerIssue } from "@power-view/jira-client";
import { Timesheet } from "./Timesheet";
import { testApi, testIssue, testLog } from "./test-fixtures";

const targetUrl = "https://stryker-emergencycare.atlassian.net";
function issue(
  number: string,
  typeName = "Task",
  parentKey: string | null = null,
  assigneeId: string | null = null,
): WorklogPickerIssue {
  return {
    ...testIssue,
    id: number,
    key: `LBR-${number}`,
    summary: `Priority fixture ${number}`,
    typeName,
    hierarchyLevel: typeName === "Epic" ? 1 : typeName === "Subtask" ? -1 : 0,
    subtask: typeName === "Subtask",
    parentKey,
    assigneeId,
  };
}
const epic = issue("68393", "Epic");
const story = issue("68394", "Story", epic.key);
const child = issue("68395", "Subtask", story.key);
const assigned = issue("10", "Task", null, "me");
const other = issue("11");
function setup(
  baseUrl = targetUrl,
  pins: string[] = [],
  logged: WorklogPickerIssue[] = [],
) {
  localStorage.setItem(
    `power-view:weekly-tasks:v1:${baseUrl}:me`,
    JSON.stringify({ boardId: 1, pins: { "1": pins } }),
  );
  const api = testApi();
  api.getBoardPickerIssues.mockResolvedValue([assigned, other, child, story, epic]);
  api.search.mockResolvedValue({ issues: logged, isLast: true });
  api.getWorklogs.mockImplementation((selected) =>
    Promise.resolve(
      logged.some((candidate) => candidate.id === selected.id)
        ? [{ ...testLog(selected.id), issueId: selected.id, issueKey: selected.key }]
        : [],
    ),
  );
  const view = render(
    <Timesheet api={api} baseUrl={baseUrl} accountId="me" userName="Alex" />,
  );
  return { api, view };
}
function keys() {
  return within(screen.getByRole("table"))
    .getAllByRole("link")
    .map((link) => link.textContent);
}
describe("Weekly priority hierarchy", () => {
  beforeEach(() => localStorage.clear());
  it("seeds the requested Epic only on the target Jira instance, after pins and logs and before assigned tasks", async () => {
    setup(targetUrl, [child.key], [story]);
    await screen.findByRole("button", { name: `Unpin ${child.key}` });
    await waitFor(() => expect(keys()).toContain(assigned.key));
    expect(keys().indexOf(child.key)).toBeLessThan(keys().indexOf(story.key));
    expect(keys().indexOf(story.key)).toBeLessThan(keys().indexOf(epic.key));
    expect(keys().indexOf(epic.key)).toBeLessThan(keys().indexOf(assigned.key));
    expect(keys().indexOf(assigned.key)).toBeLessThan(keys().indexOf(other.key));
    expect(new Set(keys()).size).toBe(keys().length);
    const expand = screen.getByRole("button", { name: `Expand ${epic.key}` });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(keys().filter((key) => key === story.key)).toHaveLength(1);
    expect(keys().filter((key) => key === child.key)).toHaveLength(1);
  });
  it("keeps the priority subtree collapsed and expands Epic then Story without duplicating any issue", async () => {
    setup();
    const expand = await screen.findByRole("button", { name: `Expand ${epic.key}` });
    expect(keys()).not.toContain(story.key);
    expect(keys()).not.toContain(child.key);
    fireEvent.click(expand);
    const expandStory = await screen.findByRole("button", {
      name: `Expand ${story.key}`,
    });
    expect(keys()).toContain(story.key);
    expect(keys()).not.toContain(child.key);
    fireEvent.click(expandStory);
    await waitFor(() => expect(keys()).toContain(child.key));
    expect(keys().indexOf(epic.key)).toBeLessThan(keys().indexOf(story.key));
    expect(keys().indexOf(story.key)).toBeLessThan(keys().indexOf(child.key));
    expect(keys().indexOf(child.key)).toBeLessThan(keys().indexOf(assigned.key));
    expect(new Set(keys()).size).toBe(keys().length);
    fireEvent.click(screen.getByRole("button", { name: `Collapse ${epic.key}` }));
    expect(keys()).not.toContain(story.key);
    expect(keys()).not.toContain(child.key);
  });
  it("does not seed LBR-68393 on another Jira instance", async () => {
    setup("https://jira.test");
    await screen.findByRole("button", { name: `Expand ${epic.key}` });
    await waitFor(() => expect(keys()).toContain(assigned.key));
    expect(keys().indexOf(assigned.key)).toBeLessThan(keys().indexOf(epic.key));
  });
  it("uses explicitly stored priority issue keys on other Jira instances without promoting unrelated Epics", async () => {
    const baseUrl = "https://jira.test";
    localStorage.setItem(
      `power-view:weekly-priority:v1:${baseUrl}:me`,
      JSON.stringify([other.key]),
    );
    setup(baseUrl);
    await screen.findByRole("button", { name: `Expand ${epic.key}` });
    await waitFor(() => expect(keys()).toContain(assigned.key));
    expect(keys().indexOf(other.key)).toBeLessThan(keys().indexOf(assigned.key));
    expect(keys().indexOf(assigned.key)).toBeLessThan(keys().indexOf(epic.key));
  });
});
