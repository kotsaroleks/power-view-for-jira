import type { GanttScheduleModel, GanttTask } from "@power-view/domain";
import { DEFAULT_GANTT_FILTERS } from "@power-view/domain";
import { SettingsStore, type StorageArea } from "@power-view/storage";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JiraClient } from "@power-view/jira-client";

import { GanttView } from "./GanttView";
import { visibleGanttTasks } from "./ganttVisibility";

class MemoryStorage implements StorageArea {
  private readonly values = new Map<string, unknown>();

  get(keys: string | string[]): Promise<Record<string, unknown>> {
    const selected = Array.isArray(keys) ? keys : [keys];
    return Promise.resolve(
      Object.fromEntries(selected.map((key) => [key, this.values.get(key)])),
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.entries(items).forEach(([key, value]) => this.values.set(key, value));
    return Promise.resolve();
  }

  remove(keys: string | string[]): Promise<void> {
    const selected = Array.isArray(keys) ? keys : [keys];
    selected.forEach((key) => this.values.delete(key));
    return Promise.resolve();
  }
}

function task(overrides: Partial<GanttTask> = {}): GanttTask {
  return {
    id: "1",
    issueKey: "POWER-1",
    browseUrl: "https://example.atlassian.net/browse/POWER-1",
    name: "Plan release",
    start: "2026-07-20",
    end: "2026-07-28",
    progress: 50,
    progressSource: "status",
    depth: 0,
    expanded: false,
    statusName: "In Progress",
    statusCategory: "in-progress",
    assigneeName: "Alex Rivera",
    issueTypeName: "Epic",
    isSyntheticDate: false,
    startSource: "jira",
    endSource: "jira",
    dependencies: [],
    ...overrides,
  };
}

const parent = task();
const child = task({
  id: "2",
  issueKey: "POWER-2",
  browseUrl: "https://example.atlassian.net/browse/POWER-2",
  name: "Ship timeline",
  parentId: "1",
  depth: 1,
  start: "2026-07-22",
  end: "2026-07-25",
  progress: 100,
  progressSource: "subtasks",
  statusName: "Done",
  statusCategory: "done",
  issueTypeName: "Task",
  isSyntheticDate: true,
  startSource: "created",
  endSource: "default-duration",
  dateWarning: "Dates were inferred.",
});
const independent = task({
  id: "3",
  issueKey: "POWER-3",
  browseUrl: "https://example.atlassian.net/browse/POWER-3",
  name: "Publish notes",
  start: "2026-07-24",
  end: "2026-07-27",
  statusName: "To Do",
  statusCategory: "to-do",
  progress: 0,
  dependencies: ["2"],
});
const model: GanttScheduleModel = {
  roots: [],
  tasks: [parent, child, independent],
  warnings: [
    {
      issueKey: "POWER-2",
      code: "INVALID_START_DATE",
      message: "Invalid Jira start was ignored.",
    },
  ],
  syntheticDateCount: 1,
  dependencyCount: 1,
};

function dragModel(taskOverrides: Partial<GanttTask> = {}): GanttScheduleModel {
  const dragged = task(taskOverrides);
  return {
    roots: [],
    tasks: [dragged],
    warnings: [],
    syntheticDateCount: 0,
    dependencyCount: 0,
  };
}

function editingContext(updateIssueDates = vi.fn().mockResolvedValue(undefined)) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const client = {
    getIssueEditMetadata: vi.fn().mockResolvedValue({
      fields: {
        startdate: {
          id: "startdate",
          name: "Start date",
          required: false,
          operations: ["set"],
          schema: { type: "date" },
        },
        duedate: {
          id: "duedate",
          name: "Due date",
          required: false,
          operations: ["set"],
          schema: { type: "date" },
        },
      },
    }),
    getIssueLinkTypes: vi.fn().mockResolvedValue([]),
    updateIssueDates,
  } as unknown as JiraClient;
  return { editing: { client, fieldMapping: {}, refresh }, updateIssueDates, refresh };
}

