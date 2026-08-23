import type { GanttScheduleModel, GanttTask } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import type { GanttBoardState } from "@power-view/storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { dependencyTypeFromEdges } from "./dependency-types";
import { GanttV2 } from "./GanttV2";

function task(overrides: Partial<GanttTask> = {}): GanttTask {
  return {
    id: "1",
    issueKey: "POWER-1",
    browseUrl: "https://example.atlassian.net/browse/POWER-1",
    name: "Plan release",
    start: "2026-08-17",
    end: "2026-08-21",
    progress: 50,
    progressSource: "status",
    depth: 0,
    expanded: true,
    statusName: "In Progress",
    statusCategory: "in-progress",
    assigneeName: "Alex Rivera",
    issueTypeName: "Task",
    scheduleState: "confirmed",
    isSyntheticDate: false,
    startSource: "jira",
    endSource: "jira",
    originalEstimateDays: 5,
    nonWorkingDays: 0,
    calendarDaysEstimate: 5,
    dependencies: [],
    ...overrides,
  };
}

const secondTask = task({
  id: "2",
  issueKey: "POWER-2",
  name: "Ship release",
  start: "2026-08-24",
  end: "2026-08-28",
  statusName: "To Do",
  statusCategory: "to-do",
});

function model(tasks: GanttTask[]): GanttScheduleModel {
  return {
    roots: [],
    tasks,
    warnings: [],
    syntheticDateCount: 0,
    dependencyCount: 0,
  };
}

function editing() {
  const updateIssueDates = vi.fn().mockResolvedValue(undefined);
  const findAssignableUsers = vi.fn().mockResolvedValue([
    {
      accountId: "maya-account",
      displayName: "Maya Singh",
      emailAddress: "maya@example.com",
    },
  ]);
  const assignIssue = vi.fn().mockResolvedValue(undefined);
  const getIssueTransitions = vi.fn().mockResolvedValue([
    {
      id: "31",
      name: "Send to review",
      toStatusName: "In Review",
    },
    {
      id: "41",
      name: "Complete",
      toStatusName: "Done",
    },
  ]);
  const transitionIssue = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  return {
    context: {
      client: {
        updateIssueDates,
        findAssignableUsers,
        assignIssue,
        getIssueTransitions,
        transitionIssue,
      } as unknown as JiraClient,
      fieldMapping: {},
      refresh,
    },
    updateIssueDates,
    findAssignableUsers,
    assignIssue,
    getIssueTransitions,
    transitionIssue,
    refresh,
  };
}

function drag(element: Element, startX: number, endX: number) {
  fireEvent.pointerDown(element, { clientX: startX, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: endX, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: endX, pointerId: 1 });
}

