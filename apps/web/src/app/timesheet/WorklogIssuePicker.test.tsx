import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorklogPickerIssue } from "@power-view/jira-client";
import { WorklogIssuePicker } from "./WorklogIssuePicker";
import { pickerGroups } from "./issue-picker-model";
import { WorklogForm } from "./WorklogForm";
import { testApi, testIssue } from "./test-fixtures";
const baseUrl = "https://jira.test";
const key = `power-view:worklog-picker:v1:${baseUrl}:me`;
function issue(
  key: string,
  typeName: string,
  parentKey: string | null,
  assigneeId: string | null = null,
): WorklogPickerIssue {
  return {
    ...testIssue,
    id: key.split("-")[1]!,
    key,
    summary: `${typeName} ${key}`,
    typeName,
    parentKey,
    assigneeId,
    hierarchyLevel: typeName === "Epic" ? 1 : typeName === "Subtask" ? -1 : 0,
    subtask: typeName === "Subtask",
  };
}
const issues = [
  issue("PV-1", "Epic", null, "me"),
  issue("PV-2", "Story", "PV-1", "me"),
  issue("PV-3", "Task", null, "me"),
  issue("PV-4", "Subtask", "PV-2", "me"),
  issue("PV-5", "Story", "PV-1"),
  issue("PV-6", "Subtask", "PV-2"),
  issue("PV-7", "Subtask", "PV-5"),
  issue("PV-8", "Task", null, "someone-else"),
];
function setup() {
  const api = testApi();
  api.getWorklogBoards.mockResolvedValue([
    { id: 1, name: "Alpha" },
    { id: 2, name: "Beta" },
  ]);
  api.getBoardPickerIssues.mockResolvedValue(issues);
  const onSelect = vi.fn();
  return {
    api,
    onSelect,
    element: (
      <WorklogIssuePicker
        api={api}
        baseUrl={baseUrl}
        accountId="me"
        onSelect={onSelect}
      />
    ),
  };
}
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
describe("Board worklog picker", () => {
  beforeEach(() => localStorage.clear());
  it("puts all four assigned types first without duplicates below", () => {
    const groups = pickerGroups(issues, "me", "");
    expect(groups[0]?.issues.map((item) => item.key)).toEqual([
      "PV-1",
      "PV-2",
      "PV-3",
      "PV-4",
    ]);
    expect(groups[1]?.issues.map((item) => item.key)).toEqual([
      "PV-5",
      "PV-6",
      "PV-7",
      "PV-8",
    ]);
  });
  it("groups Epic subtasks by Story in one visible list and retains board assignments first", () => {
    const groups = pickerGroups(issues, "me", "PV-1");
    expect(groups.map((group) => group.issues.map((item) => item.key))).toEqual([
      ["PV-1", "PV-2", "PV-3", "PV-4"],
      ["PV-6"],
      ["PV-7"],
    ]);
    expect(
      pickerGroups(issues, "me", "PV-2")
        .slice(1)
        .flatMap((group) => group.issues.map((item) => item.key)),
    ).toEqual(["PV-6"]);
  });
  it("remembers explicit board selection and favorites, scoped by board", async () => {
    const { api, onSelect, element } = setup();
    const mounted = render(element);
    await screen.findByRole("option", { name: "Alpha" });
    expect(api.getBoardPickerIssues).not.toHaveBeenCalled();
    change("Board", "1");
    await screen.findByRole("button", { name: /PV-8.*Task/ });
    fireEvent.click(screen.getByRole("button", { name: "Show children of PV-1" }));
    fireEvent.click(screen.getByRole("button", { name: "☆ Add favorite" }));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      boardId: 1,
      favorites: { "1": ["PV-1"] },
    });
    expect(
      within(screen.getByLabelText("Jira issue"))
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual([
      "Assigned to me",
      "Other issues · PV-2 Story PV-2",
      "Other issues · PV-5 Story PV-5",
    ]);
    fireEvent.click(screen.getByRole("button", { name: /PV-7.*Subtask/ }));
    expect(onSelect).toHaveBeenCalledWith(issues[6]);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Board" })).toBeVisible();
    mounted.unmount();
    render(element);
    await screen.findByRole("button", { name: "PV-1 · Epic PV-1" });
    expect(screen.getByLabelText("Board")).toHaveValue("1");
    change("Board", "2");
    await screen.findByRole("group", { name: "Epic or Story" });
    expect(
      screen.queryByRole("button", { name: "PV-1 · Epic PV-1" }),
    ).not.toBeInTheDocument();
  });
  it("does not reuse another account's board", async () => {
    localStorage.setItem(
      key,
      JSON.stringify({ boardId: 1, favorites: { "1": ["PV-1"] } }),
    );
    const { api } = setup();
    render(
      <WorklogIssuePicker
        api={api}
        baseUrl={baseUrl}
        accountId="other"
        onSelect={vi.fn()}
      />,
    );
    await screen.findByRole("option", { name: "Alpha" });
    expect(api.getBoardPickerIssues).not.toHaveBeenCalled();
  });
  it("discards a late response from the previous board", async () => {
    const { api, element } = setup();
    let resolve!: (issues: WorklogPickerIssue[]) => void;
    api.getBoardPickerIssues.mockImplementation((boardId) =>
      boardId === 1
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve([issue("PV-9", "Task", null)]),
    );
    render(element);
    await screen.findByRole("option", { name: "Alpha" });
    change("Board", "1");
    await waitFor(() =>
      expect(api.getBoardPickerIssues).toHaveBeenCalledWith(1, expect.any(AbortSignal)),
    );
    change("Board", "2");
    await screen.findByRole("button", { name: /PV-9.*Task/ });
    resolve(issues);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /PV-8.*Task/ }),
      ).not.toBeInTheDocument(),
    );
  });
  it("shows an error and allows retry", async () => {
    const { api, element } = setup();
    api.getBoardPickerIssues.mockRejectedValueOnce(
      new Error("Incomplete board issue list."),
    );
    render(element);
    await screen.findByRole("option", { name: "Alpha" });
    change("Board", "1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Incomplete board issue list.",
    );
    expect(screen.queryByRole("group", { name: "Jira issue" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: /PV-8.*Task/ });
  });
  it("preserves duration and description while changing the issue", async () => {
    const { api } = setup();
    render(
      <WorklogForm
        api={api}
        baseUrl={baseUrl}
        accountId="me"
        timeZone="Europe/Kyiv"
        initialDay="2026-11-01"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    change("Duration", "2h");
    change("Work description (optional)", "Review");
    await screen.findByRole("option", { name: "Alpha" });
    change("Board", "1");
    await screen.findByRole("button", { name: /PV-8.*Task/ });
    fireEvent.click(screen.getByRole("button", { name: /PV-8.*Task/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change issue" }));
    await screen.findByRole("group", { name: "Jira issue" });
    expect(screen.getByLabelText("Duration")).toHaveValue("2h");
    expect(screen.getByLabelText("Work description (optional)")).toHaveValue("Review");
  });
});
