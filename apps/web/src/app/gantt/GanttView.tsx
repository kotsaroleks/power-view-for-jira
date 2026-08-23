import {
  DEFAULT_GANTT_FILTERS,
  DEFAULT_NON_WORKING_DAYS,
  countNonWorkingDays,
  filterGanttTasks,
  sortGanttTasks,
  isGanttFilterActive,
  type GanttFilters,
  type GanttScheduleModel,
  type GanttTask,
  type GanttSortOption,
  applyGanttDrag,
  type GanttDragGesture,
} from "@power-view/domain";
import {
  type CSSProperties,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  jiraDateValue,
  GanttEditPanel,
  mutationErrorMessage,
  type GanttEditingContext,
} from "./GanttEditPanel";
import { GanttDependencyLayer } from "./GanttDependencyLayer";
import { GanttNonWorkingDaysLayer } from "./GanttNonWorkingDaysLayer";
import { GanttFiltersToolbar } from "./GanttFiltersToolbar";
import {
  dateAtOffset,
  daysBetween,
  type GanttRenderer,
  nativeGanttRenderer,
} from "./GanttRenderer";
import { visibleGanttTasks } from "./ganttVisibility";
import { ganttVirtualWindow } from "./ganttVirtualization";
import {
  type GanttFilterPersistence,
  usePersistedGanttFilters,
} from "./usePersistedGanttFilters";
import { usePersistedGanttZoom } from "./usePersistedGanttZoom";

export interface GanttViewProps {
  model: GanttScheduleModel;
  today?: string;
  renderer?: GanttRenderer;
  filterPersistence?: GanttFilterPersistence;
  editing?: GanttEditingContext;
  nonWorkingDays?: number[];
}

const MAX_VISIBLE_ROWS = 1_000;
const TABLE_WIDTH = 520;

const SOURCE_LABELS: Record<string, string> = {
  jira: "Jira field",
  children: "Child schedule",
  created: "Created date",
  today: "Current date",
  resolution: "Resolution date",
  "default-duration": "Default duration",
  corrected: "Corrected default duration",
  "jira-progress": "Jira progress",
  subtasks: "Completed subtasks",
  status: "Status category",
  none: "No progress signal",
};

const SCHEDULE_STATE_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  planned: "Planned",
  forecast: "Forecast",
  milestone: "Milestone",
  rollup: "Rollup",
  unscheduled: "Unscheduled",
};

function scheduleState(task: GanttTask): string {
  return task.scheduleState ?? "confirmed";
}

function initialExpandedTasks(tasks: GanttTask[]): Set<string> {
  return new Set(tasks.filter((task) => task.expanded).map((task) => task.id));
}

