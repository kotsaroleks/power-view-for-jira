import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Timesheet } from "./Timesheet";
import { testApi, testIssue, testLog } from "./test-fixtures";
import type { WorklogPickerIssue } from "@power-view/jira-client";
const props = { baseUrl: "https://jira.test", accountId: "me", userName: "Alex" };
function boardIssue(
  id: string,
  assigneeId: string | null = null,
  parentKey: string | null = null,
  typeName = "Task",
): WorklogPickerIssue {
  return {
    ...testIssue,
    id,
    key: `PV-${id}`,
    summary: `Task ${id}`,
    assigneeId,
    parentKey,
    typeName,
    hierarchyLevel: typeName === "Epic" ? 1 : typeName === "Subtask" ? -1 : 0,
    subtask: typeName === "Subtask",
  };
}
function rememberBoard(pins: string[] = []) {
  localStorage.setItem(
    "power-view:weekly-tasks:v1:https://jira.test:me",
    JSON.stringify({ boardId: 1, pins: { "1": pins } }),
  );
}
function visibleIssueKeys() {
  return within(screen.getByRole("table"))
    .queryAllByRole("link")
    .map((link) => link.textContent);
}
describe("Weekly task rows", () => {
  beforeEach(() => localStorage.clear());
  it("cancels a newly pinned issue read without leaving the existing table stuck loading", async () => {
    rememberBoard();
    const other = boardIssue("20");
    const api = testApi();
    api.search.mockResolvedValue({ issues: [], isLast: true });
    api.getBoardPickerIssues.mockResolvedValue([other]);
    api.getWorklogs.mockImplementation(() => new Promise(() => {}));
    render(<Timesheet api={api} {...props} />);
    const pin = await screen.findByRole("button", { name: "Pin PV-20" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Refresh$/ })).toBeEnabled(),
    );
    fireEvent.click(pin);
    await waitFor(() => expect(api.getWorklogs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Unpin PV-20" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Refresh$/ })).toBeEnabled(),
    );
    expect(
      screen.getAllByRole("button", { name: /PV-20, .*enter hours/ })[0],
    ).toBeEnabled();
    expect(api.saveWorklog).not.toHaveBeenCalled();
  });
  it("shows an assigned task without worklogs, pins it across weeks, and scopes pins to account", async () => {
    const api = testApi();
    api.search.mockResolvedValue({ issues: [], isLast: true });
    api.getWorklogs.mockResolvedValue([]);
    api.getBoardPickerIssues.mockResolvedValue([
      {
        ...testIssue,
        typeName: "Task",
        hierarchyLevel: 0,
        assigneeId: "me",
        parentKey: null,
        subtask: false,
      },
    ]);
    const view = render(<Timesheet api={api} {...props} />);
    await screen.findByRole("option", { name: "Power View" });
    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "1" } });
    const pin = await screen.findByRole("button", { name: "Pin PV-1" });
    fireEvent.click(pin);
    expect(screen.getAllByRole("textbox", { name: /PV-1, .*hours/ })).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));
    await screen.findByRole("button", { name: "Unpin PV-1" });
    await waitFor(() =>
      expect(
        screen.getAllByRole("textbox", { name: /PV-1, .*hours/ })[0],
      ).not.toBeDisabled(),
    );
    view.unmount();
    const reopened = render(<Timesheet api={api} {...props} />);
    await screen.findByRole("button", { name: "Unpin PV-1" });
    reopened.unmount();
    const otherApi = testApi();
    otherApi.getUser.mockResolvedValue({ accountId: "another", displayName: "Other" });
    otherApi.search.mockResolvedValue({ issues: [], isLast: true });
    otherApi.getWorklogs.mockResolvedValue([]);
    render(<Timesheet api={otherApi} {...props} accountId="another" />);
    await screen.findByRole("option", { name: "Power View" });
    expect(screen.getByLabelText("Board")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Unpin PV-1" })).toBeNull();
  });
  it("orders foreign pins, this week's own logs, assigned tasks, then other board tasks without duplicates", async () => {
    rememberBoard(["PV-4"]);
    const pinned = boardIssue("4", "other");
    const logged = boardIssue("2", "me");
    const assigned = boardIssue("3", "me");
    const other = boardIssue("5");
    const outside = boardIssue("6", "other");
    const api = testApi();
    api.getBoardPickerIssues.mockResolvedValue([other, assigned, logged, pinned]);
    api.search.mockResolvedValue({ issues: [logged, pinned, outside], isLast: true });
    api.getWorklogs.mockImplementation((issue) =>
      Promise.resolve(
        ["2", "4", "6"].includes(issue.id)
          ? [{ ...testLog(`log-${issue.id}`), issueId: issue.id, issueKey: issue.key }]
          : [],
      ),
    );
    render(<Timesheet api={api} {...props} />);
    await screen.findByRole("button", { name: "Unpin PV-4" });
    await waitFor(() => expect(visibleIssueKeys()).toContain("PV-3"));
    const keys = visibleIssueKeys();
    expect(keys[0]).toBe("PV-4");
    expect(keys.indexOf("PV-2")).toBeLessThan(keys.indexOf("PV-3"));
    expect(keys.indexOf("PV-6")).toBeLessThan(keys.indexOf("PV-3"));
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      screen.queryByRole("combobox", { name: /Epic or Story|Add issue to table/ }),
    ).toBeNull();
    expect(screen.getByRole("combobox", { name: "Board" })).toBeVisible();
  });
  it("keeps this week's own time outside the board when switching boards", async () => {
    rememberBoard();
    const outside = boardIssue("8", "other");
    const api = testApi();
    api.getWorklogBoards.mockResolvedValue([
      { id: 1, name: "Power View" },
      { id: 2, name: "Second board" },
    ]);
    api.search.mockResolvedValue({ issues: [outside], isLast: true });
    api.getWorklogs.mockImplementation((issue) =>
      Promise.resolve(
        issue.id === outside.id
          ? [{ ...testLog(), issueId: outside.id, issueKey: outside.key }]
          : [],
      ),
    );
    api.getBoardPickerIssues.mockImplementation((id) =>
      Promise.resolve(id === 1 ? [boardIssue("3", "me")] : [boardIssue("7", "me")]),
    );
    render(<Timesheet api={api} {...props} />);
    await screen.findByRole("button", { name: "Pin PV-3" });
    expect(visibleIssueKeys()).toContain("PV-8");
    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "2" } });
    await screen.findByRole("button", { name: "Pin PV-7" });
    await waitFor(() => expect(visibleIssueKeys()).not.toContain("PV-3"));
    expect(visibleIssueKeys().filter((key) => key === "PV-8")).toHaveLength(1);
    expect(visibleIssueKeys().indexOf("PV-8")).toBeLessThan(
      visibleIssueKeys().indexOf("PV-7"),
    );
  });
  it("shows other board tasks in a collapsed hierarchy with unparented tasks and no task selectors", async () => {
    rememberBoard();
    const epic = boardIssue("10", null, null, "Epic");
    const story = boardIssue("11", null, epic.key, "Story");
    const subtask = boardIssue("12", null, story.key, "Subtask");
    const orphan = boardIssue("13");
    const assignedChild = boardIssue("14", "me", epic.key, "Story");
    const api = testApi();
    api.search.mockResolvedValue({ issues: [], isLast: true });
    api.getWorklogs.mockResolvedValue([]);
    api.getBoardPickerIssues.mockResolvedValue([
      subtask,
      story,
      orphan,
      epic,
      assignedChild,
    ]);
    render(<Timesheet api={api} {...props} />);
    const expandEpic = await screen.findByRole("button", { name: "Expand PV-10" });
    expect(expandEpic).toHaveAttribute("aria-expanded", "false");
    expect(visibleIssueKeys()).toContain("PV-10");
    expect(visibleIssueKeys()).toContain("PV-13");
    expect(visibleIssueKeys()).toContain("PV-14");
    expect(visibleIssueKeys()).not.toContain("PV-11");
    expect(visibleIssueKeys()).not.toContain("PV-12");
    expect(screen.getByText("Without parent issue")).toBeVisible();
    expect(
      api.getWorklogs.mock.calls.some(
        ([issue]) => issue.id === story.id || issue.id === subtask.id,
      ),
    ).toBe(false);
    fireEvent.click(expandEpic);
    const expandStory = await screen.findByRole("button", { name: "Expand PV-11" });
    expect(visibleIssueKeys()).not.toContain("PV-12");
    fireEvent.click(expandStory);
    await waitFor(() => expect(visibleIssueKeys()).toContain("PV-12"));
    const keys = visibleIssueKeys();
    expect(keys.indexOf("PV-10")).toBeLessThan(keys.indexOf("PV-11"));
    expect(keys.indexOf("PV-11")).toBeLessThan(keys.indexOf("PV-12"));
    expect(keys.filter((key) => key === "PV-14")).toHaveLength(1);
    expect(
      screen.queryByRole("combobox", { name: /Epic or Story|Add issue to table/ }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse PV-10" }));
    await waitFor(() => expect(visibleIssueKeys()).not.toContain("PV-11"));
    expect(visibleIssueKeys()).not.toContain("PV-12");
    expect(visibleIssueKeys()).toContain("PV-14");
    expect(api.saveWorklog).not.toHaveBeenCalled();
  });
  it("reads an unvisited board task on cell entry and focuses inline hours without opening a form", async () => {
    rememberBoard();
    const other = boardIssue("20");
    const untouched = boardIssue("21");
    const api = testApi();
    api.search.mockResolvedValue({ issues: [], isLast: true });
    api.getWorklogs.mockResolvedValue([]);
    api.getBoardPickerIssues.mockResolvedValue([other, untouched]);
    render(<Timesheet api={api} {...props} />);
    const cells = await screen.findAllByRole("button", { name: /PV-20, .*enter hours/ });
    expect(cells[0]).toHaveTextContent("?");
    expect(api.getWorklogs).not.toHaveBeenCalled();
    await waitFor(() => expect(cells[0]).not.toBeDisabled());
    fireEvent.click(cells[0]!);
    const inputs = await screen.findAllByRole("textbox", { name: /PV-20, .*hours/ });
    await waitFor(() => expect(inputs[0]).toHaveFocus());
    expect(api.getWorklogs.mock.calls.some(([issue]) => issue.id === "20")).toBe(true);
    expect(api.getWorklogs.mock.calls.some(([issue]) => issue.id === "21")).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.saveWorklog).not.toHaveBeenCalled();
  });
  it("opens multiple worklogs in details rather than allowing aggregate edits", async () => {
    render(<Timesheet api={testApi()} {...props} />);
    const cell = await screen.findByRole("button", { name: /PV-1, .*2 worklogs/ });
    fireEvent.click(cell);
    expect(screen.getByRole("region", { name: "Worklog details" })).toHaveTextContent(
      "2 worklogs",
    );
    expect(screen.getByRole("button", { name: "Edit worklog 10" })).toBeVisible();
  });
});
