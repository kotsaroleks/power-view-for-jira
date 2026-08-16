import type { GanttTask } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GanttEditPanel, type GanttEditingContext } from "./GanttEditPanel";

function task(overrides: Partial<GanttTask>): GanttTask {
  const id = overrides.id ?? "1";
  return {
    id,
    issueKey: overrides.issueKey ?? `POWER-${id}`,
    browseUrl: `https://example.atlassian.net/browse/POWER-${id}`,
    name: `Task ${id}`,
    start: "2026-07-20",
    end: "2026-07-22",
    progress: 0,
    progressSource: "none",
    depth: 0,
    expanded: false,
    statusName: "To Do",
    statusCategory: "to-do",
    issueTypeName: "Task",
    isSyntheticDate: false,
    startSource: "jira",
    endSource: "jira",
    dependencies: [],
    ...overrides,
  };
}

function editingContext(): GanttEditingContext {
  const client = {
    getIssueEditMetadata: vi.fn().mockResolvedValue({ fields: {} }),
    getIssueLinkTypes: vi
      .fn()
      .mockResolvedValue([
        { id: "10000", name: "Blocks", inward: "is blocked by", outward: "blocks" },
      ]),
  } as unknown as JiraClient;
  return { client, fieldMapping: {}, refresh: vi.fn().mockResolvedValue(undefined) };
}

async function dependsOnOptionLabels(): Promise<string[]> {
  const select = await screen.findByLabelText("Depends on");
  return within(select)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "")
    .filter((text) => text !== "Choose an issue");
}

describe("GanttEditPanel dependency candidates", () => {
  it("only offers Epic candidates for an Epic", async () => {
    const epic = task({ id: "1", issueKey: "POWER-1", issueTypeName: "Epic" });
    const otherEpic = task({ id: "2", issueKey: "POWER-2", issueTypeName: "Epic" });
    const story = task({ id: "3", issueKey: "POWER-3", issueTypeName: "Story" });

    render(
      <GanttEditPanel
        task={epic}
        tasks={[epic, otherEpic, story]}
        editing={editingContext()}
      />,
    );

    expect(await dependsOnOptionLabels()).toEqual(["POWER-2 · Task 2"]);
  });

  it("only offers Stories within the same Epic", async () => {
    const story = task({
      id: "1",
      issueKey: "POWER-1",
      issueTypeName: "Story",
      parentId: "epic-1",
    });
    const sameEpicStory = task({
      id: "2",
      issueKey: "POWER-2",
      issueTypeName: "Story",
      parentId: "epic-1",
    });
    const otherEpicStory = task({
      id: "3",
      issueKey: "POWER-3",
      issueTypeName: "Story",
      parentId: "epic-2",
    });
    const epic = task({ id: "4", issueKey: "POWER-4", issueTypeName: "Epic" });

    render(
      <GanttEditPanel
        task={story}
        tasks={[story, sameEpicStory, otherEpicStory, epic]}
        editing={editingContext()}
      />,
    );

    expect(await dependsOnOptionLabels()).toEqual(["POWER-2 · Task 2"]);
  });

  it("only offers Tasks/Bugs within the same Story, and treats Task/Bug as one group", async () => {
    const currentTask = task({
      id: "1",
      issueKey: "POWER-1",
      issueTypeName: "Task",
      parentId: "story-1",
    });
    const sameStoryBug = task({
      id: "2",
      issueKey: "POWER-2",
      issueTypeName: "Bug",
      parentId: "story-1",
    });
    const otherStoryTask = task({
      id: "3",
      issueKey: "POWER-3",
      issueTypeName: "Task",
      parentId: "story-2",
    });

    render(
      <GanttEditPanel
        task={currentTask}
        tasks={[currentTask, sameStoryBug, otherStoryTask]}
        editing={editingContext()}
      />,
    );

    expect(await dependsOnOptionLabels()).toEqual(["POWER-2 · Task 2"]);
  });

  it("offers parentless Tasks/Bugs to each other but not to a task with a parent", async () => {
    const orphanTask = task({ id: "1", issueKey: "POWER-1", issueTypeName: "Task" });
    const otherOrphanBug = task({ id: "2", issueKey: "POWER-2", issueTypeName: "Bug" });
    const parentedTask = task({
      id: "3",
      issueKey: "POWER-3",
      issueTypeName: "Task",
      parentId: "story-1",
    });

    render(
      <GanttEditPanel
        task={orphanTask}
        tasks={[orphanTask, otherOrphanBug, parentedTask]}
        editing={editingContext()}
      />,
    );

    expect(await dependsOnOptionLabels()).toEqual(["POWER-2 · Task 2"]);
  });

  it("excludes cross-type candidates entirely", async () => {
    const epic = task({ id: "1", issueKey: "POWER-1", issueTypeName: "Epic" });
    const story = task({
      id: "2",
      issueKey: "POWER-2",
      issueTypeName: "Story",
      parentId: "1",
    });

    render(
      <GanttEditPanel task={epic} tasks={[epic, story]} editing={editingContext()} />,
    );

    expect(await dependsOnOptionLabels()).toEqual([]);
  });
});
