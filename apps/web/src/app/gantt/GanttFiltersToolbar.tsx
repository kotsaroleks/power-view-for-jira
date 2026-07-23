import {
  NO_LABEL_FILTER_VALUE,
  NO_PRIORITY_FILTER_VALUE,
  UNASSIGNED_FILTER_VALUE,
  type GanttDateFilter,
  type GanttFilters,
  type GanttRiskFilter,
  type JiraStatusCategory,
} from "@power-view/domain";

export interface GanttFilterOptions {
  statuses: string[];
  assignees: string[];
  issueTypes: string[];
  priorities: string[];
  labels: string[];
  hasUnassigned: boolean;
  hasNoPriority: boolean;
  hasNoLabels: boolean;
}

export interface GanttFiltersToolbarProps {
  filters: GanttFilters;
  options: GanttFilterOptions;
  directMatchCount: number;
  visibleCount: number;
  totalCount: number;
  contextCount: number;
  renderedCount: number;
  virtualized: boolean;
  searchPending: boolean;
  hydrated: boolean;
  active: boolean;
  resetEnabled: boolean;
  onChange: (filters: GanttFilters) => void;
  onReset: () => void;
}

interface FilterOption<Value extends string> {
  value: Value;
  label: string;
}

interface MultiSelectFilterProps<Value extends string> {
  label: string;
  allLabel: string;
  selected: Value[];
  options: Array<FilterOption<Value>>;
  onChange: (selected: Value[]) => void;
}

