import {
  applyGanttDrag,
  sortGanttTasks,
  type FieldMapping,
  type GanttDragGesture,
  type GanttScheduleModel,
  type GanttSortDirection,
  type GanttSortOption,
  type GanttTask,
  type JiraUser,
} from "@power-view/domain";
import type { JiraClient, JiraIssueTransition } from "@power-view/jira-client";
import type { GanttBoardState, GanttViewPreferences } from "@power-view/storage";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import "./gantt-v2.css";
import { planCascadeSchedule, wouldCreateDependencyCycle } from "./cascade-schedule";
import { dependencyTypeFromEdges, type TaskEdge } from "./dependency-types";
import { findExternalScheduleConflicts } from "./external-schedule-conflicts";

type GanttZoom = "day" | "week" | "month";

export interface GanttV2EditingContext {
  client: JiraClient;
  fieldMapping: FieldMapping;
  refresh: () => Promise<void>;
}

export interface GanttV2Props {
  model: GanttScheduleModel;
  nonWorkingDays?: readonly number[];
  editing?: GanttV2EditingContext;
  today?: string;
  boardState?: GanttBoardState;
  onBoardStateChange?: (state: GanttBoardState) => void | Promise<void>;
  initialViewPreferences?: GanttViewPreferences;
  initialSearch?: string;
  initialHideCompleted?: boolean;
  onViewPreferencesChange?: (preferences: GanttViewPreferences) => void;
  onSearchChange?: (search: string) => void;
  onHideCompletedChange?: (hideCompleted: boolean) => void;
}

interface DateOverride {
  start: string;
  end: string;
}

interface ActiveDrag {
  taskId: string;
  gesture: GanttDragGesture;
  startX: number;
  currentX: number;
}

interface DependencyDraft {
  issueKey: string;
  edge: TaskEdge;
}

const DAY_WIDTH: Record<GanttZoom, number> = {
  day: 40,
  week: 24,
  month: 10,
};

const TIMELINE_HEADER_HEIGHT = 48;
const TIMELINE_ROW_HEIGHT = 52;

const EMPTY_BOARD_STATE: GanttBoardState = {
  dependencies: [],
  reconciledDates: {},
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function dateRange(start: string, end: string): string[] {
  const result: string[] = [];
  for (let current = start; current <= end; current = addDays(current, 1)) {
    result.push(current);
  }
  return result;
}

function visibleTasks(tasks: readonly GanttTask[], expanded: ReadonlySet<string>) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks.filter((task) => {
    let parentId = task.parentId;
    while (parentId) {
      if (!expanded.has(parentId)) return false;
      parentId = byId.get(parentId)?.parentId;
    }
    return true;
  });
}

function taskColor(task: GanttTask): string {
  if (task.statusCategory === "done") return "var(--gantt-v2-done)";
  if (isReviewStatus(task)) return "var(--gantt-v2-review)";
  if (task.statusCategory === "in-progress") return "var(--gantt-v2-progress)";
  return "var(--gantt-v2-todo)";
}

function isReviewStatus(task: GanttTask): boolean {
  return isReviewStatusName(task.statusName);
}

function isReviewStatusName(statusName: string): boolean {
  return statusName.trim().toLocaleLowerCase().replace(/\s+/g, " ") === "in review";
}