function statusClass(task: GanttTask): string {
  return `status-${task.statusCategory}`;
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function estimateLabel(days: number): string {
  const value = Number.isInteger(days)
    ? String(days)
    : days.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${value} working day${days === 1 ? "" : "s"}`;
}

function calendarEstimateLabel(days: number): string {
  const value = Number.isInteger(days)
    ? String(days)
    : days.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${value} calendar day${days === 1 ? "" : "s"}`;
}

function sortedUnique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function GanttView({
  model,
  today = new Date().toISOString().slice(0, 10),
  renderer = nativeGanttRenderer,
  filterPersistence,
  editing,
  nonWorkingDays = DEFAULT_NON_WORKING_DAYS,
}: GanttViewProps) {
  const { zoom, setZoom, sortBy, setSortBy, sortDirection, setSortDirection } =
    usePersistedGanttZoom(filterPersistence);
  const toggleSort = (column: GanttSortOption) => {
    if (sortBy !== column) {
      setSortBy(column);
      setSortDirection("asc");
      return;
    }
    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }
    setSortBy("default");
    setSortDirection("asc");
  };
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    initialExpandedTasks(model.tasks),
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [editMode, setEditMode] = useState(false);
  const [drag, setDrag] = useState<{
    taskId: string;
    gesture: GanttDragGesture;
    startX: number;
    pixelDelta: number;
    dragging: boolean;
  }>();
  const [dragConfirm, setDragConfirm] = useState<{
    taskId: string;
    result: { startDate?: string; dueDate?: string };
    error: string | undefined;
    nonWorkingDays?: number;
    calendarDaysEstimate?: number;
    saving?: boolean;
  }>();
  const [unscheduledDatePick, setUnscheduledDatePick] = useState<{
    taskId: string;
    firstDate: string;
  }>();
  const suppressClick = useRef(false);
  const pointerActive = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { filters, setFilters, hydrated } = usePersistedGanttFilters(filterPersistence);
  const deferredSearch = useDeferredValue(filters.search);
  const appliedFilters = useMemo<GanttFilters>(
    () => ({ ...filters, search: deferredSearch }),
    [deferredSearch, filters],
  );
  const filteredResult = useMemo(
    () => filterGanttTasks(model.tasks, appliedFilters, today),
    [appliedFilters, model.tasks, today],
  );
  const filterResult = useMemo(
    () => ({
      ...filteredResult,
      tasks: sortGanttTasks(filteredResult.tasks, sortBy, sortDirection),
    }),
    [filteredResult, sortBy, sortDirection],
  );
  const filterOptions = useMemo(
    () => ({
      statuses: sortedUnique(model.tasks.map((task) => task.statusName)),
      assignees: sortedUnique(model.tasks.map((task) => task.assigneeName)),
      issueTypes: sortedUnique(model.tasks.map((task) => task.issueTypeName)),
      priorities: sortedUnique(model.tasks.map((task) => task.priorityName)),
      labels: sortedUnique(model.tasks.flatMap((task) => task.labels ?? [])),
      hasUnassigned: model.tasks.some((task) => !task.assigneeName),
      hasNoPriority: model.tasks.some((task) => !task.priorityName),
      hasNoLabels: model.tasks.some((task) => (task.labels?.length ?? 0) === 0),
    }),
    [model.tasks],
  );
  const childrenByParent = useMemo(() => {
    const values = new Map<string, number>();
    filterResult.tasks.forEach((task) => {
      if (task.parentId) {
        values.set(task.parentId, (values.get(task.parentId) ?? 0) + 1);
      }
    });
    return values;
  }, [filterResult.tasks]);
  const taskById = useMemo(
    () => new Map(model.tasks.map((task) => [task.id, task])),
    [model.tasks],
  );
  const warningsByKey = useMemo(() => {
    const values = new Map<string, string[]>();
    model.warnings.forEach((warning) => {
      values.set(warning.issueKey, [
        ...(values.get(warning.issueKey) ?? []),
        warning.message,
      ]);
    });
    model.tasks.forEach((task) => {
      if (task.dateWarning) {
        values.set(task.issueKey, [
          ...(values.get(task.issueKey) ?? []),
          task.dateWarning,
        ]);
      }
    });
    return values;
  }, [model.tasks, model.warnings]);
  const effectiveExpandedIds = useMemo(
    () => new Set([...expandedIds, ...filterResult.autoExpandedIds]),
    [expandedIds, filterResult.autoExpandedIds],
  );
  const allVisibleTasks = useMemo(
    () => visibleGanttTasks(filterResult.tasks, effectiveExpandedIds),
    [effectiveExpandedIds, filterResult.tasks],
  );
  const visibleTasks = allVisibleTasks.slice(0, MAX_VISIBLE_ROWS);
  const virtualWindow = ganttVirtualWindow(visibleTasks.length, scrollTop);
  const renderedTasks = visibleTasks.slice(
    virtualWindow.startIndex,
    virtualWindow.endIndex,
  );
  const viewport = useMemo(
    () =>
      renderer.createViewport(
        (filterResult.tasks.length > 0 ? filterResult.tasks : model.tasks).filter(
          (task) => scheduleState(task) !== "unscheduled",
        ),
        zoom,
        today,
      ),
    [filterResult.tasks, model.tasks, renderer, today, zoom],
  );
  const filteredTaskIds = useMemo(
    () => new Set(filterResult.tasks.map((task) => task.id)),
    [filterResult.tasks],
  );
  const selectedTask =
    selectedTaskId && filteredTaskIds.has(selectedTaskId)
      ? taskById.get(selectedTaskId)
      : undefined;
  const selectedWarnings = selectedTask
    ? [...new Set(warningsByKey.get(selectedTask.issueKey) ?? [])]
    : [];
  const dependencies = selectedTask
    ? selectedTask.dependencies.flatMap((id) => {
        const dependency = taskById.get(id);
        return dependency ? [dependency] : [];
      })
    : [];
  const gridStyle = {
    "--gantt-table-width": `${TABLE_WIDTH}px`,
    "--gantt-timeline-width": `${viewport.width}px`,
    "--gantt-day-width": `${viewport.dayWidth}px`,
  } as CSSProperties;

  const toggleExpanded = (taskId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const updateFilters = (nextFilters: GanttFilters) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    setScrollTop(0);
    setFilters(nextFilters);
  };

  const selectUnscheduledDate = (task: GanttTask, selectedDate: string) => {
    if (!editing || !editMode || dragConfirm) return;
    if (unscheduledDatePick?.taskId !== task.id) {
      setUnscheduledDatePick({ taskId: task.id, firstDate: selectedDate });
      return;
    }
    const startDate =
      unscheduledDatePick.firstDate <= selectedDate
        ? unscheduledDatePick.firstDate
        : selectedDate;
    const dueDate =
      unscheduledDatePick.firstDate <= selectedDate
        ? selectedDate
        : unscheduledDatePick.firstDate;
    const previewNonWorkingDays = countNonWorkingDays(startDate, dueDate, nonWorkingDays);
    setUnscheduledDatePick(undefined);
    setDragConfirm({
      taskId: task.id,
      result: { startDate, dueDate },
      error: undefined,
      nonWorkingDays: previewNonWorkingDays,
      ...(task.originalEstimateDays === undefined
        ? {}
        : { calendarDaysEstimate: task.originalEstimateDays + previewNonWorkingDays }),
      saving: false,
    });
  };

  const finishDrag = (event: PointerEvent) => {
    if (!drag || dragConfirm) return;
    const deltaPx = event.clientX - drag.startX;
    const wasDrag = Math.abs(deltaPx) >= 4;
    if (!wasDrag) {
      setDrag(undefined);
      return;
    }
    suppressClick.current = true;
    const task = taskById.get(drag.taskId);
    if (!task) return;
    const geometry = renderer.taskBar(task, viewport);
    const startOffset = geometry.left + (drag.gesture === "resize-end" ? 0 : deltaPx);
    const endOffset =
      geometry.left + geometry.width + (drag.gesture === "resize-start" ? 0 : deltaPx);
    const startDate = dateAtOffset(viewport, startOffset);
    const endDate = dateAtOffset(viewport, endOffset);
    const baseDate = drag.gesture === "resize-end" ? task.end : task.start;
    const movedDate = drag.gesture === "resize-end" ? endDate : startDate;
    const result = applyGanttDrag(task, drag.gesture, daysBetween(baseDate, movedDate));
    if (!result.allowed) {
      setDrag(undefined);
      setDragConfirm({
        taskId: task.id,
        result: {},
        error: result.reason,
        saving: false,
      });
      window.setTimeout(
        () =>
          setDragConfirm((current) =>
            current?.taskId === task.id && current.error === result.reason
              ? undefined
              : current,
          ),
        3000,
      );
    } else if (result.startDate !== undefined || result.dueDate !== undefined) {
      const previewNonWorkingDays = countNonWorkingDays(
        result.startDate ?? task.start,
        result.dueDate ?? task.end,
        nonWorkingDays,
      );
      setDrag({ ...drag, pixelDelta: deltaPx, dragging: true });
      setDragConfirm({
        taskId: task.id,
        result,
        error: undefined,
        nonWorkingDays: previewNonWorkingDays,
        ...(task.originalEstimateDays === undefined
          ? {}
          : {
              calendarDaysEstimate: task.originalEstimateDays + previewNonWorkingDays,
            }),
        saving: false,
      });
    } else {
      setDrag(undefined);
    }
  };

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      if (!pointerActive.current) return;
      setDrag((current) =>
        current
          ? {
              ...current,
              pixelDelta: event.clientX - current.startX,
              dragging: Math.abs(event.clientX - current.startX) >= 4,
            }
          : current,
      );
    };
    const up = (event: PointerEvent) => {
      pointerActive.current = false;
      finishDrag(event);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag, dragConfirm, renderer, taskById, viewport]);

  const saveDrag = async () => {
    if (!dragConfirm || !editing) return;
    const task = taskById.get(dragConfirm.taskId);
    if (!task) return;
    setDragConfirm((current) =>
      current ? { ...current, saving: true, error: undefined } : current,
    );
    try {
      // editmeta is useful for formatting datetime values, but it is not a
      // reliable permission gate for Jira Plans workflows.
      const metadata = await editing.client
        .getIssueEditMetadata(task.issueKey)
        .catch(() => undefined);
      const startField =
        metadata?.fields[editing.fieldMapping.startDateFieldId ?? "startdate"];
      const dueField = metadata?.fields[editing.fieldMapping.endDateFieldId ?? "duedate"];
      await editing.client.updateIssueDates(task.issueKey, {
        fieldMapping: editing.fieldMapping,
        ...(dragConfirm.result.startDate !== undefined
          ? { startDate: jiraDateValue(dragConfirm.result.startDate, startField) }
          : {}),
        ...(dragConfirm.result.dueDate !== undefined
          ? { dueDate: jiraDateValue(dragConfirm.result.dueDate, dueField) }
          : {}),
      });
      await editing.refresh();
      setDrag(undefined);
      setDragConfirm(undefined);
    } catch (error) {
      setDragConfirm((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: mutationErrorMessage(error),
            }
          : current,
      );
    }
  };

  if (model.tasks.length === 0) {
    return (
      <section
        id="gantt"
        className="gantt-workspace gantt-empty"
        aria-labelledby="gantt-title"
      >
        <p className="report-eyebrow">GANTT</p>
        <h2 id="gantt-title">No scheduled issues</h2>
        <p>The current JQL query returned no issues. Adjust it in Project setup.</p>
      </section>
    );
  }

  return (
    <section id="gantt" className="gantt-workspace" aria-labelledby="gantt-title">
      <header className="gantt-titlebar">
        <div>
          <p className="report-eyebrow">GANTT</p>
          <h2 id="gantt-title">Schedule workspace</h2>
          <p>
            {model.tasks.length} tasks ·{" "}
            {model.tasks.filter((task) => scheduleState(task) === "unscheduled").length}{" "}
            unscheduled · {model.dependencyCount} dependencies
          </p>
        </div>
        <div className="gantt-toolbar">
          {editing ? (
            <button
              className={editMode ? "edit-mode-button is-active" : "edit-mode-button"}
              type="button"
              aria-pressed={editMode}
              onClick={() => {
                setEditMode((current) => !current);
                setUnscheduledDatePick(undefined);
              }}
            >
              {editMode ? "Exit Edit mode" : "Edit Jira"}
            </button>
          ) : null}
          <div className="zoom-selector" role="group" aria-label="Timeline zoom">
            {(["day", "week", "month"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={zoom === value}
                onClick={() => setZoom(value)}
              >
                {value[0]?.toUpperCase()}
                {value.slice(1)}
              </button>
            ))}
          </div>
          <button
            className="today-button"
            type="button"
            disabled={viewport.todayOffset === undefined}
            title={
              viewport.todayOffset === undefined
                ? "Today is outside the loaded schedule range"
                : "Center today in the timeline"
            }
            onClick={() => {
              if (scrollRef.current) {
                renderer.scrollToToday(scrollRef.current, viewport);
              }
            }}
          >
            Today
          </button>
        </div>
      </header>

      <GanttFiltersToolbar
        filters={filters}
        options={filterOptions}
        directMatchCount={filterResult.directMatchIds.size}
        visibleCount={allVisibleTasks.length}
        totalCount={model.tasks.length}
        contextCount={filterResult.contextAncestorIds.size}
        renderedCount={virtualWindow.renderedRowCount}
        virtualized={virtualWindow.virtualized}
        searchPending={filters.search !== deferredSearch}
        hydrated={hydrated}
        active={filterResult.active}
        resetEnabled={
          isGanttFilterActive(filters) ||
          filters.includeDescendants ||
          filters.logic !== DEFAULT_GANTT_FILTERS.logic
        }
        onChange={updateFilters}
        onReset={() => updateFilters({ ...DEFAULT_GANTT_FILTERS })}
      />

      {allVisibleTasks.length > MAX_VISIBLE_ROWS ? (
        <div className="gantt-limit-warning" role="alert">
          Showing the first {MAX_VISIBLE_ROWS} expanded rows. Collapse hierarchy or narrow
          the Jira query.
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="gantt-scroll"
        style={gridStyle}
        role="grid"
        aria-label="Issue tree and Gantt timeline"
        aria-rowcount={visibleTasks.length + 1}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="gantt-grid-header" role="row">
          <div className="gantt-table-header">
            {(
              [
                ["issueKey", "Issue"],
                ["name", "Summary"],
                ["status", "Status"],
                ["assignee", "Assignee"],
              ] as const
            ).map(([column, label]) => {
              const sortState =
                sortBy === column
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none";
              return (
                <div
                  key={column}
                  role="columnheader"
                  aria-label={label}
                  aria-sort={sortState}
                >
                  <button
                    type="button"
                    className="gantt-sortable-header"
                    title="Sorts within each hierarchy level"
                    aria-label={`Sort ${label} within each hierarchy level`}
                    onClick={() => toggleSort(column)}
                  >
                    {label}
                    {sortState === "ascending"
                      ? " ▲"
                      : sortState === "descending"
                        ? " ▼"
                        : ""}
                  </button>
                </div>
              );
            })}
            <span role="columnheader" aria-label="Warnings">
              !
            </span>
          </div>
          <div className="gantt-timeline-header" role="columnheader">
            {viewport.ticks.map((tick) => (
              <span
                key={tick.date}
                className="gantt-tick"
                style={{ left: tick.left, width: tick.width }}
              >
                {tick.label}
              </span>
            ))}
            {viewport.todayOffset !== undefined ? (
              <span
                className="gantt-today-marker gantt-today-header"
                style={{ left: viewport.todayOffset }}
                aria-label={`Today, ${today}`}
              >
                Today
              </span>
            ) : null}
          </div>
        </div>

        <div className="gantt-grid-body" role="rowgroup">
          <GanttNonWorkingDaysLayer viewport={viewport} nonWorkingDays={nonWorkingDays} />
          <GanttDependencyLayer
            tasks={visibleTasks}
            viewport={viewport}
            renderer={renderer}
            renderStart={virtualWindow.startIndex}
            renderEnd={virtualWindow.endIndex}
            {...(selectedTaskId ? { selectedTaskId } : {})}
          />

          {virtualWindow.topSpacerHeight > 0 ? (
            <div
              className="gantt-grid-spacer"
              style={{ height: virtualWindow.topSpacerHeight }}
              role="presentation"
            />
          ) : null}

          {renderedTasks.map((task, index) => {
            const hasChildren = childrenByParent.has(task.id);
            const isExpanded = effectiveExpandedIds.has(task.id);
            const isFilterExpanded =
              filterResult.active && filterResult.autoExpandedIds.has(task.id);
            const isSelected = selectedTaskId === task.id;
            const isContextAncestor = filterResult.contextAncestorIds.has(task.id);
            const taskScheduleState = scheduleState(task);
            const isScheduled = taskScheduleState !== "unscheduled";
            const geometry = isScheduled ? renderer.taskBar(task, viewport) : undefined;
            const activeDrag =
              drag?.taskId === task.id && drag.dragging ? drag : undefined;
            const previewGeometry =
              activeDrag && geometry
                ? activeDrag.gesture === "move"
                  ? { left: geometry.left + activeDrag.pixelDelta, width: geometry.width }
                  : activeDrag.gesture === "resize-start"
                    ? {
                        left: geometry.left + activeDrag.pixelDelta,
                        width: geometry.width - activeDrag.pixelDelta,
                      }
                    : {
                        left: geometry.left,
                        width: geometry.width + activeDrag.pixelDelta,
                      }
                : geometry;
            const dragEnabled = Boolean(editing && editMode);
            const startEnabled = task.startSource === "jira";
            const endEnabled = task.endSource === "jira";
            const warnings = [...new Set(warningsByKey.get(task.issueKey) ?? [])];
            const riskMessages = [
              ...(task.isBlocked
                ? [
                    task.blockedByTaskIds?.length
                      ? `Blocked by ${task.blockedByTaskIds
                          .flatMap((id) => {
                            const dependency = taskById.get(id);
                            return dependency ? [dependency.issueKey] : [];
                          })
                          .join(", ")}`
                      : "Blocked by Jira status",
                  ]
                : []),
              ...warnings,
            ];
            return (
              <div
                key={task.id}
                className={`gantt-grid-row${isSelected ? " is-selected" : ""}${isContextAncestor ? " is-filter-context" : ""}`}
                role="row"
                aria-rowindex={virtualWindow.startIndex + index + 2}
              >
                <div className="gantt-issue-cell" role="gridcell">
                  <span
                    className="gantt-indent"
                    style={{ width: Math.min(task.depth, 5) * 12 }}
                    aria-hidden="true"
                  />
                  {hasChildren ? (
                    <button
                      className="gantt-expand-button"
                      type="button"
                      aria-label={
                        isFilterExpanded
                          ? `${task.issueKey} expanded for filter results`
                          : `${isExpanded ? "Collapse" : "Expand"} ${task.issueKey}`
                      }
                      aria-expanded={isExpanded}
                      disabled={isFilterExpanded}
                      title={
                        isFilterExpanded
                          ? "This ancestor stays expanded while its descendants match filters."
                          : undefined
                      }
                      onClick={() => toggleExpanded(task.id)}
                    >
                      {isExpanded ? "−" : "+"}
                    </button>
                  ) : (
                    <span className="gantt-expand-spacer" aria-hidden="true" />
                  )}
                  <button
                    className="gantt-issue-selector"
                    type="button"
                    aria-label={`Select ${task.issueKey}: ${task.name}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <strong>{task.issueKey}</strong>
                    <span title={task.name}>{task.name}</span>
                    <span className={`gantt-status ${statusClass(task)}`}>
                      {task.statusName}
                    </span>
                    <span title={task.assigneeName ?? "Unassigned"}>
                      {task.assigneeName ?? "Unassigned"}
                    </span>
                    <span className={`gantt-schedule-state is-${taskScheduleState}`}>
                      {SCHEDULE_STATE_LABELS[taskScheduleState]}
                    </span>
                    {riskMessages.length > 0 ? (
                      <span
                        className="date-warning-icon"
                        title={riskMessages.join("\n")}
                        aria-label={`${task.issueKey} has schedule risks or warnings`}
                      >
                        {task.isBlocked ? "Blocked" : "Needs attention"}
                      </span>
                    ) : (
                      <span />
                    )}
                  </button>
                </div>
                <div className="gantt-timeline-cell" role="gridcell">
                  {viewport.todayOffset !== undefined ? (
                    <span
                      className="gantt-today-marker"
                      style={{ left: viewport.todayOffset }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {isScheduled && previewGeometry ? (
                    <button
                      className={`gantt-task-bar ${statusClass(task)}${task.isBlocked ? " is-blocked" : ""}${task.hasDateMisalignment ? " date-misaligned" : ""}`}
                      type="button"
                      style={{
                        left: previewGeometry.left,
                        width: Math.max(8, previewGeometry.width),
                        cursor: dragEnabled
                          ? startEnabled && endEnabled
                            ? "grab"
                            : "not-allowed"
                          : undefined,
                      }}
                      aria-label={`Select ${task.issueKey}, ${task.start} to ${task.end}, ${task.progress}% complete${task.isBlocked ? ", blocked" : ""}${task.hasDateMisalignment ? ", date mismatch with rollup" : ""}`}
                      aria-pressed={isSelected}
                      onClick={() => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        setSelectedTaskId(task.id);
                      }}
                      onPointerDown={(event) => {
                        if (!dragEnabled) return;
                        const rect = event.currentTarget.getBoundingClientRect();
                        const edge = 8;
                        const fromLeft = event.clientX - rect.left;
                        const fromRight = rect.right - event.clientX;
                        const gesture =
                          fromLeft <= edge
                            ? "resize-start"
                            : fromRight <= edge
                              ? "resize-end"
                              : "move";
                        if (
                          (gesture === "move" && (!startEnabled || !endEnabled)) ||
                          (gesture === "resize-start" && !startEnabled) ||
                          (gesture === "resize-end" && !endEnabled)
                        )
                          return;
                        pointerActive.current = true;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        setDrag({
                          taskId: task.id,
                          gesture,
                          startX: event.clientX,
                          pixelDelta: 0,
                          dragging: false,
                        });
                      }}
                      title={
                        dragEnabled && (!startEnabled || !endEnabled)
                          ? "Set explicit start/end dates in Jira to enable dragging"
                          : undefined
                      }
                    >
                      <span
                        className="gantt-task-progress"
                        style={{ width: `${task.progress}%` }}
                        aria-hidden="true"
                      />
                      <span className="gantt-task-label">{task.issueKey}</span>
                    </button>
                  ) : (
                    <button
                      className="gantt-unscheduled-message"
                      type="button"
                      disabled={!dragEnabled}
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        selectUnscheduledDate(
                          task,
                          dateAtOffset(viewport, event.clientX - rect.left),
                        );
                      }}
                      title={
                        dragEnabled
                          ? "Click once for Start, then click again for Due"
                          : "Enable Edit Jira to set Start and Due dates"
                      }
                    >
                      {unscheduledDatePick?.taskId === task.id
                        ? `Start: ${unscheduledDatePick.firstDate}. Click a second date for Due.`
                        : "Unscheduled — click twice to set Start and Due dates."}
                    </button>
                  )}
                  {dragConfirm?.taskId === task.id ? (
                    <div
                      className="gantt-drag-confirm"
                      role="dialog"
                      aria-label={`Confirm date change for ${task.issueKey}`}
                    >
                      {dragConfirm.error ? (
                        <p role="alert">{dragConfirm.error}</p>
                      ) : (
                        <>
                          <p>
                            Save{" "}
                            {dragConfirm.result.startDate
                              ? `start ${dragConfirm.result.startDate}`
                              : ""}
                            {dragConfirm.result.startDate && dragConfirm.result.dueDate
                              ? " and "
                              : ""}
                            {dragConfirm.result.dueDate
                              ? `due ${dragConfirm.result.dueDate}`
                              : ""}{" "}
                            in Jira?
                          </p>
                          <p className="gantt-drag-estimate">
                            Non-working days: {dragConfirm.nonWorkingDays ?? 0}
                            {dragConfirm.calendarDaysEstimate === undefined
                              ? ""
                              : ` · Calendar days estimate: ${calendarEstimateLabel(dragConfirm.calendarDaysEstimate)}`}
                          </p>
                        </>
                      )}
                      {!dragConfirm.error ? (
                        <button
                          type="button"
                          onClick={() => void saveDrag()}
                          disabled={dragConfirm.saving}
                        >
                          Save
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void saveDrag()}
                          disabled={dragConfirm.saving}
                        >
                          Retry
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setDrag(undefined);
                          setDragConfirm(undefined);
                          setUnscheduledDatePick(undefined);
                        }}
                        disabled={dragConfirm.saving}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {virtualWindow.bottomSpacerHeight > 0 ? (
            <div
              className="gantt-grid-spacer"
              style={{ height: virtualWindow.bottomSpacerHeight }}
              role="presentation"
            />
          ) : null}

          {filterResult.active && visibleTasks.length === 0 ? (
            <div className="gantt-no-results" role="status">
              <strong>No issues match these filters.</strong>
              <span>Reset filters or broaden the selected values.</span>
            </div>
          ) : null}
        </div>
      </div>

      <aside className="gantt-details" aria-live="polite" aria-label="Task details">
        {selectedTask ? (
          <>
            <div className="gantt-details-heading">
              <div>
                <span className={`gantt-status ${statusClass(selectedTask)}`}>
                  {selectedTask.statusName}
                </span>
                {selectedTask.isBlocked ? (
                  <span className="gantt-risk-badge">Blocked</span>
                ) : null}
                <h3>
                  {selectedTask.issueKey} · {selectedTask.name}
                </h3>
              </div>
              <a
                className="jira-link"
                href={selectedTask.browseUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in Jira ↗
              </a>
            </div>
            <dl className="gantt-details-grid">
              <div>
                <dt>Start</dt>
                <dd>{selectedTask.start}</dd>
                <span>{sourceLabel(selectedTask.startSource)}</span>
              </div>
              <div>
                <dt>End</dt>
                <dd>{selectedTask.end}</dd>
                <span>{sourceLabel(selectedTask.endSource)}</span>
              </div>
              <div>
                <dt>Progress</dt>
                <dd>{selectedTask.progress}%</dd>
                <span>{sourceLabel(selectedTask.progressSource)}</span>
              </div>
              <div>
                <dt>Assignee</dt>
                <dd>{selectedTask.assigneeName ?? "Unassigned"}</dd>
                <span>{selectedTask.issueTypeName}</span>
              </div>
              <div>
                <dt>Original estimate</dt>
                <dd>
                  {selectedTask.originalEstimateDays === undefined
                    ? "Not set"
                    : estimateLabel(selectedTask.originalEstimateDays)}
                </dd>
                <span>Jira estimate · 8 h/day</span>
              </div>
              <div>
                <dt>Non-working days</dt>
                <dd>{selectedTask.nonWorkingDays ?? 0}</dd>
                <span>Current date range</span>
              </div>
              <div>
                <dt>Calendar days estimate</dt>
                <dd>
                  {selectedTask.calendarDaysEstimate === undefined
                    ? "Not set"
                    : calendarEstimateLabel(selectedTask.calendarDaysEstimate)}
                </dd>
                <span>Estimate + non-working days</span>
              </div>
            </dl>
            {dependencies.length > 0 ? (
              <div className="gantt-detail-links">
                <strong>Depends on</strong>
                {dependencies.map((dependency) => (
                  <a
                    key={dependency.id}
                    href={dependency.browseUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {dependency.issueKey}
                  </a>
                ))}
              </div>
            ) : null}
            {selectedWarnings.length > 0 ? (
              <div className="gantt-detail-warning" role="status">
                <strong>Date and hierarchy warnings</strong>
                <ul>
                  {selectedWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {editing && editMode ? (
              <GanttEditPanel
                key={selectedTask.issueKey}
                task={selectedTask}
                tasks={model.tasks}
                editing={editing}
              />
            ) : null}
          </>
        ) : (
          <p>Select an issue row or timeline bar to inspect dates and progress.</p>
        )}
      </aside>
    </section>
  );
}