describe("GanttV2", () => {
  it("renders a synchronized Wrike-style table and timeline with core controls", () => {
    render(<GanttV2 model={model([task(), secondTask])} today="2026-08-20" />);

    expect(screen.getByRole("grid", { name: "Gantt tasks" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Timeline" })).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "Resize task table" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "POWER-1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move POWER-1" })).toBeInTheDocument();
  });

  it("shows Epic, Story, Bug, and Subtask icons immediately before the task text", () => {
    render(
      <GanttV2
        model={model([
          task({ id: "epic", issueKey: "POWER-EPIC", issueTypeName: "Epic" }),
          task({ id: "story", issueKey: "POWER-STORY", issueTypeName: "Story" }),
          task({ id: "bug", issueKey: "POWER-BUG", issueTypeName: "Bug" }),
          task({ id: "subtask", issueKey: "POWER-SUB", issueTypeName: "Sub-task" }),
        ])}
        today="2026-08-20"
      />,
    );

    (
      [
        ["POWER-EPIC", "Epic issue type"],
        ["POWER-STORY", "Story issue type"],
        ["POWER-BUG", "Bug issue type"],
        ["POWER-SUB", "Subtask issue type"],
      ] as const
    ).forEach(([issueKey, label]) => {
      const row = screen.getByRole("row", { name: new RegExp(issueKey) });
      const icon = row.querySelector(`[aria-label="${label}"]`);
      const taskText = row.querySelector(".gantt-v2-task-text");
      expect(icon).toBeInTheDocument();
      expect(icon?.nextElementSibling).toBe(taskText);
    });
  });

  it("marks root rows across the table and timeline without marking their children", () => {
    const epic = task({
      id: "epic",
      issueKey: "POWER-EPIC",
      issueTypeName: "Epic",
    });
    const child = task({
      id: "child",
      issueKey: "POWER-CHILD",
      issueTypeName: "Story",
      parentId: epic.id,
      depth: 1,
    });
    const independentBug = task({
      id: "independent-bug",
      issueKey: "POWER-BUG",
      issueTypeName: "Bug",
    });

    const { container } = render(
      <GanttV2 model={model([epic, child, independentBug])} today="2026-08-20" />,
    );

    expect(screen.getByRole("row", { name: /POWER-EPIC/ })).toHaveClass("is-root");
    expect(screen.getByRole("row", { name: /POWER-CHILD/ })).not.toHaveClass("is-root");
    expect(screen.getByRole("row", { name: /POWER-BUG/ })).toHaveClass("is-root");
    expect(
      container.querySelector('.gantt-v2-timeline-row[data-task-id="epic"]'),
    ).toHaveClass("is-root");
    expect(
      container.querySelector('.gantt-v2-timeline-row[data-task-id="child"]'),
    ).not.toHaveClass("is-root");
    expect(
      container.querySelector('.gantt-v2-timeline-row[data-task-id="independent-bug"]'),
    ).toHaveClass("is-root");
  });

  it("keeps an embedded epic rollup schedule read-only but allows status and assignee edits", () => {
    const edit = editing();
    const epic = task({
      id: "epic-1",
      issueKey: "POWER-EPIC",
      name: "Release epic",
      issueTypeName: "Epic",
      isHierarchyPlaceholder: true,
      expanded: true,
      scheduleState: "rollup",
      startSource: "children",
      endSource: "children",
    });
    const child = task({
      id: "story-1",
      issueKey: "POWER-STORY",
      name: "Release story",
      parentId: epic.id,
      depth: 1,
    });

    render(
      <GanttV2 model={model([epic, child])} today="2026-08-20" editing={edit.context} />,
    );

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "POWER-EPIC",
      "POWER-STORY",
    ]);
    expect(screen.queryByRole("button", { name: "Move POWER-EPIC" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Resize start of POWER-EPIC" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Dependency from start of POWER-EPIC/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit assignee for POWER-EPIC" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit status for POWER-EPIC" }),
    ).toBeInTheDocument();
  });

  it("reveals every child when the final visible parent is expanded", () => {
    const parent = task({
      id: "parent",
      issueKey: "POWER-PARENT",
      name: "Last parent",
      expanded: false,
    });
    const child = task({
      id: "child",
      issueKey: "POWER-CHILD",
      name: "Last child",
      parentId: parent.id,
      depth: 1,
    });

    render(<GanttV2 model={model([task(), parent, child])} today="2026-08-20" />);

    expect(screen.queryByRole("link", { name: "POWER-CHILD" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand POWER-PARENT" }));
    expect(screen.getByRole("link", { name: "POWER-CHILD" })).toBeInTheDocument();
  });

  it("hides the disclosure when every child is completed and hidden", () => {
    const parent = task({
      id: "parent",
      issueKey: "POWER-PARENT",
      name: "Parent with completed child",
      expanded: false,
    });
    const completedChild = task({
      id: "completed-child",
      issueKey: "POWER-DONE",
      name: "Completed child",
      parentId: parent.id,
      depth: 1,
      statusName: "Done",
      statusCategory: "done",
    });

    render(
      <GanttV2
        model={model([parent, completedChild])}
        today="2026-08-20"
        initialHideCompleted
      />,
    );

    expect(screen.queryByRole("link", { name: "POWER-DONE" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand POWER-PARENT" })).toBeNull();
  });

  it("uses a dedicated review colour instead of the In Progress blue", () => {
    render(
      <GanttV2
        model={model([
          task({
            statusName: "In Review",
            statusCategory: "in-progress",
          }),
        ])}
        today="2026-08-20"
      />,
    );

    const moveButton = screen.getByRole("button", { name: "Move POWER-1" });
    expect(moveButton.parentElement).toHaveStyle({
      background: "var(--gantt-v2-review)",
    });
    expect(screen.getByRole("gridcell", { name: "In Review" })).toHaveClass("is-review");
  });

  it("searches Jira assignees and saves the selected user immediately", async () => {
    const edit = editing();
    render(<GanttV2 model={model([task()])} today="2026-08-20" editing={edit.context} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit assignee for POWER-1" }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search assignee for POWER-1" }),
      { target: { value: "Maya" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Search Jira users" }));

    await waitFor(() =>
      expect(edit.findAssignableUsers).toHaveBeenCalledWith("POWER-1", "Maya"),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Assign POWER-1 to Maya Singh" }),
    );

    await waitFor(() =>
      expect(edit.assignIssue).toHaveBeenCalledWith("POWER-1", {
        accountId: "maya-account",
        displayName: "Maya Singh",
        emailAddress: "maya@example.com",
      }),
    );
    expect(edit.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save assignee" }),
    ).not.toBeInTheDocument();
  });

  it("closes the assignee editor without changing Jira", () => {
    const edit = editing();
    render(<GanttV2 model={model([task()])} today="2026-08-20" editing={edit.context} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit assignee for POWER-1" }));
    expect(
      screen.getByRole("dialog", { name: "Edit assignee for POWER-1" }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Close assignee editor for POWER-1",
      }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Edit assignee for POWER-1" }),
    ).not.toBeInTheDocument();
    expect(edit.findAssignableUsers).not.toHaveBeenCalled();
    expect(edit.assignIssue).not.toHaveBeenCalled();
    expect(edit.refresh).not.toHaveBeenCalled();
  });

  it("dismisses the assignee editor with Escape, outside click, or trigger toggle", () => {
    const edit = editing();
    render(<GanttV2 model={model([task()])} today="2026-08-20" editing={edit.context} />);

    const trigger = screen.getByRole("button", {
      name: "Edit assignee for POWER-1",
    });
    const editor = () =>
      screen.queryByRole("dialog", { name: "Edit assignee for POWER-1" });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(editor()).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(editor()).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(editor()).not.toBeInTheDocument();
    expect(edit.assignIssue).not.toHaveBeenCalled();
  });

  it("loads valid Jira transitions and changes status immediately", async () => {
    const edit = editing();
    render(<GanttV2 model={model([task()])} today="2026-08-20" editing={edit.context} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit status for POWER-1" }));

    await waitFor(() => expect(edit.getIssueTransitions).toHaveBeenCalledWith("POWER-1"));
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Change status for POWER-1" }),
      { target: { value: "31" } },
    );

    await waitFor(() =>
      expect(edit.transitionIssue).toHaveBeenCalledWith("POWER-1", "31"),
    );
    expect(edit.refresh).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Edit status for POWER-1" }),
    ).toHaveTextContent("In Review");
    expect(
      screen.queryByRole("dialog", { name: "Change status for POWER-1" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save status" })).not.toBeInTheDocument();
  });

  it("closes the status dropdown without changing Jira", async () => {
    const edit = editing();
    render(<GanttV2 model={model([task()])} today="2026-08-20" editing={edit.context} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit status for POWER-1" }));
    expect(
      await screen.findByRole("dialog", { name: "Change status for POWER-1" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Close status editor for POWER-1" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Change status for POWER-1" }),
    ).not.toBeInTheDocument();
    expect(edit.transitionIssue).not.toHaveBeenCalled();
    expect(edit.refresh).not.toHaveBeenCalled();
  });

  it("dismisses the status dropdown with Escape, outside click, or trigger toggle", async () => {
    const edit = editing();
    render(<GanttV2 model={model([task()])} today="2026-08-20" editing={edit.context} />);

    const trigger = screen.getByRole("button", {
      name: "Edit status for POWER-1",
    });
    const editor = () =>
      screen.queryByRole("dialog", { name: "Change status for POWER-1" });

    fireEvent.click(trigger);
    await screen.findByRole("combobox", { name: "Change status for POWER-1" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(editor()).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(editor()).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(editor()).not.toBeInTheDocument();
    expect(edit.transitionIssue).not.toHaveBeenCalled();
  });

  it("applies and reports board-scoped zoom and sorting preferences", () => {
    const onViewPreferencesChange = vi.fn();
    render(
      <GanttV2
        model={model([task(), secondTask])}
        today="2026-08-20"
        initialViewPreferences={{
          zoom: "month",
          sortBy: "name",
          sortDirection: "desc",
        }}
        onViewPreferencesChange={onViewPreferencesChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Sort tasks" })).toHaveValue("name");
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "POWER-2",
      "POWER-1",
    ]);

    fireEvent.change(screen.getByRole("combobox", { name: "Sort tasks" }), {
      target: { value: "issueKey" },
    });

    expect(onViewPreferencesChange).toHaveBeenLastCalledWith({
      zoom: "month",
      sortBy: "issueKey",
      sortDirection: "desc",
    });
  });

  it("applies and reports the persisted search and completed filter", () => {
    const onSearchChange = vi.fn();
    const onHideCompletedChange = vi.fn();
    render(
      <GanttV2
        model={model([
          task(),
          secondTask,
          task({
            id: "3",
            issueKey: "POWER-3",
            name: "Completed release",
            statusName: "Done",
            statusCategory: "done",
          }),
        ])}
        today="2026-08-20"
        initialSearch="release"
        initialHideCompleted
        onSearchChange={onSearchChange}
        onHideCompletedChange={onHideCompletedChange}
      />,
    );

    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue(
      "release",
    );
    expect(
      screen.getByRole("checkbox", { name: "Hide completed matching tasks" }),
    ).toBeChecked();
    expect(screen.queryByRole("link", { name: "POWER-3" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), {
      target: { value: "ship" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Hide completed matching tasks" }),
    );

    expect(onSearchChange).toHaveBeenCalledWith("ship");
    expect(onHideCompletedChange).toHaveBeenCalledWith(false);
  });

  it("moves a whole task and saves immediately without a confirmation dialog", async () => {
    const edit = editing();
    render(<GanttV2 model={model([task()])} today="2026-08-20" editing={edit.context} />);

    act(() => drag(screen.getByRole("button", { name: "Move POWER-1" }), 100, 148));

    await waitFor(() =>
      expect(edit.updateIssueDates).toHaveBeenCalledWith("POWER-1", {
        fieldMapping: {},
        startDate: "2026-08-19",
        dueDate: "2026-08-23",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(edit.refresh).toHaveBeenCalledOnce();
  });

  it("resizes one edge and writes only the changed Jira date", async () => {
    const edit = editing();
    render(<GanttV2 model={model([task()])} today="2026-08-20" editing={edit.context} />);

    act(() =>
      drag(screen.getByRole("button", { name: "Resize end of POWER-1" }), 100, 124),
    );

    await waitFor(() =>
      expect(edit.updateIssueDates).toHaveBeenCalledWith("POWER-1", {
        fieldMapping: {},
        dueDate: "2026-08-22",
      }),
    );
    expect(screen.queryByText(/Save due/i)).not.toBeInTheDocument();
  });

  it("writes a moved task and every downstream cascade in one gesture", async () => {
    const edit = editing();
    const onBoardStateChange = vi.fn().mockResolvedValue(undefined);
    render(
      <GanttV2
        model={model([
          task(),
          {
            ...secondTask,
            start: "2026-08-24",
            end: "2026-08-26",
          },
        ])}
        today="2026-08-20"
        editing={edit.context}
        nonWorkingDays={[0, 6]}
        boardState={{
          dependencies: [
            {
              id: "POWER-1:POWER-2:FS",
              predecessorIssueKey: "POWER-1",
              successorIssueKey: "POWER-2",
              type: "FS",
              lagWorkingDays: 0,
            },
          ],
          reconciledDates: {},
        }}
        onBoardStateChange={onBoardStateChange}
      />,
    );

    act(() => drag(screen.getByRole("button", { name: "Move POWER-1" }), 100, 196));

    await waitFor(() => expect(edit.updateIssueDates).toHaveBeenCalledTimes(2));
    expect(edit.updateIssueDates).toHaveBeenNthCalledWith(1, "POWER-1", {
      fieldMapping: {},
      startDate: "2026-08-21",
      dueDate: "2026-08-25",
    });
    expect(edit.updateIssueDates).toHaveBeenNthCalledWith(2, "POWER-2", {
      fieldMapping: {},
      startDate: "2026-08-26",
      dueDate: "2026-08-28",
    });
    expect(edit.refresh).toHaveBeenCalledOnce();
    expect(onBoardStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciledDates: {
          "POWER-1": { startDate: "2026-08-21", dueDate: "2026-08-25" },
          "POWER-2": { startDate: "2026-08-26", dueDate: "2026-08-28" },
        },
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("schedules an Unscheduled task with two dates, ordering them automatically", async () => {
    const edit = editing();
    const unscheduled = task({
      id: "3",
      issueKey: "POWER-3",
      name: "Unscheduled work",
      scheduleState: "unscheduled",
      startSource: "today",
      endSource: "default-duration",
      isSyntheticDate: true,
    });
    render(
      <GanttV2 model={model([unscheduled])} today="2026-08-20" editing={edit.context} />,
    );

    const firstDate = screen.getByRole("button", {
      name: "Set POWER-3 date 2026-08-24",
    });
    fireEvent.click(firstDate);
    expect(screen.getByText("Choose the second date")).toBeInTheDocument();
    expect(firstDate).toHaveAttribute("aria-pressed", "true");
    expect(edit.updateIssueDates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Set POWER-3 date 2026-08-20" }));

    expect(
      await screen.findByRole("button", { name: "Move POWER-3" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Unscheduled — click twice to set dates"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Set POWER-3 date/ }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(edit.updateIssueDates).toHaveBeenCalledWith("POWER-3", {
        fieldMapping: {},
        startDate: "2026-08-20",
        dueDate: "2026-08-24",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("maps task edges to all four dependency relationships", () => {
    expect(dependencyTypeFromEdges("end", "start")).toBe("FS");
    expect(dependencyTypeFromEdges("end", "end")).toBe("FF");
    expect(dependencyTypeFromEdges("start", "start")).toBe("SS");
    expect(dependencyTypeFromEdges("start", "end")).toBe("SF");
  });

  it("creates a dependency by dragging from one task edge to another", async () => {
    const onBoardStateChange = vi.fn().mockResolvedValue(undefined);
    const boardState: GanttBoardState = { dependencies: [], reconciledDates: {} };
    render(
      <GanttV2
        model={model([task(), secondTask])}
        today="2026-08-20"
        boardState={boardState}
        onBoardStateChange={onBoardStateChange}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Dependency from end of POWER-1" }),
      { pointerId: 2 },
    );
    fireEvent.pointerUp(
      screen.getByRole("button", { name: "Dependency to start of POWER-2" }),
      { pointerId: 2 },
    );

    await waitFor(() => expect(onBoardStateChange).toHaveBeenCalledOnce());
    expect(onBoardStateChange.mock.calls[0]?.[0]).toMatchObject({
      dependencies: [
        {
          predecessorIssueKey: "POWER-1",
          successorIssueKey: "POWER-2",
          type: "FS",
          lagWorkingDays: 0,
        },
      ],
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders stored dependencies as labelled timeline arrows", () => {
    render(
      <GanttV2
        model={model([task(), secondTask])}
        today="2026-08-20"
        boardState={{
          dependencies: [
            {
              id: "POWER-1:POWER-2:FS",
              predecessorIssueKey: "POWER-1",
              successorIssueKey: "POWER-2",
              type: "FS",
              lagWorkingDays: 0,
            },
          ],
          reconciledDates: {},
        }}
      />,
    );

    expect(
      screen.getByRole("img", { name: "FS dependency POWER-1 to POWER-2" }),
    ).toBeInTheDocument();
  });

  it("highlights an external Jira change and repairs only downstream tasks on demand", async () => {
    const edit = editing();
    const onBoardStateChange = vi.fn().mockResolvedValue(undefined);
    render(
      <GanttV2
        model={model([
          task({ start: "2026-08-21", end: "2026-08-25" }),
          { ...secondTask, start: "2026-08-24", end: "2026-08-26" },
        ])}
        today="2026-08-20"
        editing={edit.context}
        nonWorkingDays={[0, 6]}
        boardState={{
          dependencies: [
            {
              id: "POWER-1:POWER-2:FS",
              predecessorIssueKey: "POWER-1",
              successorIssueKey: "POWER-2",
              type: "FS",
              lagWorkingDays: 0,
            },
          ],
          reconciledDates: {
            "POWER-1": { startDate: "2026-08-17", dueDate: "2026-08-21" },
            "POWER-2": { startDate: "2026-08-24", dueDate: "2026-08-26" },
          },
        }}
        onBoardStateChange={onBoardStateChange}
      />,
    );

    expect(screen.getByRole("row", { name: /POWER-1/ })).toHaveClass(
      "is-external-conflict",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "POWER-1 changed in Jira without its dependent schedule",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Repair schedule automatically" }),
    );

    await waitFor(() => expect(edit.updateIssueDates).toHaveBeenCalledOnce());
    expect(edit.updateIssueDates).toHaveBeenCalledWith("POWER-2", {
      fieldMapping: {},
      startDate: "2026-08-26",
      dueDate: "2026-08-28",
    });
    expect(edit.refresh).toHaveBeenCalledOnce();
    expect(onBoardStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciledDates: {
          "POWER-1": { startDate: "2026-08-21", dueDate: "2026-08-25" },
          "POWER-2": { startDate: "2026-08-26", dueDate: "2026-08-28" },
        },
      }),
    );
  });

  it("keeps externally changed Jira dates untouched for manual correction", () => {
    const edit = editing();
    render(
      <GanttV2
        model={model([
          task({ start: "2026-08-21", end: "2026-08-25" }),
          { ...secondTask, start: "2026-08-24", end: "2026-08-26" },
        ])}
        today="2026-08-20"
        editing={edit.context}
        boardState={{
          dependencies: [
            {
              id: "POWER-1:POWER-2:FS",
              predecessorIssueKey: "POWER-1",
              successorIssueKey: "POWER-2",
              type: "FS",
              lagWorkingDays: 0,
            },
          ],
          reconciledDates: {
            "POWER-1": { startDate: "2026-08-17", dueDate: "2026-08-21" },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep Jira dates" }));

    expect(edit.updateIssueDates).not.toHaveBeenCalled();
    expect(screen.getByRole("row", { name: /POWER-1/ })).toHaveClass(
      "is-external-conflict",
    );
    expect(screen.getByRole("status")).toHaveTextContent("No Jira dates were changed");
  });
});