export function GanttV2({
  model,
  nonWorkingDays = [0, 6],
  editing,
  today = isoToday(),
  boardState = EMPTY_BOARD_STATE,
  onBoardStateChange,
  initialViewPreferences,
  initialSearch = "",
  initialHideCompleted = false,
  onViewPreferencesChange,
  onSearchChange,
  onHideCompletedChange,
}: GanttV2Props) {
  const [zoom, setZoom] = useState<GanttZoom>(initialViewPreferences?.zoom ?? "week");
  const [sortBy, setSortBy] = useState<GanttSortOption>(
    initialViewPreferences?.sortBy ?? "default",
  );
  const [sortDirection, setSortDirection] = useState<GanttSortDirection>(
    initialViewPreferences?.sortDirection ?? "asc",
  );
  const [search, setSearch] = useState(initialSearch);
  const [hideCompleted, setHideCompleted] = useState(initialHideCompleted);
  const [leftWidth, setLeftWidth] = useState(520);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(model.tasks.filter((task) => task.expanded).map((task) => task.id)),
  );
  const [overrides, setOverrides] = useState<Record<string, DateOverride>>({});
  const [saveState, setSaveState] = useState<
    Record<string, "saving" | "saved" | "error">
  >({});
  const [assigneeEditorTaskId, setAssigneeEditorTaskId] = useState<string>();
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assigneeOptions, setAssigneeOptions] = useState<JiraUser[]>([]);
  const [assigneeSearchState, setAssigneeSearchState] = useState<
    "idle" | "searching" | "saving"
  >("idle");
  const [assigneeOverrides, setAssigneeOverrides] = useState<
    Record<string, JiraUser | null>
  >({});
  const [statusEditorTaskId, setStatusEditorTaskId] = useState<string>();
  const [statusTransitions, setStatusTransitions] = useState<JiraIssueTransition[]>([]);
  const [statusLoadState, setStatusLoadState] = useState<"idle" | "loading" | "saving">(
    "idle",
  );
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [statusSaveState, setStatusSaveState] = useState<
    Record<string, "saving" | "saved" | "error">
  >({});
  const [message, setMessage] = useState<string>();
  const [pendingSchedule, setPendingSchedule] = useState<{
    taskId: string;
    date: string;
  }>();
  const [dependencyDraft, setDependencyDraft] = useState<DependencyDraft>();
  const [resolvedExternalConflicts, setResolvedExternalConflicts] = useState<Set<string>>(
    new Set(),
  );
  const [manualCorrectionNotice, setManualCorrectionNotice] = useState(false);
  const dragRef = useRef<ActiveDrag | undefined>(undefined);
  const dependencyRef = useRef<DependencyDraft | undefined>(undefined);
  const dividerRef = useRef<{ startX: number; startWidth: number } | undefined>(
    undefined,
  );
  const timelineRef = useRef<HTMLDivElement>(null);
  const assigneeEditorRef = useRef<HTMLDivElement>(null);
  const statusEditorRef = useRef<HTMLDivElement>(null);
  const statusLoadRequestRef = useRef(0);

  const closeAssigneeEditor = useCallback(() => {
    setAssigneeEditorTaskId(undefined);
    setAssigneeQuery("");
    setAssigneeOptions([]);
    setAssigneeSearchState("idle");
  }, []);

  const closeStatusEditor = useCallback(() => {
    statusLoadRequestRef.current += 1;
    setStatusEditorTaskId(undefined);
    setStatusTransitions([]);
    setStatusLoadState("idle");
  }, []);

  useEffect(() => {
    setZoom(initialViewPreferences?.zoom ?? "week");
    setSortBy(initialViewPreferences?.sortBy ?? "default");
    setSortDirection(initialViewPreferences?.sortDirection ?? "asc");
  }, [
    initialViewPreferences?.sortBy,
    initialViewPreferences?.sortDirection,
    initialViewPreferences?.zoom,
  ]);

  useEffect(() => setSearch(initialSearch), [initialSearch]);
  useEffect(() => setHideCompleted(initialHideCompleted), [initialHideCompleted]);

  useEffect(() => {
    if (!assigneeEditorTaskId) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !assigneeEditorRef.current?.contains(event.target)
      ) {
        closeAssigneeEditor();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAssigneeEditor();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [assigneeEditorTaskId, closeAssigneeEditor]);

  useEffect(() => {
    if (!statusEditorTaskId) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !statusEditorRef.current?.contains(event.target)
      ) {
        closeStatusEditor();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeStatusEditor();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeStatusEditor, statusEditorTaskId]);

  const dayWidth = DAY_WIDTH[zoom];
  const effectiveTasks = useMemo(
    () =>
      model.tasks.map((task) => {
        const override = overrides[task.id];
        return override
          ? {
              ...task,
              start: override.start,
              end: override.end,
              scheduleState: "confirmed" as const,
              isSyntheticDate: false,
              startSource: "jira" as const,
              endSource: "jira" as const,
            }
          : task;
      }),
    [model.tasks, overrides],
  );
  const taskIdsWithVisibleChildren = useMemo(
    () =>
      new Set(
        effectiveTasks.flatMap((task) =>
          task.parentId && (!hideCompleted || task.statusCategory !== "done")
            ? [task.parentId]
            : [],
        ),
      ),
    [effectiveTasks, hideCompleted],
  );
  const sortedTasks = useMemo(
    () => sortGanttTasks(effectiveTasks, sortBy, sortDirection),
    [effectiveTasks, sortBy, sortDirection],
  );
  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return visibleTasks(sortedTasks, expanded).filter(
      (task) =>
        (!hideCompleted || task.statusCategory !== "done") &&
        (!query ||
          task.issueKey.toLowerCase().includes(query) ||
          task.name.toLowerCase().includes(query) ||
          task.assigneeName?.toLowerCase().includes(query)),
    );
  }, [expanded, hideCompleted, search, sortedTasks]);

  const [rangeStart, rangeEnd] = useMemo(() => {
    const scheduled = effectiveTasks.filter(
      (task) => task.scheduleState !== "unscheduled" && task.start && task.end,
    );
    const starts = scheduled.map((task) => task.start).concat(today);
    const ends = scheduled.map((task) => task.end).concat(today);
    return [
      addDays(starts.sort()[0] ?? today, -14),
      addDays(ends.sort().at(-1) ?? today, 30),
    ];
  }, [effectiveTasks, today]);
  const days = useMemo(() => dateRange(rangeStart, rangeEnd), [rangeEnd, rangeStart]);
  const timelineWidth = days.length * dayWidth;
  const externalConflicts = useMemo(
    () =>
      findExternalScheduleConflicts({
        tasks: model.tasks,
        boardState,
        nonWorkingDays,
      }).filter((conflict) => !resolvedExternalConflicts.has(conflict.issueKey)),
    [boardState, model.tasks, nonWorkingDays, resolvedExternalConflicts],
  );
  const activeExternalConflict = externalConflicts[0];
  const externalConflictKeys = useMemo(
    () => new Set(externalConflicts.map((conflict) => conflict.issueKey)),
    [externalConflicts],
  );
  const dependencyArrows = useMemo(() => {
    const taskByIssueKey = new Map(
      filteredTasks.map((task, rowIndex) => [task.issueKey, { task, rowIndex }]),
    );

    return boardState.dependencies.flatMap((dependency) => {
      const predecessor = taskByIssueKey.get(dependency.predecessorIssueKey);
      const successor = taskByIssueKey.get(dependency.successorIssueKey);
      if (
        !predecessor ||
        !successor ||
        predecessor.task.scheduleState === "unscheduled" ||
        successor.task.scheduleState === "unscheduled"
      ) {
        return [];
      }

      const predecessorLeft = daysBetween(rangeStart, predecessor.task.start) * dayWidth;
      const predecessorRight =
        predecessorLeft +
        (daysBetween(predecessor.task.start, predecessor.task.end) + 1) * dayWidth;
      const successorLeft = daysBetween(rangeStart, successor.task.start) * dayWidth;
      const successorRight =
        successorLeft +
        (daysBetween(successor.task.start, successor.task.end) + 1) * dayWidth;
      const sourceX = dependency.type.startsWith("F")
        ? predecessorRight
        : predecessorLeft;
      const targetX = dependency.type.endsWith("F") ? successorRight : successorLeft;
      const sourceY =
        TIMELINE_HEADER_HEIGHT +
        predecessor.rowIndex * TIMELINE_ROW_HEIGHT +
        TIMELINE_ROW_HEIGHT / 2;
      const targetY =
        TIMELINE_HEADER_HEIGHT +
        successor.rowIndex * TIMELINE_ROW_HEIGHT +
        TIMELINE_ROW_HEIGHT / 2;
      const routeX =
        sourceX <= targetX
          ? sourceX + Math.max(14, (targetX - sourceX) / 2)
          : Math.max(sourceX, targetX) + 18;

      return [
        {
          ...dependency,
          path: `M ${sourceX} ${sourceY} H ${routeX} V ${targetY} H ${targetX}`,
        },
      ];
    });
  }, [boardState.dependencies, dayWidth, filteredTasks, rangeStart]);

  const saveSchedule = useCallback(
    async (
      task: GanttTask,
      dates: { startDate?: string; dueDate?: string },
      optimistic: DateOverride,
    ) => {
      if (!editing) {
        setMessage("Jira editing is not available for this board.");
        return;
      }
      const plan = planCascadeSchedule({
        tasks: effectiveTasks,
        dependencies: boardState.dependencies,
        changedIssueKey: task.issueKey,
        changedDates: {
          startDate: optimistic.start,
          dueDate: optimistic.end,
        },
        nonWorkingDays,
      });
      const tasksByKey = new Map(
        effectiveTasks.map((candidate) => [candidate.issueKey, candidate]),
      );
      const affected = plan.updates.flatMap((update) => {
        const affectedTask = tasksByKey.get(update.issueKey);
        return affectedTask ? [{ update, task: affectedTask }] : [];
      });
      const previous = Object.fromEntries(
        affected.map(({ task: affectedTask }) => [
          affectedTask.id,
          overrides[affectedTask.id],
        ]),
      );
      setOverrides((current) => ({
        ...current,
        ...Object.fromEntries(
          affected.map(({ update, task: affectedTask }) => [
            affectedTask.id,
            { start: update.startDate, end: update.dueDate },
          ]),
        ),
      }));
      setSaveState((current) => ({
        ...current,
        ...Object.fromEntries(
          affected.map(({ task: affectedTask }) => [affectedTask.id, "saving"]),
        ),
      }));
      setMessage(undefined);
      try {
        for (const { update } of affected) {
          const isDirect = update.issueKey === task.issueKey;
          await editing.client.updateIssueDates(update.issueKey, {
            fieldMapping: editing.fieldMapping,
            ...(isDirect
              ? {
                  ...(dates.startDate ? { startDate: dates.startDate } : {}),
                  ...(dates.dueDate ? { dueDate: dates.dueDate } : {}),
                }
              : { startDate: update.startDate, dueDate: update.dueDate }),
          });
        }
        setSaveState((current) => ({
          ...current,
          ...Object.fromEntries(
            affected.map(({ task: affectedTask }) => [affectedTask.id, "saved"]),
          ),
        }));
        await onBoardStateChange?.({
          ...boardState,
          reconciledDates: {
            ...boardState.reconciledDates,
            ...Object.fromEntries(
              plan.updates.map((update) => [
                update.issueKey,
                { startDate: update.startDate, dueDate: update.dueDate },
              ]),
            ),
          },
        });
        await editing.refresh();
      } catch (caught) {
        setOverrides((current) => {
          const next = { ...current };
          for (const { task: affectedTask } of affected) {
            const oldValue = previous[affectedTask.id];
            if (oldValue) next[affectedTask.id] = oldValue;
            else delete next[affectedTask.id];
          }
          return next;
        });
        setSaveState((current) => ({
          ...current,
          ...Object.fromEntries(
            affected.map(({ task: affectedTask }) => [affectedTask.id, "error"]),
          ),
        }));
        setMessage(
          caught instanceof Error ? caught.message : `Could not update ${task.issueKey}.`,
        );
        try {
          await editing.refresh();
        } catch {
          // The original mutation error remains the actionable message.
        }
      }
    },
    [boardState, editing, effectiveTasks, nonWorkingDays, onBoardStateChange, overrides],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (dragRef.current) dragRef.current.currentX = event.clientX;
      if (dividerRef.current) {
        const width =
          dividerRef.current.startWidth + event.clientX - dividerRef.current.startX;
        setLeftWidth(Math.min(760, Math.max(320, width)));
      }
    };
    const up = (event: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = undefined;
      dividerRef.current = undefined;
      if (!drag) return;
      const task = effectiveTasks.find((candidate) => candidate.id === drag.taskId);
      if (!task) return;
      const deltaDays = Math.round((event.clientX - drag.startX) / dayWidth);
      const result = applyGanttDrag(task, drag.gesture, deltaDays);
      if (!result.allowed) {
        setMessage(result.reason ?? `Could not move ${task.issueKey}.`);
        return;
      }
      if (!result.startDate && !result.dueDate) return;
      const optimistic = {
        start: result.startDate ?? task.start,
        end: result.dueDate ?? task.end,
      };
      void saveSchedule(
        task,
        {
          ...(result.startDate ? { startDate: result.startDate } : {}),
          ...(result.dueDate ? { dueDate: result.dueDate } : {}),
        },
        optimistic,
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dayWidth, effectiveTasks, saveSchedule]);

  const beginDrag = (
    taskId: string,
    gesture: GanttDragGesture,
    event: ReactPointerEvent,
  ) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      taskId,
      gesture,
      startX: event.clientX,
      currentX: event.clientX,
    };
  };

  const chooseScheduleDate = (task: GanttTask, date: string) => {
    if (!editing) {
      setMessage("Jira editing is not available for this board.");
      return;
    }
    if (!pendingSchedule || pendingSchedule.taskId !== task.id) {
      setPendingSchedule({ taskId: task.id, date });
      return;
    }
    const startDate = pendingSchedule.date < date ? pendingSchedule.date : date;
    const dueDate = pendingSchedule.date < date ? date : pendingSchedule.date;
    setPendingSchedule(undefined);
    void saveSchedule(task, { startDate, dueDate }, { start: startDate, end: dueDate });
  };

  const beginDependency = (
    issueKey: string,
    edge: TaskEdge,
    event: ReactPointerEvent,
  ) => {
    event.stopPropagation();
    const value = { issueKey, edge } satisfies DependencyDraft;
    dependencyRef.current = value;
    setDependencyDraft(value);
  };

  const finishDependency = (
    issueKey: string,
    edge: TaskEdge,
    event: ReactPointerEvent,
  ) => {
    event.stopPropagation();
    const source = dependencyRef.current;
    dependencyRef.current = undefined;
    setDependencyDraft(undefined);
    if (!source || source.issueKey === issueKey) return;
    const type = dependencyTypeFromEdges(source.edge, edge);
    const id = `${source.issueKey}:${issueKey}:${type}`;
    if (boardState.dependencies.some((dependency) => dependency.id === id)) return;
    if (wouldCreateDependencyCycle(boardState.dependencies, source.issueKey, issueKey)) {
      setMessage("This dependency would create a cycle and was not added.");
      return;
    }
    const sourceTask = effectiveTasks.find((task) => task.issueKey === source.issueKey);
    const targetTask = effectiveTasks.find((task) => task.issueKey === issueKey);
    void onBoardStateChange?.({
      ...boardState,
      dependencies: [
        ...boardState.dependencies,
        {
          id,
          predecessorIssueKey: source.issueKey,
          successorIssueKey: issueKey,
          type,
          lagWorkingDays: 0,
        },
      ],
      reconciledDates: {
        ...boardState.reconciledDates,
        ...(sourceTask
          ? {
              [sourceTask.issueKey]: {
                startDate: sourceTask.start,
                dueDate: sourceTask.end,
              },
            }
          : {}),
        ...(targetTask
          ? {
              [targetTask.issueKey]: {
                startDate: targetTask.start,
                dueDate: targetTask.end,
              },
            }
          : {}),
      },
    });
  };

  const scrollToToday = () => {
    if (!timelineRef.current) return;
    timelineRef.current.scrollLeft = Math.max(
      0,
      daysBetween(rangeStart, today) * dayWidth - timelineRef.current.clientWidth / 2,
    );
  };

  const repairExternalConflict = async () => {
    if (!activeExternalConflict || !editing) return;
    const tasksByKey = new Map(effectiveTasks.map((task) => [task.issueKey, task]));
    const affected = activeExternalConflict.repairUpdates.flatMap((update) => {
      const affectedTask = tasksByKey.get(update.issueKey);
      return affectedTask ? [{ update, task: affectedTask }] : [];
    });
    setManualCorrectionNotice(false);
    setMessage(undefined);
    setOverrides((current) => ({
      ...current,
      ...Object.fromEntries(
        affected.map(({ update, task }) => [
          task.id,
          { start: update.startDate, end: update.dueDate },
        ]),
      ),
    }));
    setSaveState((current) => ({
      ...current,
      ...Object.fromEntries(affected.map(({ task }) => [task.id, "saving"])),
    }));
    try {
      for (const { update } of affected) {
        await editing.client.updateIssueDates(update.issueKey, {
          fieldMapping: editing.fieldMapping,
          startDate: update.startDate,
          dueDate: update.dueDate,
        });
      }
      const reconciledDates = {
        ...boardState.reconciledDates,
        [activeExternalConflict.issueKey]: activeExternalConflict.jiraDates,
        ...Object.fromEntries(
          activeExternalConflict.repairUpdates.map((update) => [
            update.issueKey,
            { startDate: update.startDate, dueDate: update.dueDate },
          ]),
        ),
      };
      await onBoardStateChange?.({ ...boardState, reconciledDates });
      setSaveState((current) => ({
        ...current,
        ...Object.fromEntries(affected.map(({ task }) => [task.id, "saved"])),
      }));
      setResolvedExternalConflicts((current) =>
        new Set(current).add(activeExternalConflict.issueKey),
      );
      await editing.refresh();
    } catch (caught) {
      setSaveState((current) => ({
        ...current,
        ...Object.fromEntries(affected.map(({ task }) => [task.id, "error"])),
      }));
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Power View could not repair the dependent schedule.",
      );
      try {
        await editing.refresh();
      } catch {
        // Preserve the mutation error above.
      }
    }
  };

  const openAssigneeEditor = (taskId: string) => {
    if (assigneeEditorTaskId === taskId) {
      closeAssigneeEditor();
      return;
    }
    closeStatusEditor();
    setAssigneeEditorTaskId(taskId);
    setAssigneeQuery("");
    setAssigneeOptions([]);
    setAssigneeSearchState("idle");
    setMessage(undefined);
  };

  const openStatusEditor = async (task: GanttTask) => {
    if (!editing) return;
    if (statusEditorTaskId === task.id) {
      closeStatusEditor();
      return;
    }
    closeAssigneeEditor();
    const requestId = ++statusLoadRequestRef.current;
    setStatusEditorTaskId(task.id);
    setStatusTransitions([]);
    setStatusLoadState("loading");
    setMessage(undefined);
    try {
      const transitions = await editing.client.getIssueTransitions(task.issueKey);
      if (statusLoadRequestRef.current !== requestId) return;
      setStatusTransitions(transitions);
      if (transitions.length === 0) {
        setMessage(`Jira returned no available status transitions for ${task.issueKey}.`);
      }
    } catch (caught) {
      if (statusLoadRequestRef.current !== requestId) return;
      setMessage(
        caught instanceof Error
          ? caught.message
          : `Could not load status transitions for ${task.issueKey}.`,
      );
    } finally {
      if (statusLoadRequestRef.current === requestId) setStatusLoadState("idle");
    }
  };

  const searchAssignees = async (task: GanttTask) => {
    if (!editing) return;
    setAssigneeSearchState("searching");
    setMessage(undefined);
    try {
      const users = await editing.client.findAssignableUsers(
        task.issueKey,
        assigneeQuery.trim(),
      );
      setAssigneeOptions(users);
      if (users.length === 0) {
        setMessage(
          `No assignable Jira users matched ${assigneeQuery.trim() || "the search"}.`,
        );
      }
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : `Could not load assignable users for ${task.issueKey}.`,
      );
    } finally {
      setAssigneeSearchState("idle");
    }
  };

  const assignTask = async (task: GanttTask, assignee: JiraUser | null) => {
    if (!editing) return;
    const hadOverride = Object.hasOwn(assigneeOverrides, task.id);
    const previousOverride = assigneeOverrides[task.id];
    setAssigneeOverrides((current) => ({ ...current, [task.id]: assignee }));
    setAssigneeEditorTaskId(undefined);
    setAssigneeSearchState("saving");
    setSaveState((current) => ({ ...current, [task.id]: "saving" }));
    setMessage(undefined);
    try {
      await editing.client.assignIssue(task.issueKey, assignee);
      setSaveState((current) => ({ ...current, [task.id]: "saved" }));
      await editing.refresh();
    } catch (caught) {
      setAssigneeOverrides((current) => {
        const next = { ...current };
        if (hadOverride) next[task.id] = previousOverride ?? null;
        else delete next[task.id];
        return next;
      });
      setSaveState((current) => ({ ...current, [task.id]: "error" }));
      setMessage(
        caught instanceof Error
          ? caught.message
          : `Could not update the assignee for ${task.issueKey}.`,
      );
      try {
        await editing.refresh();
      } catch {
        // Preserve the mutation error above.
      }
    } finally {
      setAssigneeSearchState("idle");
    }
  };

  const transitionTask = async (task: GanttTask, transitionId: string) => {
    if (!editing) return;
    const transition = statusTransitions.find(
      (candidate) => candidate.id === transitionId,
    );
    if (!transition) return;
    const hadOverride = Object.hasOwn(statusOverrides, task.id);
    const previousOverride = statusOverrides[task.id];
    setStatusOverrides((current) => ({
      ...current,
      [task.id]: transition.toStatusName,
    }));
    closeStatusEditor();
    setStatusLoadState("saving");
    setStatusSaveState((current) => ({ ...current, [task.id]: "saving" }));
    setMessage(undefined);
    try {
      await editing.client.transitionIssue(task.issueKey, transition.id);
      setStatusSaveState((current) => ({ ...current, [task.id]: "saved" }));
      await editing.refresh();
    } catch (caught) {
      setStatusOverrides((current) => {
        const next = { ...current };
        if (hadOverride && previousOverride) next[task.id] = previousOverride;
        else delete next[task.id];
        return next;
      });
      setStatusSaveState((current) => ({ ...current, [task.id]: "error" }));
      setMessage(
        caught instanceof Error
          ? caught.message
          : `Could not change the status for ${task.issueKey}.`,
      );
      try {
        await editing.refresh();
      } catch {
        // Preserve the transition error above.
      }
    } finally {
      setStatusLoadState("idle");
    }
  };

  return (
    <section className="gantt-v2" aria-label="Gantt planning workspace">
      <header className="gantt-v2-toolbar">
        <label className="gantt-v2-search">
          <span className="sr-only">Search tasks</span>
          <input
            type="search"
            aria-label="Search tasks"
            placeholder="Search tasks"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              onSearchChange?.(event.target.value);
            }}
          />
        </label>
        <label className="gantt-v2-hide-completed">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(event) => {
              setHideCompleted(event.target.checked);
              onHideCompletedChange?.(event.target.checked);
            }}
          />
          Hide completed matching tasks
        </label>
        <div className="gantt-v2-toolbar-spacer" />
        <label className="gantt-v2-sort">
          <span className="sr-only">Sort tasks</span>
          <select
            aria-label="Sort tasks"
            value={sortBy}
            onChange={(event) => {
              const nextSortBy = event.target.value as GanttSortOption;
              setSortBy(nextSortBy);
              onViewPreferencesChange?.({
                zoom,
                sortBy: nextSortBy,
                sortDirection,
              });
            }}
          >
            <option value="default">Board order</option>
            <option value="startDate">Start date</option>
            <option value="endDate">Due date</option>
            <option value="name">Task name</option>
            <option value="status">Status</option>
            <option value="assignee">Assignee</option>
            <option value="issueKey">Issue key</option>
          </select>
        </label>
        <button
          type="button"
          className="gantt-v2-toolbar-button gantt-v2-sort-direction"
          aria-label={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}
          onClick={() => {
            const nextDirection = sortDirection === "asc" ? "desc" : "asc";
            setSortDirection(nextDirection);
            onViewPreferencesChange?.({
              zoom,
              sortBy,
              sortDirection: nextDirection,
            });
          }}
        >
          {sortDirection === "asc" ? "↑" : "↓"}
        </button>
        <button type="button" className="gantt-v2-toolbar-button" onClick={scrollToToday}>
          Today
        </button>
        <div className="gantt-v2-zoom" aria-label="Timeline zoom">
          {(["day", "week", "month"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={zoom === value}
              onClick={() => {
                setZoom(value);
                onViewPreferencesChange?.({
                  zoom: value,
                  sortBy,
                  sortDirection,
                });
              }}
            >
              {value[0]?.toUpperCase()}
              {value.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {message ? (
        <p className="gantt-v2-message" role="alert">
          {message}
        </p>
      ) : null}
      {activeExternalConflict ? (
        <div className="gantt-v2-external-conflict" role="alert">
          <div>
            <strong>
              {activeExternalConflict.issueKey} changed in Jira without its dependent
              schedule.
            </strong>
            <span>
              {activeExternalConflict.repairUpdates.length} downstream task
              {activeExternalConflict.repairUpdates.length === 1 ? "" : "s"} need
              attention.
            </span>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={!editing}
            onClick={() => void repairExternalConflict()}
          >
            Repair schedule automatically
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setManualCorrectionNotice(true)}
          >
            Keep Jira dates
          </button>
        </div>
      ) : null}
      {manualCorrectionNotice ? (
        <p className="gantt-v2-manual-notice" role="status">
          No Jira dates were changed. Resolve the highlighted dependencies manually.
        </p>
      ) : null}
      <div
        className="gantt-v2-split"
        style={{ gridTemplateColumns: `${leftWidth}px 6px minmax(0, 1fr)` }}
      >
        <div
          className="gantt-v2-table"
          role="grid"
          aria-label="Gantt tasks"
          aria-rowcount={filteredTasks.length + 1}
        >
          <div className="gantt-v2-table-header" role="row">
            <span role="columnheader">Task</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Assignee</span>
          </div>
          {filteredTasks.map((task) => (
            <div
              className={`gantt-v2-table-row${externalConflictKeys.has(task.issueKey) ? " is-external-conflict" : ""}`}
              role="row"
              key={task.id}
            >
              <div
                className="gantt-v2-task-cell"
                role="gridcell"
                style={{ paddingInlineStart: 12 + task.depth * 18 }}
              >
                {taskIdsWithVisibleChildren.has(task.id) ? (
                  <button
                    type="button"
                    className="gantt-v2-disclosure"
                    aria-label={`${expanded.has(task.id) ? "Collapse" : "Expand"} ${task.issueKey}`}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(task.id)) next.delete(task.id);
                        else next.add(task.id);
                        return next;
                      })
                    }
                  >
                    {expanded.has(task.id) ? "⌄" : "›"}
                  </button>
                ) : (
                  <span className="gantt-v2-disclosure-placeholder" />
                )}
                <span>
                  <a href={task.browseUrl} target="_blank" rel="noreferrer">
                    {task.issueKey}
                  </a>
                  <small title={task.name}>{task.name}</small>
                </span>
              </div>
              <div
                role="gridcell"
                className={`gantt-v2-status is-${task.statusCategory}${isReviewStatusName(statusOverrides[task.id] ?? task.statusName) ? " is-review" : ""}`}
                ref={statusEditorTaskId === task.id ? statusEditorRef : undefined}
              >
                {editing && !task.isHierarchyPlaceholder ? (
                  <button
                    type="button"
                    className="gantt-v2-status-button"
                    aria-label={`Edit status for ${task.issueKey}`}
                    aria-expanded={statusEditorTaskId === task.id}
                    onClick={() => void openStatusEditor(task)}
                  >
                    {statusOverrides[task.id] ?? task.statusName}
                  </button>
                ) : (
                  <span>{task.statusName}</span>
                )}
                {statusSaveState[task.id] ? (
                  <small aria-live="polite">
                    {statusSaveState[task.id] === "saving"
                      ? "Saving…"
                      : statusSaveState[task.id] === "saved"
                        ? "Saved"
                        : "Save failed"}
                  </small>
                ) : null}
                {statusEditorTaskId === task.id && editing ? (
                  <div
                    className="gantt-v2-status-popover"
                    role="dialog"
                    aria-label={`Change status for ${task.issueKey}`}
                  >
                    <div className="gantt-v2-status-popover-header">
                      <strong>Change status</strong>
                      <button
                        type="button"
                        aria-label={`Close status editor for ${task.issueKey}`}
                        onClick={closeStatusEditor}
                      >
                        ×
                      </button>
                    </div>
                    <select
                      aria-label={`Change status for ${task.issueKey}`}
                      value=""
                      disabled={statusLoadState !== "idle"}
                      onChange={(event) => void transitionTask(task, event.target.value)}
                    >
                      <option value="">
                        {statusLoadState === "loading"
                          ? "Loading Jira statuses…"
                          : statusTransitions.length === 0
                            ? "No available transitions"
                            : "Select status"}
                      </option>
                      {statusTransitions.map((transition) => (
                        <option key={transition.id} value={transition.id}>
                          {transition.toStatusName}
                          {transition.name === transition.toStatusName
                            ? ""
                            : ` — ${transition.name}`}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              <div
                role="gridcell"
                className="gantt-v2-assignee"
                ref={assigneeEditorTaskId === task.id ? assigneeEditorRef : undefined}
              >
                {editing && !task.isHierarchyPlaceholder ? (
                  <button
                    type="button"
                    className="gantt-v2-assignee-button"
                    aria-label={`Edit assignee for ${task.issueKey}`}
                    aria-expanded={assigneeEditorTaskId === task.id}
                    onClick={() => openAssigneeEditor(task.id)}
                  >
                    {Object.hasOwn(assigneeOverrides, task.id)
                      ? (assigneeOverrides[task.id]?.displayName ?? "Unassigned")
                      : (task.assigneeName ?? "Unassigned")}
                  </button>
                ) : (
                  <span>{task.assigneeName ?? "Unassigned"}</span>
                )}
                {saveState[task.id] ? (
                  <small aria-live="polite">
                    {saveState[task.id] === "saving"
                      ? "Saving…"
                      : saveState[task.id] === "saved"
                        ? "Saved"
                        : "Save failed"}
                  </small>
                ) : null}
                {assigneeEditorTaskId === task.id && editing ? (
                  <div
                    className="gantt-v2-assignee-popover"
                    role="dialog"
                    aria-label={`Edit assignee for ${task.issueKey}`}
                  >
                    <div className="gantt-v2-assignee-popover-header">
                      <strong>Change assignee</strong>
                      <button
                        type="button"
                        aria-label={`Close assignee editor for ${task.issueKey}`}
                        onClick={closeAssigneeEditor}
                      >
                        ×
                      </button>
                    </div>
                    <form
                      className="gantt-v2-assignee-search"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void searchAssignees(task);
                      }}
                    >
                      <input
                        type="search"
                        aria-label={`Search assignee for ${task.issueKey}`}
                        placeholder="Name or email"
                        value={assigneeQuery}
                        autoFocus
                        onChange={(event) => setAssigneeQuery(event.target.value)}
                      />
                      <button type="submit" disabled={assigneeSearchState !== "idle"}>
                        {assigneeSearchState === "searching"
                          ? "Searching…"
                          : "Search Jira users"}
                      </button>
                    </form>
                    <div className="gantt-v2-assignee-options">
                      <button type="button" onClick={() => void assignTask(task, null)}>
                        Set {task.issueKey} unassigned
                      </button>
                      {assigneeOptions.map((user) => {
                        const id = user.accountId ?? user.username ?? user.displayName;
                        return (
                          <button
                            key={id}
                            type="button"
                            aria-label={`Assign ${task.issueKey} to ${user.displayName}`}
                            onClick={() => void assignTask(task, user)}
                          >
                            <strong>{user.displayName}</strong>
                            {user.emailAddress ? (
                              <small>{user.emailAddress}</small>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div
          role="separator"
          aria-label="Resize task table"
          aria-orientation="vertical"
          aria-valuemin={320}
          aria-valuemax={760}
          aria-valuenow={leftWidth}
          className="gantt-v2-divider"
          onPointerDown={(event) => {
            dividerRef.current = { startX: event.clientX, startWidth: leftWidth };
          }}
        />

        <div className="gantt-v2-timeline-scroll" ref={timelineRef}>
          <div
            className="gantt-v2-timeline"
            role="region"
            aria-label="Timeline"
            style={{ width: timelineWidth }}
          >
            <div className="gantt-v2-date-header">
              {days.map((date) => {
                const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
                return (
                  <span
                    key={date}
                    className={
                      nonWorkingDays.includes(day) ? "is-non-working" : undefined
                    }
                    style={{ width: dayWidth }}
                    title={date}
                  >
                    {zoom === "month"
                      ? new Date(`${date}T00:00:00Z`).getUTCDate()
                      : date.slice(5)}
                  </span>
                );
              })}
            </div>
            <div
              className="gantt-v2-today-line"
              aria-label={`Today, ${today}`}
              style={{ left: daysBetween(rangeStart, today) * dayWidth }}
            />
            <svg
              className="gantt-v2-dependency-layer"
              width={timelineWidth}
              height={TIMELINE_HEADER_HEIGHT + filteredTasks.length * TIMELINE_ROW_HEIGHT}
              aria-hidden={dependencyArrows.length === 0 ? "true" : undefined}
            >
              <defs>
                <marker
                  id="gantt-v2-dependency-arrowhead"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" />
                </marker>
              </defs>
              {dependencyArrows.map((dependency) => (
                <g
                  key={dependency.id}
                  role="img"
                  aria-label={`${dependency.type} dependency ${dependency.predecessorIssueKey} to ${dependency.successorIssueKey}`}
                >
                  <path
                    className={`gantt-v2-dependency-path${externalConflictKeys.has(dependency.predecessorIssueKey) ? " is-external-conflict" : ""}`}
                    d={dependency.path}
                    markerEnd="url(#gantt-v2-dependency-arrowhead)"
                  />
                </g>
              ))}
            </svg>
            {filteredTasks.map((task) => {
              const unscheduled = task.scheduleState === "unscheduled";
              const left = daysBetween(rangeStart, task.start) * dayWidth;
              const width = (daysBetween(task.start, task.end) + 1) * dayWidth;
              return (
                <div className="gantt-v2-timeline-row" key={task.id}>
                  {days.map((date) => {
                    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
                    return (
                      <span
                        key={date}
                        className={
                          nonWorkingDays.includes(day) ? "is-non-working" : undefined
                        }
                        style={{ width: dayWidth }}
                      >
                        {unscheduled && !task.isHierarchyPlaceholder ? (
                          <button
                            type="button"
                            className={`gantt-v2-schedule-cell${
                              pendingSchedule?.taskId === task.id &&
                              pendingSchedule.date === date
                                ? " is-pending"
                                : ""
                            }`}
                            aria-label={`Set ${task.issueKey} date ${date}`}
                            aria-pressed={
                              pendingSchedule?.taskId === task.id &&
                              pendingSchedule.date === date
                            }
                            onClick={() => chooseScheduleDate(task, date)}
                          />
                        ) : null}
                      </span>
                    );
                  })}
                  {unscheduled ? (
                    <span className="gantt-v2-unscheduled-label">
                      {task.isHierarchyPlaceholder
                        ? "No scheduled child tasks"
                        : pendingSchedule?.taskId === task.id
                          ? "Choose the second date"
                          : "Unscheduled — click twice to set dates"}
                    </span>
                  ) : task.isHierarchyPlaceholder ? (
                    <div
                      className="gantt-v2-bar is-hierarchy-placeholder"
                      role="img"
                      aria-label={`Rollup ${task.issueKey}`}
                      style={{ left, width, background: taskColor(task) }}
                      data-task-id={task.id}
                    >
                      <span>{task.issueKey}</span>
                      <span
                        className="gantt-v2-progress"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  ) : (
                    <div
                      className={`gantt-v2-bar${externalConflictKeys.has(task.issueKey) ? " is-external-conflict" : ""}`}
                      style={{ left, width, background: taskColor(task) }}
                      data-task-id={task.id}
                    >
                      <button
                        type="button"
                        className="gantt-v2-resize gantt-v2-resize-start"
                        aria-label={`Resize start of ${task.issueKey}`}
                        onPointerDown={(event) =>
                          beginDrag(task.id, "resize-start", event)
                        }
                      />
                      <button
                        type="button"
                        className="gantt-v2-dependency-handle is-start"
                        aria-label={`Dependency ${dependencyDraft ? "to" : "from"} start of ${task.issueKey}`}
                        onPointerDown={(event) =>
                          beginDependency(task.issueKey, "start", event)
                        }
                        onPointerUp={(event) =>
                          finishDependency(task.issueKey, "start", event)
                        }
                      />
                      <button
                        type="button"
                        className="gantt-v2-move"
                        aria-label={`Move ${task.issueKey}`}
                        onPointerDown={(event) => beginDrag(task.id, "move", event)}
                      >
                        <span>{task.issueKey}</span>
                        <span
                          className="gantt-v2-progress"
                          style={{ width: `${task.progress}%` }}
                        />
                      </button>
                      <button
                        type="button"
                        className="gantt-v2-dependency-handle is-end"
                        aria-label={`Dependency ${dependencyDraft ? "to" : "from"} end of ${task.issueKey}`}
                        onPointerDown={(event) =>
                          beginDependency(task.issueKey, "end", event)
                        }
                        onPointerUp={(event) =>
                          finishDependency(task.issueKey, "end", event)
                        }
                      />
                      <button
                        type="button"
                        className="gantt-v2-resize gantt-v2-resize-end"
                        aria-label={`Resize end of ${task.issueKey}`}
                        onPointerDown={(event) => beginDrag(task.id, "resize-end", event)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
