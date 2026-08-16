import type { GanttScheduleModel, GanttTask } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import { useState } from "react";

import { GanttView } from "./GanttView";
import type { GanttEditingContext } from "./GanttEditPanel";

const browseUrl = (key: string) => `https://example.atlassian.net/browse/${key}`;

function task(overrides: Partial<GanttTask>): GanttTask {
  const issueKey = overrides.issueKey ?? "POWER-1";
  return {
    id: overrides.id ?? issueKey,
    issueKey,
    browseUrl: browseUrl(issueKey),
    name: "Deliver Power View schedule",
    start: "2026-07-18",
    end: "2026-08-07",
    progress: 42,
    progressSource: "children",
    depth: 0,
    expanded: false,
    statusName: "In Progress",
    statusCategory: "in-progress",
    priorityName: "Medium",
    labels: [],
    isResolved: false,
    isBlocked: false,
    blockedByTaskIds: [],
    assigneeName: "Maya Chen",
    issueTypeName: "Epic",
    isSyntheticDate: false,
    startSource: "jira",
    endSource: "jira",
    dependencies: [],
    ...overrides,
  };
}

const tasks = [
  task({ id: "epic", issueKey: "POWER-100", name: "Extension MVP" }),
  task({
    id: "ui",
    issueKey: "POWER-112",
    name: "Build synchronized Gantt workspace",
    parentId: "epic",
    depth: 1,
    start: "2026-07-20",
    end: "2026-07-29",
    progress: 64,
    progressSource: "jira-progress",
    issueTypeName: "Story",
  }),
  task({
    id: "zoom",
    issueKey: "POWER-113",
    name: "Add timeline zoom controls",
    parentId: "ui",
    depth: 2,
    start: "2026-07-22",
    end: "2026-07-24",
    progress: 100,
    progressSource: "status",
    statusName: "Done",
    statusCategory: "done",
    assigneeName: "Alex Rivera",
    issueTypeName: "Task",
    isResolved: true,
  }),
  task({
    id: "details",
    issueKey: "POWER-114",
    name: "Implement task details",
    parentId: "ui",
    depth: 2,
    start: "2026-07-24",
    end: "2026-07-28",
    progress: 50,
    progressSource: "status",
    assigneeName: "Sam Okafor",
    issueTypeName: "Task",
    dependencies: ["zoom"],
    isBlocked: false,
  }),
  task({
    id: "qa",
    issueKey: "POWER-120",
    name: "Browser interaction QA",
    parentId: "epic",
    depth: 1,
    start: "2026-07-30",
    end: "2026-08-04",
    progress: 0,
    progressSource: "status",
    statusName: "To Do",
    statusCategory: "to-do",
    assigneeName: "Priya Shah",
    issueTypeName: "Story",
    dependencies: ["ui"],
    isBlocked: true,
    blockedByTaskIds: ["ui"],
  }),
  task({
    id: "docs",
    issueKey: "POWER-126",
    name: "Publish usage notes",
    start: "2026-07-23",
    end: "2026-07-27",
    progress: 0,
    progressSource: "none",
    statusName: "Backlog",
    statusCategory: "unknown",
    assigneeName: "Unassigned",
    issueTypeName: "Task",
    isSyntheticDate: true,
    startSource: "created",
    endSource: "default-duration",
    dateWarning: "Schedule dates were inferred from the created date and task default.",
    dependencies: ["epic"],
    isBlocked: true,
    blockedByTaskIds: ["epic"],
  }),
];

const model: GanttScheduleModel = {
  roots: [],
  tasks,
  warnings: [],
  syntheticDateCount: 1,
  dependencyCount: 3,
};

const largeModel: GanttScheduleModel = {
  roots: [],
  tasks: Array.from({ length: 1_000 }, (_, index) => {
    const sequence = index + 1;
    const inferred = sequence % 4 === 0;
    const done = sequence % 3 === 0;
    const prerequisiteId =
      sequence === 5 || (sequence > 1 && sequence % 20 === 0)
        ? `large-${sequence - 1}`
        : undefined;
    return task({
      id: `large-${sequence}`,
      issueKey: `POWER-${sequence}`,
      name: `Sanitized planning task ${sequence}`,
      start: "2026-07-20",
      end: sequence % 7 === 0 ? "2026-07-22" : "2026-08-07",
      progress: done ? 100 : sequence % 2 === 0 ? 50 : 0,
      progressSource: "status",
      statusName: done ? "Done" : sequence % 2 === 0 ? "In Progress" : "To Do",
      statusCategory: done ? "done" : sequence % 2 === 0 ? "in-progress" : "to-do",
      assigneeName: `Fixture User ${sequence % 7}`,
      issueTypeName: sequence % 5 === 0 ? "Story" : "Task",
      priorityName: sequence % 7 === 0 ? "Highest" : "Medium",
      labels: sequence % 5 === 0 ? ["release"] : [],
      isResolved: done,
      isBlocked: Boolean(prerequisiteId),
      blockedByTaskIds: prerequisiteId ? [prerequisiteId] : [],
      dependencies: prerequisiteId ? [prerequisiteId] : [],
      isSyntheticDate: inferred,
      startSource: inferred ? "created" : "jira",
      endSource: inferred ? "default-duration" : "jira",
      ...(inferred ? { dateWarning: "Schedule dates were inferred." } : {}),
    });
  }),
  warnings: [],
  syntheticDateCount: 250,
  dependencyCount: 51,
};

function useMockEditingContext(
  initialTasks: GanttTask[],
): { model: GanttScheduleModel; editing: GanttEditingContext } {
  const [taskList, setTaskList] = useState(initialTasks);
  const pending = { current: undefined as { issueKey: string; startDate?: string; dueDate?: string } | undefined };

  const client = {
    getIssueEditMetadata: async () => ({
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
    updateIssueDates: async (
      issueKey: string,
      request: { startDate?: string; dueDate?: string },
    ) => {
      console.log("[dev-preview] updateIssueDates", issueKey, request);
      pending.current = {
        issueKey,
        ...(request.startDate !== undefined ? { startDate: request.startDate } : {}),
        ...(request.dueDate !== undefined ? { dueDate: request.dueDate } : {}),
      };
    },
  } as unknown as JiraClient;

  const refresh = async () => {
    const change = pending.current;
    if (!change) return;
    setTaskList((current) =>
      current.map((existingTask) =>
        existingTask.issueKey === change.issueKey
          ? {
              ...existingTask,
              start: change.startDate ?? existingTask.start,
              end: change.dueDate ?? existingTask.end,
            }
          : existingTask,
      ),
    );
  };

  return {
    model: { roots: [], tasks: taskList, warnings: [], syntheticDateCount: 1, dependencyCount: 3 },
    editing: { client, fieldMapping: {}, refresh },
  };
}

export function DevGanttPreview() {
  const useLargeModel =
    new URLSearchParams(globalThis.location.search).get("gantt-preview") === "large";
  const { model: liveModel, editing } = useMockEditingContext(tasks);
  return (
    <main className="dev-gantt-preview">
      <GanttView
        model={useLargeModel ? largeModel : liveModel}
        today="2026-07-23"
        editing={editing}
      />
    </main>
  );
}