async function beginMove() {
  const bar = document.querySelector<HTMLButtonElement>(".gantt-task-bar");
  if (!bar) throw new Error("Gantt bar not found");
  bar.setPointerCapture = vi.fn();
  vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 300,
    top: 0,
    bottom: 20,
    width: 300,
    height: 20,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  await act(async () => {
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerMove(window, { clientX: 140, pointerId: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    fireEvent.pointerUp(window, { clientX: 140, pointerId: 1 });
  });
}

describe("visibleGanttTasks", () => {
  it("preserves roots while hiding descendants of collapsed ancestors", () => {
    expect(
      visibleGanttTasks(model.tasks, new Set()).map((item) => item.issueKey),
    ).toEqual(["POWER-1", "POWER-3"]);
    expect(
      visibleGanttTasks(model.tasks, new Set(["1"])).map((item) => item.issueKey),
    ).toEqual(["POWER-1", "POWER-2", "POWER-3"]);
  });
});

describe("GanttView", () => {
  it("cycles the Issue column header through ascending, descending, and off", () => {
    render(<GanttView model={model} today="2026-07-23" />);
    const issueKeyOrder = () =>
      [...document.querySelectorAll(".gantt-issue-cell strong")].map(
        (node) => node.textContent,
      );
    const header = screen.getByRole("button", {
      name: "Sort Issue within each hierarchy level",
    });
    const columnHeader = screen.getByRole("columnheader", { name: "Issue" });

    expect(issueKeyOrder()).toEqual(["POWER-1", "POWER-3"]);

    fireEvent.click(header);
    expect(columnHeader).toHaveAttribute("aria-sort", "ascending");
    expect(issueKeyOrder()).toEqual(["POWER-1", "POWER-3"]);

    fireEvent.click(header);
    expect(columnHeader).toHaveAttribute("aria-sort", "descending");
    expect(issueKeyOrder()).toEqual(["POWER-3", "POWER-1"]);

    fireEvent.click(header);
    expect(columnHeader).toHaveAttribute("aria-sort", "none");
    expect(issueKeyOrder()).toEqual(["POWER-1", "POWER-3"]);
  });

  it("shows the original and derived estimates for the selected task", () => {
    render(
      <GanttView
        model={{
          ...model,
          tasks: [
            task({
              originalEstimateDays: 5,
              nonWorkingDays: 2,
              calendarDaysEstimate: 7,
            }),
          ],
        }}
        today="2026-07-23"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select POWER-1: Plan release" }));

    expect(screen.getByText("Original estimate")).toBeInTheDocument();
    expect(screen.getByText("5 working days")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("7 calendar days")).toBeInTheDocument();
  });

  it("keeps a click separate from a small drag", async () => {
    const context = editingContext();
    render(<GanttView model={dragModel()} editing={context.editing} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Jira" }));
    const bar = document.querySelector<HTMLButtonElement>(".gantt-task-bar");
    if (!bar) throw new Error("Gantt bar not found");
    bar.setPointerCapture = vi.fn();
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 300,
      top: 0,
      bottom: 20,
      width: 300,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await act(async () => {
      fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    });
    fireEvent.pointerMove(window, { clientX: 102, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 102, pointerId: 1 });
    fireEvent.click(bar);
    expect(
      screen.getByRole("heading", { name: /POWER-1 · Plan release/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(context.updateIssueDates).not.toHaveBeenCalled();
  });

  it("opens confirmation with both moved Jira dates", async () => {
    render(<GanttView model={dragModel()} editing={editingContext().editing} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Jira" }));
    await beginMove();
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Save start 2026-07-22 and due 2026-07-30 in Jira?",
    );
  });

  it("saves only the changed dates and refreshes", async () => {
    const context = editingContext();
    render(<GanttView model={dragModel()} editing={context.editing} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Jira" }));
    await beginMove();
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(context.updateIssueDates).toHaveBeenCalledWith("POWER-1", {
        fieldMapping: {},
        startDate: "2026-07-22",
        dueDate: "2026-07-30",
      }),
    );
    expect(context.refresh).toHaveBeenCalledOnce();
  });

  it("cancels without writing", async () => {
    const context = editingContext();
    render(<GanttView model={dragModel()} editing={context.editing} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Jira" }));
    await beginMove();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(context.updateIssueDates).not.toHaveBeenCalled();
  });

  it("does not drag a task whose Jira date is inferred", () => {
    render(
      <GanttView
        model={dragModel({ startSource: "created" })}
        editing={editingContext().editing}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Jira" }));
    const bar = document.querySelector<HTMLButtonElement>(".gantt-task-bar");
    if (!bar) throw new Error("Gantt bar not found");
    bar.setPointerCapture = vi.fn();
    // Mock the bar's rect so the pointerdown at clientX 100 lands away from the
    // 8px edge zones and resolves to a "move" gesture (center of a 300px-wide
    // bar) rather than being misclassified as a resize against a default
    // zero-width rect, which only requires the touched side to be Jira-backed.
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 300,
      top: 0,
      bottom: 20,
      width: 300,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 140, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 140, pointerId: 1 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("freezes the confirmation preview after pointerup", async () => {
    render(<GanttView model={dragModel()} editing={editingContext().editing} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Jira" }));
    await beginMove();
    const dialog = await screen.findByRole("dialog");
    fireEvent.pointerMove(window, { clientX: 900, pointerId: 1 });
    expect(await screen.findByRole("dialog")).toHaveTextContent(dialog.textContent ?? "");
    expect(await screen.findByRole("dialog")).toHaveTextContent("2026-07-22");
  });
  it("keeps the issue tree synchronized with the timeline and persists expansion", () => {
    const view = render(<GanttView model={model} today="2026-07-23" />);

    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
    expect(
      screen.queryByRole("button", { name: /Select POWER-2: Ship timeline/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand POWER-1" }));
    expect(
      screen.getByRole("button", { name: /Select POWER-2: Ship timeline/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "4");

    view.rerender(<GanttView model={{ ...model }} today="2026-07-23" />);
    expect(
      screen.getByRole("button", { name: /Select POWER-2: Ship timeline/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse POWER-1" }));
    expect(
      screen.queryByRole("button", { name: /Select POWER-2: Ship timeline/ }),
    ).not.toBeInTheDocument();
  });

  it("renders a date-misalignment indicator, composing with the blocked indicator", () => {
    const misalignedAndBlocked = task({
      id: "10",
      issueKey: "POWER-10",
      name: "Rolled-up epic",
      hasDateMisalignment: true,
      isBlocked: true,
    });
    const misalignedModel: GanttScheduleModel = {
      roots: [],
      tasks: [misalignedAndBlocked],
      warnings: [],
      syntheticDateCount: 0,
      dependencyCount: 0,
    };

    render(<GanttView model={misalignedModel} today="2026-07-23" />);

    const bar = screen.getByRole("button", {
      name: /Select POWER-10.*blocked.*date mismatch with rollup/,
    });
    expect(bar).toHaveClass("is-blocked");
    expect(bar).toHaveClass("date-misaligned");
  });

  it("supports zoom, today, task selection, details, warnings, and Jira navigation", () => {
    render(<GanttView model={model} today="2026-07-23" />);

    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Today, 2026-07-23")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Expand POWER-1" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Select POWER-2: Ship timeline/ }),
    );

    expect(
      screen.getByRole("heading", { name: "POWER-2 · Ship timeline" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Completed subtasks")).toBeInTheDocument();
    expect(screen.getByText("Created date")).toBeInTheDocument();
    expect(screen.getByText("Default duration")).toBeInTheDocument();
    expect(screen.getByText("Invalid Jira start was ignored.")).toBeInTheDocument();
    expect(screen.getByText("Dates were inferred.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Jira ↗" })).toHaveAttribute(
      "href",
      "https://example.atlassian.net/browse/POWER-2",
    );
  });

  it("keeps Jira writes behind Edit mode, edit metadata, and confirmation", async () => {
    const updateIssueDates = vi.fn().mockResolvedValue(undefined);
    const assignIssue = vi.fn().mockResolvedValue(undefined);
    const createIssueLink = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const client = {
      getIssueEditMetadata: vi.fn().mockResolvedValue({
        fields: {
          startdate: {
            id: "startdate",
            name: "Start date",
            required: false,
            operations: ["set"],
            schema: { type: "date" },
          },
          duedate: {
            id: "duedate",
            name: "Due date",
            required: false,
            operations: ["set"],
            schema: { type: "date" },
          },
          assignee: {
            id: "assignee",
            name: "Assignee",
            required: false,
            operations: ["set"],
            schema: { type: "user" },
          },
        },
      }),
      getIssueLinkTypes: vi.fn().mockResolvedValue([
        {
          id: "10000",
          name: "Blocks",
          inward: "is blocked by",
          outward: "blocks",
        },
      ]),
      findAssignableUsers: vi.fn().mockResolvedValue([
        {
          accountId: "account-2",
          displayName: "Morgan Lee",
          emailAddress: "morgan@example.com",
        },
      ]),
      updateIssueDates,
      assignIssue,
      createIssueLink,
    } as unknown as JiraClient;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <GanttView
        model={model}
        today="2026-07-23"
        editing={{ client, fieldMapping: {}, refresh }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select POWER-1: Plan release" }));
    expect(screen.queryByText("Update POWER-1 in Jira")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Jira" }));
    expect(await screen.findByText("Update POWER-1 in Jira")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-07-21" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save dates" }));

    await waitFor(() =>
      expect(updateIssueDates).toHaveBeenCalledWith("POWER-1", {
        fieldMapping: {},
        startDate: "2026-07-21",
      }),
    );
    expect(confirm).toHaveBeenCalledWith("Update dates for POWER-1 in Jira?");
    expect(refresh).toHaveBeenCalledOnce();
    expect(await screen.findByText("Dates saved in Jira.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search assignable users"), {
      target: { value: "Morgan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByRole("option", {
      name: "Morgan Lee · morgan@example.com",
    });
    fireEvent.click(screen.getByRole("button", { name: "Save assignee" }));
    await waitFor(() =>
      expect(assignIssue).toHaveBeenCalledWith("POWER-1", {
        accountId: "account-2",
        displayName: "Morgan Lee",
        emailAddress: "morgan@example.com",
      }),
    );

    fireEvent.change(screen.getByLabelText("Depends on"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add dependency" }));
    await waitFor(() =>
      expect(createIssueLink).toHaveBeenCalledWith({
        typeName: "Blocks",
        inwardIssueKey: "POWER-3",
        outwardIssueKey: "POWER-1",
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(3);
    confirm.mockRestore();
  });

  it("filters key and summary while preserving a muted, expanded ancestor path", () => {
    render(<GanttView model={model} today="2026-07-23" />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "ship TIMELINE" },
    });

    const childSelector = screen.getByRole("button", {
      name: "Select POWER-2: Ship timeline",
    });
    expect(childSelector).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "POWER-1 expanded for filter results",
      }),
    ).toBeDisabled();
    expect(
      screen
        .getByRole("button", { name: "Select POWER-1: Plan release" })
        .closest(".gantt-grid-row"),
    ).toHaveClass("is-filter-context");
    expect(screen.getByText("1 match · 2 rows")).toBeInTheDocument();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");

    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(
      screen.queryByRole("button", { name: "Select POWER-2: Ship timeline" }),
    ).not.toBeInTheDocument();
  });

  it("combines multi-select filters with AND and reports an empty result", () => {
    render(<GanttView model={model} today="2026-07-23" />);

    fireEvent.click(screen.getByLabelText("Category: All categories"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Category: Done" }));
    fireEvent.click(screen.getByLabelText("Issue type: All types"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Issue type: Task" }));
    fireEvent.click(screen.getByLabelText("Date quality: All dates"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Date quality: Fully inferred" }),
    );

    expect(
      screen.getByRole("button", { name: "Select POWER-2: Ship timeline" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select POWER-3: Publish notes" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "does-not-exist" },
    });
    expect(screen.getByText("No issues match these filters.")).toBeInTheDocument();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "1");
  });

  it("selects multiple values and switches dropdown groups from AND to OR", () => {
    render(<GanttView model={model} today="2026-07-23" />);

    fireEvent.click(screen.getByLabelText("Category: All categories"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Category: Done" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Category: To do" }));

    expect(screen.getByLabelText("Category: To do, Done")).toBeInTheDocument();
    expect(screen.getByText("2 matches · 3 rows")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Issue type: All types"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Issue type: Epic" }));

    expect(screen.getByText("1 match · 1 row")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AND" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "OR" }));

    expect(screen.getByText("3 matches · 3 rows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OR" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("optionally includes descendants of a matching task", () => {
    render(<GanttView model={model} today="2026-07-23" />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "Plan release" },
    });
    expect(
      screen.queryByRole("button", { name: "Select POWER-2: Ship timeline" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Include descendants" }));
    expect(
      screen.getByRole("button", { name: "Select POWER-2: Ship timeline" }),
    ).toBeInTheDocument();
  });

  it("virtualizes a 1,000-task result while preserving the full grid row count", () => {
    const largeModel: GanttScheduleModel = {
      roots: [],
      tasks: Array.from({ length: 1_000 }, (_, index) =>
        task({
          id: String(index + 1),
          issueKey: `POWER-${index + 1}`,
          browseUrl: `https://example.atlassian.net/browse/POWER-${index + 1}`,
          name: `Sanitized planning task ${index + 1}`,
        }),
      ),
      warnings: [],
      syntheticDateCount: 0,
      dependencyCount: 0,
    };
    const view = render(<GanttView model={largeModel} today="2026-07-23" />);
    const grid = screen.getByRole("grid");

    expect(grid).toHaveAttribute("aria-rowcount", "1001");
    expect(view.container.querySelectorAll(".gantt-grid-row").length).toBeLessThan(40);
    expect(screen.getByText(/DOM rows rendered/)).toBeInTheDocument();

    grid.scrollTop = 20_000;
    fireEvent.scroll(grid);
    const renderedIndices = [...view.container.querySelectorAll(".gantt-grid-row")].map(
      (row) => Number(row.getAttribute("aria-rowindex")),
    );
    expect(Math.min(...renderedIndices)).toBeGreaterThan(2);
    expect(view.container.querySelectorAll(".gantt-timeline-cell")).toHaveLength(
      view.container.querySelectorAll(".gantt-issue-cell").length,
    );
  });

  it("loads and saves board-scoped workspace filter preferences", async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.saveGanttFilters("https://example.atlassian.net", "POWER:7", {
      ...DEFAULT_GANTT_FILTERS,
      search: "Publish notes",
    });
    render(
      <GanttView
        model={model}
        today="2026-07-23"
        filterPersistence={{
          store,
          jiraBaseUrl: "https://example.atlassian.net",
          workspaceKey: "POWER:7",
        }}
      />,
    );

    expect(await screen.findByDisplayValue("Publish notes")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select POWER-3: Publish notes" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), {
      target: { value: "Plan release" },
    });
    await waitFor(() =>
      expect(
        store.getGanttFilters("https://example.atlassian.net", "POWER:7"),
      ).resolves.toMatchObject({ search: "Plan release" }),
    );
  });

  it("resets view preferences when the next workspace has none", async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.saveGanttViewPreferences("https://example.atlassian.net", "POWER:7", {
      zoom: "month",
      sortBy: "issueKey",
      sortDirection: "desc",
    });
    const view = render(
      <GanttView
        model={model}
        today="2026-07-23"
        filterPersistence={{
          store,
          jiraBaseUrl: "https://example.atlassian.net",
          workspaceKey: "POWER:7",
        }}
      />,
    );

    expect(await screen.findByRole("button", { name: /Sort Issue/ })).toHaveTextContent(
      "Issue ▼",
    );

    view.rerender(
      <GanttView
        model={model}
        today="2026-07-23"
        filterPersistence={{
          store,
          jiraBaseUrl: "https://example.atlassian.net",
          workspaceKey: "POWER:8",
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Sort Issue/ })).toHaveTextContent(
        "Issue",
      ),
    );
  });
});
