import {
  DEFAULT_GANTT_FILTERS,
  filterGanttTasks,
  isGanttFilterActive,
  type GanttFilters,
  type GanttScheduleModel,
  type GanttTask,
} from "@power-view/domain";
import { type CSSProperties, useDeferredValue, useMemo, useRef, useState } from "react";

import { GanttEditPanel, type GanttEditingContext } from "./GanttEditPanel";
import { GanttDependencyLayer } from "./GanttDependencyLayer";
import { GanttFiltersToolbar } from "./GanttFiltersToolbar";
import { type GanttRenderer, nativeGanttRenderer } from "./GanttRenderer";
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

function initialExpandedTasks(tasks: GanttTask[]): Set<string> {
  return new Set(tasks.filter((task) => task.expanded).map((task) => task.id));
}

function statusClass(task: GanttTask): string {
  return `status-${task.statusCategory}`;
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
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
}: GanttViewProps) {
  const { zoom, setZoom } = usePersistedGanttZoom(filterPersistence);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    initialExpandedTasks(model.tasks),
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [editMode, setEditMode] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { filters, setFilters, hydrated } = usePersistedGanttFilters(filterPersistence);
  const deferredSearch = useDeferredValue(filters.search);
  const appliedFilters = useMemo<GanttFilters>(
    () => ({ ...filters, search: deferredSearch }),
    [deferredSearch, filters],
  );
  const filterResult = useMemo(
    () => filterGanttTasks(model.tasks, appliedFilters, today),
    [appliedFilters, model.tasks, today],
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
        filterResult.tasks.length > 0 ? filterResult.tasks : model.tasks,
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

  if (model.tasks.length === 0) {
    return (
      <section
        id="gantt"
        className="gantt-workspace gantt-empty"
        aria-labelledby="gantt-title"
      >
        <p className="setup-step">MILESTONE 8 · GANTT</p>
        <h2 id="gantt-title">No scheduled issues</h2>
        <p>The current JQL query returned no issues. Adjust it in Project setup.</p>
      </section>
    );
  }

  return (
    <section id="gantt" className="gantt-workspace" aria-labelledby="gantt-title">
      <header className="gantt-titlebar">
        <div>
          <p className="setup-step">MILESTONE 8 · GANTT</p>
          <h2 id="gantt-title">Schedule workspace</h2>
          <p>
            {model.tasks.length} tasks · {model.syntheticDateCount} inferred dates ·{" "}
            {model.dependencyCount} dependencies
          </p>
        </div>
        <div className="gantt-toolbar">
          {editing ? (
            <button
              className={editMode ? "edit-mode-button is-active" : "edit-mode-button"}
              type="button"
              aria-pressed={editMode}
              onClick={() => setEditMode((current) => !current)}
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
          <div className="gantt-table-header" role="columnheader">
            <span>Issue</span>
            <span>Summary</span>
            <span>Status</span>
            <span>Assignee</span>
            <span aria-label="Warnings">!</span>
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
            const geometry = renderer.taskBar(task, viewport);
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
                    {riskMessages.length > 0 ? (
                      <span
                        className="date-warning-icon"
                        title={riskMessages.join("\n")}
                        aria-label={`${task.issueKey} has schedule risks or warnings`}
                      >
                        {task.isBlocked ? "B" : "!"}
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
                  <button
                    className={`gantt-task-bar ${statusClass(task)}${task.isBlocked ? " is-blocked" : ""}${task.hasDateMisalignment ? " date-misaligned" : ""}`}
                    type="button"
                    style={{ left: geometry.left, width: geometry.width }}
                    aria-label={`Select ${task.issueKey}, ${task.start} to ${task.end}, ${task.progress}% complete${task.isBlocked ? ", blocked" : ""}${task.hasDateMisalignment ? ", date mismatch with rollup" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <span
                      className="gantt-task-progress"
                      style={{ width: `${task.progress}%` }}
                      aria-hidden="true"
                    />
                    <span className="gantt-task-label">{task.issueKey}</span>
                  </button>
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