const STATUS_CATEGORIES: Array<FilterOption<JiraStatusCategory>> = [
  { value: "to-do", label: "To do" },
  { value: "in-progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "unknown", label: "Unknown" },
];

const DATE_FILTERS: Array<FilterOption<GanttDateFilter>> = [
  { value: "explicit", label: "Explicit dates" },
  { value: "partial", label: "Partially inferred" },
  { value: "inferred", label: "Fully inferred" },
  { value: "corrected", label: "Corrected dates" },
  { value: "overdue", label: "Overdue unresolved" },
];

const RISK_FILTERS: Array<FilterOption<GanttRiskFilter>> = [
  { value: "blocked", label: "Blocked" },
  { value: "unresolved", label: "Unresolved" },
];

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function MultiSelectFilter<Value extends string>({
  label,
  allLabel,
  selected,
  options,
  onChange,
}: MultiSelectFilterProps<Value>) {
  const selectedLabels = options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label);
  const summary =
    selectedLabels.length === 0
      ? allLabel
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} selected`;

  const toggle = (value: Value, checked: boolean) => {
    onChange(
      checked
        ? [...selected, value]
        : selected.filter((selectedValue) => selectedValue !== value),
    );
  };

  return (
    <div className="gantt-filter-field">
      <span className="gantt-filter-label">{label}</span>
      <details className="gantt-multiselect" name="gantt-filter">
        <summary aria-label={`${label}: ${summary}`}>
          <span>{summary}</span>
          {selected.length > 0 ? (
            <strong aria-label={`${selected.length} selected`}>{selected.length}</strong>
          ) : null}
        </summary>
        <div
          className="gantt-multiselect-menu"
          role="group"
          aria-label={`${label} options`}
        >
          <div className="gantt-multiselect-options">
            {options.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  aria-label={`${label}: ${option.label}`}
                  onChange={(event) => toggle(option.value, event.target.checked)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            aria-label={`Clear ${label} selection`}
            disabled={selected.length === 0}
            onClick={() => onChange([])}
          >
            Clear selection
          </button>
        </div>
      </details>
    </div>
  );
}

export function GanttFiltersToolbar({
  filters,
  options,
  directMatchCount,
  visibleCount,
  totalCount,
  contextCount,
  renderedCount,
  virtualized,
  searchPending,
  hydrated,
  active,
  resetEnabled,
  onChange,
  onReset,
}: GanttFiltersToolbarProps) {
  const update = <Key extends keyof GanttFilters>(key: Key, value: GanttFilters[Key]) =>
    onChange({ ...filters, [key]: value });

  return (
    <form
      className="gantt-filters"
      aria-label="Gantt filters"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="gantt-search-filter">
        <span>Search</span>
        <input
          type="search"
          value={filters.search}
          maxLength={512}
          placeholder="Issue key or summary"
          onChange={(event) => update("search", event.target.value)}
        />
      </label>

      <MultiSelectFilter
        label="Status"
        allLabel="All statuses"
        selected={filters.statuses}
        options={options.statuses.map((status) => ({ value: status, label: status }))}
        onChange={(selected) => update("statuses", selected)}
      />

      <MultiSelectFilter
        label="Category"
        allLabel="All categories"
        selected={filters.statusCategories}
        options={STATUS_CATEGORIES}
        onChange={(selected) => update("statusCategories", selected)}
      />

      <MultiSelectFilter
        label="Assignee"
        allLabel="All assignees"
        selected={filters.assignees}
        options={[
          ...(options.hasUnassigned
            ? [{ value: UNASSIGNED_FILTER_VALUE, label: "Unassigned" }]
            : []),
          ...options.assignees.map((assignee) => ({
            value: assignee,
            label: assignee,
          })),
        ]}
        onChange={(selected) => update("assignees", selected)}
      />

      <MultiSelectFilter
        label="Issue type"
        allLabel="All types"
        selected={filters.issueTypes}
        options={options.issueTypes.map((issueType) => ({
          value: issueType,
          label: issueType,
        }))}
        onChange={(selected) => update("issueTypes", selected)}
      />

      <MultiSelectFilter
        label="Priority"
        allLabel="All priorities"
        selected={filters.priorities}
        options={[
          ...(options.hasNoPriority
            ? [{ value: NO_PRIORITY_FILTER_VALUE, label: "No priority" }]
            : []),
          ...options.priorities.map((priority) => ({
            value: priority,
            label: priority,
          })),
        ]}
        onChange={(selected) => update("priorities", selected)}
      />

      <MultiSelectFilter
        label="Labels"
        allLabel="All labels"
        selected={filters.labels}
        options={[
          ...(options.hasNoLabels
            ? [{ value: NO_LABEL_FILTER_VALUE, label: "No labels" }]
            : []),
          ...options.labels.map((label) => ({ value: label, label })),
        ]}
        onChange={(selected) => update("labels", selected)}
      />

      <MultiSelectFilter
        label="Date quality"
        allLabel="All dates"
        selected={filters.dateFilters}
        options={DATE_FILTERS}
        onChange={(selected) => update("dateFilters", selected)}
      />

      <MultiSelectFilter
        label="Risk"
        allLabel="All risks"
        selected={filters.riskFilters}
        options={RISK_FILTERS}
        onChange={(selected) => update("riskFilters", selected)}
      />

      <div className="gantt-filter-actions">
        <div className="gantt-filter-logic">
          <span>Dropdown logic</span>
          <div role="group" aria-label="Dropdown filter logic">
            {(["and", "or"] as const).map((logic) => (
              <button
                key={logic}
                type="button"
                aria-pressed={filters.logic === logic}
                onClick={() => update("logic", logic)}
              >
                {logic.toUpperCase()}
              </button>
            ))}
          </div>
          <small>
            {filters.logic === "and"
              ? "Match every active dropdown"
              : "Match any active dropdown"}
            {" · Search always narrows"}
          </small>
        </div>

        <label className="gantt-descendants-toggle">
          <input
            type="checkbox"
            checked={filters.includeDescendants}
            onChange={(event) => update("includeDescendants", event.target.checked)}
          />
          <span>Include descendants</span>
        </label>
        <button type="button" disabled={!resetEnabled} onClick={onReset}>
          Reset filters
        </button>
      </div>

      <div className="gantt-filter-summary" role="status" aria-live="polite">
        <strong>
          {active
            ? `${countLabel(directMatchCount, "match", "matches")} · ${countLabel(visibleCount, "row")}`
            : `${visibleCount} of ${countLabel(totalCount, "row")}`}
        </strong>
        <span>
          {contextCount > 0 ? `${countLabel(contextCount, "context ancestor")} · ` : ""}
          {virtualized
            ? `${countLabel(renderedCount, "DOM row")} rendered`
            : "all rows rendered"}
          {searchPending ? " · filtering…" : ""}
          {!hydrated ? " · loading saved filters…" : ""}
        </span>
      </div>
    </form>
  );
}
