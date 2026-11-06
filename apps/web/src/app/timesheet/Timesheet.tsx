import { timeZoneWarning } from "./time-zone-warning";
import { WorklogDialog } from "./WorklogDialog";
import { DayOffToggle } from "./DayOffToggle";
import { browserDayOffStore } from "../day-off/browser-github-day-off";
import { useSharedDayOff } from "../day-off/use-shared-day-off";
import type { DayOffStore } from "../day-off/DayOffStore";
import { usePriorityIssues } from "./use-priority-issues";
import { WeeklyTaskControls } from "./WeeklyTaskControls";
import { WeeklyTimeCell } from "./WeeklyTimeCell";
import { weeklyRows } from "./weekly-row-model";
import { useWeeklyTasks } from "./use-weekly-tasks";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WorklogIdentityError,
  type TimesheetApi,
  type TimesheetIssue,
  type TimesheetWorklog,
} from "@power-view/jira-client";
import {
  adjacentPeriod,
  dayInZone,
  duration,
  loadTimesheet,
  periodDays,
  scopeJql,
  sumWorklogs,
  timesheetRows,
  type PeriodMode,
  type TimesheetData,
  type TimesheetQuery,
} from "./timesheet-model";
import { WorklogForm } from "./WorklogForm";
import "./timesheet.css";

interface Preferences {
  zone: string;
  zoneSource: "jira" | "custom";
  mode: PeriodMode;
  projectIds: string[];
  explicitJql: string;
}
function validTimeZone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    dayInZone(new Date(), value);
    return value;
  } catch {
    return undefined;
  }
}
function preferences(key: string, profileZone: string): Preferences {
  const defaults: Preferences = {
    zone: profileZone,
    zoneSource: "jira",
    mode: "week",
    projectIds: [],
    explicitJql: "",
  };
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem(key) ??
        localStorage.getItem(key.replace("timesheet:v3", "timesheet:v2")) ??
        "null",
    );
    if (!raw || typeof raw !== "object") return defaults;
    const value = raw as Partial<Preferences>;
    const wasCustom =
      value.zoneSource === "custom" ||
      (value.zoneSource === undefined &&
        value.zone !== "Europe/Kyiv" &&
        value.zone !== "Europe/Kiev");
    const customZone = wasCustom ? validTimeZone(value.zone) : undefined;
    return {
      zone: customZone ?? defaults.zone,
      zoneSource: customZone ? "custom" : "jira",
      mode: "week",
      projectIds: Array.isArray(value.projectIds)
        ? value.projectIds
            .filter((id) => typeof id === "string" && /^\d+$/.test(id))
            .slice(0, 100)
        : [],
      explicitJql:
        typeof value.explicitJql === "string" ? value.explicitJql.slice(0, 10_000) : "",
    };
  } catch {
    return defaults;
  }
}
export interface TimesheetProps {
  api: TimesheetApi;
  dayOffStore?: DayOffStore;
  baseUrl: string;
  accountId: string;
  userName: string;
  jiraTimeZone?: string;
  setupJql?: string;
  onGuardChange?: (guard: (() => boolean) | undefined) => void;
}
export function Timesheet({
  api,
  dayOffStore = browserDayOffStore(),
  baseUrl,
  accountId,
  userName,
  jiraTimeZone,
  setupJql,
  onGuardChange,
}: TimesheetProps) {
  const profileZone = validTimeZone(jiraTimeZone);
  const defaultZone = profileZone ?? "Europe/Kyiv";
  const preferenceKey = `power-view:timesheet:v3:${baseUrl.replace(/\/$/, "")}:${accountId}`;
  const [prefs, setPrefs] = useState(() => preferences(preferenceKey, defaultZone));
  const { zone, mode, projectIds, explicitJql } = prefs;
  const [anchor, setAnchor] = useState(() => dayInZone(new Date(), zone));
  const [search, setSearch] = useState("");
  const [knownIssues, setKnownIssues] = useState<TimesheetIssue[]>([]);
  const weekly = useWeeklyTasks(api, baseUrl, accountId);
  const priority = usePriorityIssues(api, baseUrl, accountId, weekly.issues);
  const includedIssues = useMemo(
    () => [
      ...new Map(
        [
          ...knownIssues,
          ...(mode === "week" ? [...weekly.selected, ...priority.issues] : []),
        ].map((issue) => [issue.id, issue]),
      ).values(),
    ],
    [knownIssues, weekly.selected, priority.issues, mode],
  );
  const copyController = useRef<AbortController | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  useEffect(() => () => copyController.current?.abort(), []);
  const [pendingCell, setPendingCell] = useState<{ key: string; day: string }>();
  const activities = useRef(new Set<string>());
  const [inlineActive, setInlineActive] = useState(false);
  const onCellActivity = useCallback((key: string, active: boolean) => {
    if (active) activities.current.add(key);
    else activities.current.delete(key);
    setInlineActive(activities.current.size > 0);
  }, []);
  const [manualKey, setManualKey] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [dayOffActionError, setDayOffActionError] = useState("");
  const [manualError, setManualError] = useState("");
  const [snapshot, setSnapshot] = useState<{ key: string; data: TimesheetData }>();
  const [load, setLoad] = useState({
    key: "",
    loading: true,
    progress: "Reading Jira user…",
    error: "",
  });
  const [identityError, setIdentityError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const lastLoaded = useRef<
    | {
        api: TimesheetApi;
        key: string;
        refresh: number;
        issueIds: Set<string>;
      }
    | undefined
  >(undefined);
  const controllerRef = useRef<AbortController | null>(null);
  const [detail, setDetail] = useState<{ issue: TimesheetIssue; day: string }>();
  const detailTrigger = useRef<HTMLElement | null>(null);
  const detailTarget = useRef<{ issueId: string; day: string } | undefined>(undefined);
  const detailClose = useRef<HTMLButtonElement | null>(null);
  const [form, setForm] = useState<{
    issue: TimesheetIssue;
    day: string;
    original?: TimesheetWorklog;
    deleting?: boolean;
  }>();
  const [saved, setSaved] = useState<{
    message: string;
    issue: TimesheetIssue;
    log?: TimesheetWorklog;
  }>();
  const formGuard = useRef<(() => boolean) | undefined>(undefined);
  const registerGuard = useCallback((guard: (() => boolean) | undefined) => {
    formGuard.current = guard;
  }, []);
  useEffect(() => {
    const guard = () => activities.current.size === 0 && (formGuard.current?.() ?? true);
    onGuardChange?.(guard);
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (activities.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => {
      onGuardChange?.(undefined);
      window.removeEventListener("beforeunload", preventLoss);
    };
  }, [onGuardChange]);
  const [projectSearch, setProjectSearch] = useState("");
  const [projects, setProjects] = useState<
    Array<{ id: string; key: string; name: string }>
  >([]);
  const [projectError, setProjectError] = useState("");
  const days = useMemo(() => periodDays(anchor, mode), [anchor, mode]);
  const dayOff = useSharedDayOff(dayOffStore, baseUrl, [accountId], days, async () => {
    if ((await api.getUser()).accountId !== accountId) {
      setIdentityError(true);
      setSnapshot(undefined);
      throw new Error("The Jira account changed. Refresh before changing Day Off.");
    }
  });
  const daysOff = new Set(
    dayOff.dayOffs.filter((item) => item.userId === accountId).map((item) => item.date),
  );
  const checkDayOff = async (day: string) => {
    if (!dayOffStore || !dayOff.enforced) return;
    const result = await dayOffStore.read(baseUrl, [accountId], [day]);
    if (!result.complete)
      throw new Error(
        "Shared Day Off could not be verified. Refresh before logging time.",
      );
    if (result.dayOffs.some((item) => item.userId === accountId && item.date === day))
      throw new Error(
        "This date is marked Day off. Uncheck Day off before logging time.",
      );
  };
  const query: TimesheetQuery = useMemo(
    () => ({ days, timeZone: zone, projectIds, explicitJql }),
    [days, zone, projectIds, explicitJql],
  );
  const queryKey = JSON.stringify([baseUrl, accountId, query]);
  const data = snapshot?.key === queryKey && !identityError ? snapshot.data : undefined;
  const authorZone = data ? validTimeZone(data.user.timeZone) : profileZone;
  const zoneWarning = useMemo(
    () => timeZoneWarning(authorZone, days),
    [authorZone, days],
  );
  const loading = load.key !== queryKey || load.loading;
  const error = load.key === queryKey ? load.error : "";
  useEffect(() => {
    if (!pendingCell) return;
    const input = Array.from(
      document.querySelectorAll<HTMLInputElement>(".weekly-time-cell input"),
    ).find(
      (node) =>
        node.getAttribute("aria-label") ===
        `${pendingCell.key}, ${pendingCell.day}, hours`,
    );
    if (input && !input.disabled) {
      input.focus();
      setPendingCell(undefined);
    }
  }, [pendingCell, data, loading]);
  const partial = data?.state === "partial";
  const patchPrefs = (value: Partial<Preferences>) => {
    if (!activities.current.size) setPrefs((current) => ({ ...current, ...value }));
  };
  const changeAnchor = (value: string) => {
    if (!activities.current.size) setAnchor(value);
  };
  useEffect(() => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(prefs));
    } catch {
      /* Preferences must not prevent live work. */
    }
  }, [preferenceKey, prefs]);
  useEffect(() => {
    // Pinning or remembering an already loaded issue changes presentation only.
    // Avoid disabling the grid and stealing the next cell's focus after a save.
    if (
      lastLoaded.current?.api === api &&
      lastLoaded.current.key === queryKey &&
      lastLoaded.current.refresh === refresh &&
      includedIssues.every((issue) => lastLoaded.current!.issueIds.has(issue.id))
    ) {
      // A selection can return to the already loaded subset while a broader
      // read is being cancelled by this effect's cleanup.
      setLoad((current) =>
        current.key === queryKey && current.loading
          ? { ...current, loading: false, progress: "" }
          : current,
      );
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoad({ key: queryKey, loading: true, progress: "Reading Jira user…", error: "" });
    setDetail(undefined);
    void loadTimesheet(
      api,
      query,
      accountId,
      includedIssues,
      controller.signal,
      (progress) => {
        if (!controller.signal.aborted)
          setLoad({ key: queryKey, loading: true, progress, error: "" });
      },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          lastLoaded.current = {
            api,
            key: queryKey,
            refresh,
            issueIds: new Set(result.issues.map((issue) => issue.id)),
          };
          setSnapshot({ key: queryKey, data: result });
          setIdentityError(false);
          setLoad({ key: queryKey, loading: false, progress: "", error: "" });
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          controller.abort();
          if (reason instanceof WorklogIdentityError) {
            setSnapshot(undefined);
            setIdentityError(true);
            setForm(undefined);
          }
          setLoad({
            key: queryKey,
            loading: false,
            progress: "",
            error:
              reason instanceof Error
                ? reason.message
                : "Jira could not load the timesheet. Check your Jira session and retry.",
          });
        }
      });
    return () => controller.abort();
  }, [api, query, queryKey, accountId, includedIssues, refresh]);
  useEffect(() => {
    if (detail) detailClose.current?.focus();
  }, [detail]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setProjectError("");
      void api
        .searchProjects(projectSearch, controller.signal)
        .then((values) => {
          if (!controller.signal.aborted) setProjects(values);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setProjectError(
              "Projects could not be loaded. Your current filters are unchanged.",
            );
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, projectSearch]);
  const rows = useMemo(
    () =>
      data
        ? timesheetRows(
            {
              ...data,
              issues: [
                ...new Map(
                  [...data.issues, ...(mode === "week" ? weekly.issues : [])].map(
                    (issue) => [issue.id, issue],
                  ),
                ).values(),
              ],
            },
            days,
            zone,
            mode === "week" ? [...includedIssues, ...weekly.issues] : includedIssues,
          )
        : [],
    [data, days, zone, includedIssues, mode, weekly.issues],
  );
  const visible = useMemo(
    () =>
      mode === "week"
        ? weeklyRows({
            rows,
            boardIssues: weekly.issues,
            accountId,
            pins: weekly.pins,
            priorities: priority.keys,
            expanded: weekly.expanded,
            search,
          })
        : rows
            .filter((row) =>
              `${row.issue.key} ${row.issue.summary}`
                .toLowerCase()
                .includes(search.trim().toLowerCase()),
            )
            .map((row) => ({
              ...row,
              group: 0,
              depth: 0,
              hasChildren: false,
              withoutParent: false,
              parentHeading: undefined,
            })),
    [
      rows,
      mode,
      weekly.issues,
      weekly.pins,
      weekly.expanded,
      priority.keys,
      accountId,
      search,
    ],
  );
  const withoutParentIndex = visible.findIndex((row) => row.withoutParent);
  const total = (selected: typeof rows) =>
    selected.reduce(
      (sum, row) =>
        sum +
        [...row.cells.values()].reduce((value, logs) => value + sumWorklogs(logs), 0),
      0,
    );
  const count = rows.filter((row) => row.cells.size).length;
  const openDetails = (issue: TimesheetIssue, day: string, trigger: HTMLElement) => {
    detailTrigger.current = trigger;
    detailTarget.current = { issueId: issue.id, day };
    setDetail({ issue, day });
  };
  const restoreDetailFocus = () => {
    if (detailTrigger.current?.isConnected) {
      detailTrigger.current.focus();
      return;
    }
    const target = detailTarget.current;
    const cell = [...document.querySelectorAll<HTMLElement>("[data-worklog-cell]")].find(
      (element) => element.dataset.worklogCell === `${target?.issueId}:${target?.day}`,
    );
    const targetField = cell?.querySelector<HTMLElement>(
      "input:not([disabled]), button:not([disabled])",
    );
    (
      targetField ?? document.querySelector<HTMLElement>(".timesheet-table-scroll")
    )?.focus();
  };
  const closeDetails = () => {
    if (formGuard.current && !formGuard.current()) return;
    setForm(undefined);
    setDetail(undefined);
  };
  const dateLabel = (day: string) =>
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${day}T12:00:00Z`));
  const openForm = (value: NonNullable<typeof form>) => {
    if (formGuard.current && !formGuard.current()) return;
    setDetail(undefined);
    setForm(value);
  };
  const addKnown = (issue: TimesheetIssue) =>
    setKnownIssues((current) =>
      current.some((item) => item.id === issue.id) ? current : [...current, issue],
    );
  const checkIssue = async () => {
    const key = manualKey.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) {
      setManualError("Enter a Jira key such as LBR-123.");
      return;
    }
    setManualBusy(true);
    setManualError("");
    try {
      const issue = await api.getIssue(key);
      const scope = scopeJql(query);
      if (
        scope &&
        !(await api.search(`id = ${issue.id} AND ${scope}`)).issues.some(
          (item) => item.id === issue.id,
        )
      ) {
        setManualError(
          "This issue does not match the current filters. Clear the filters to show it and enter hours in its row.",
        );
        return;
      }
      addKnown(issue);
      setManualKey("");
      setRefresh((value) => value + 1);
    } catch (reason) {
      setManualError(
        reason instanceof Error ? reason.message : "Jira could not read the issue.",
      );
    } finally {
      setManualBusy(false);
    }
  };
  const copyPreviousTasks = async () => {
    const controller = new AbortController();
    copyController.current = controller;
    setCopying(true);
    setCopyMessage("");
    onCellActivity("copy-tasks", true);
    try {
      const previousDays = periodDays(adjacentPeriod(anchor, "week", -1), "week");
      const previous = await loadTimesheet(
        api,
        { ...query, days: previousDays },
        accountId,
        [],
        controller.signal,
        () => undefined,
      );
      if (previous.state === "partial")
        throw new Error("Previous week could not be read completely. Try again.");
      const ids = new Set(previous.worklogs.map((log) => log.issueId));
      const tasks = previous.issues.filter((issue) => ids.has(issue.id));
      setKnownIssues((current) => [
        ...new Map([...current, ...tasks].map((issue) => [issue.id, issue])).values(),
      ]);
      setCopyMessage(
        `Added ${tasks.length} task rows from last week. No hours were copied.`,
      );
    } catch (reason) {
      if (!controller.signal.aborted)
        setCopyMessage(
          reason instanceof Error ? reason.message : "Previous week could not be loaded.",
        );
      if (reason instanceof WorklogIdentityError) {
        setIdentityError(true);
        setSnapshot(undefined);
      }
    } finally {
      if (!controller.signal.aborted) {
        setCopying(false);
        onCellActivity("copy-tasks", false);
      }
    }
  };
  const handleSaved = async (issue: TimesheetIssue, log?: TimesheetWorklog) => {
    setSaved({
      message: log ? "Worklog saved in Jira." : "Worklog deleted in Jira.",
      issue,
      ...(log ? { log } : {}),
    });
    addKnown(issue);
    try {
      const logs = await api.getWorklogs(issue);
      if ((await api.getUser()).accountId !== accountId)
        throw new WorklogIdentityError(
          "The Jira account changed. Reconnect in Settings.",
        );
      const daySet = new Set(days);
      setSnapshot((current) => {
        if (
          !current ||
          current.key !== queryKey ||
          !current.data.issues.some((item) => item.id === issue.id)
        )
          return current;
        const worklogs = [
          ...current.data.worklogs.filter((record) => record.issueId !== issue.id),
          ...logs.filter(
            (record) =>
              record.authorId === accountId &&
              daySet.has(dayInZone(record.started, zone)),
          ),
        ];
        const failures = current.data.failedIssueIds.filter((id) => id !== issue.id);
        return {
          key: queryKey,
          data: {
            ...current.data,
            worklogs,
            matchedWorklogCount: worklogs.length,
            loadedWorklogCount:
              current.data.loadedWorklogCount -
              (current.data.issueWorklogCounts[issue.id] ?? 0) +
              logs.length,
            issueWorklogCounts: {
              ...current.data.issueWorklogCounts,
              [issue.id]: logs.length,
            },
            failedIssueIds: failures,
            state: failures.length ? "partial" : "ready",
            loadedIssueCount: current.data.issues.length - failures.length,
            reasons: current.data.reasons.filter(
              (reason) => !reason.startsWith(`${issue.key}:`),
            ),
            loadedAt: new Date().toISOString(),
          },
        };
      });
    } catch (reason) {
      if (reason instanceof WorklogIdentityError) {
        setIdentityError(true);
        setSnapshot(undefined);
        setSaved(undefined);
        return;
      }
      setSaved({
        message:
          "Saved in Jira, but the timesheet could not be refreshed. Do not repeat the write; use Refresh.",
        issue,
        ...(log ? { log } : {}),
      });
      setLoad({
        key: queryKey,
        loading: false,
        progress: "",
        error: "The table is stale after the confirmed Jira operation.",
      });
    }
  };
  const detailLogs =
    detail && data
      ? data.worklogs
          .filter(
            (log) =>
              log.issueId === detail.issue.id &&
              dayInZone(log.started, zone) === detail.day,
          )
          .sort((a, b) => a.started.localeCompare(b.started))
      : [];
  return (
    <section className="timesheet" aria-label="Personal timesheet">
      <header className="timesheet-heading">
        <div>
          <h1>Timesheet</h1>
          <span>
            {userName} · {new URL(baseUrl).host}
          </span>
        </div>
      </header>
      <fieldset
        className="timesheet-toolbar"
        disabled={inlineActive}
        aria-label="Timesheet period"
      >
        <label>
          Period{" "}
          <select
            value={mode}
            onChange={(event) => patchPrefs({ mode: event.target.value as PeriodMode })}
          >
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          aria-label="Previous period"
          onClick={() => changeAnchor(adjacentPeriod(anchor, mode, -1))}
        >
          ←
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => changeAnchor(dayInZone(new Date(), zone))}
        >
          Today
        </button>
        <button
          type="button"
          className="secondary-button"
          aria-label="Next period"
          onClick={() => changeAnchor(adjacentPeriod(anchor, mode, 1))}
        >
          →
        </button>
        <label>
          Go to date{" "}
          <input
            type="date"
            value={anchor}
            onChange={(event) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value))
                changeAnchor(event.target.value);
            }}
          />
        </label>
        <strong>
          {days[0]} – {days.at(-1)}
        </strong>
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </button>
      </fieldset>
      {zoneWarning ? (
        <div
          className="timesheet-alert"
          role="status"
          aria-label="Jira time zone warning"
        >
          <strong>Check your Jira time zone.</strong> {zoneWarning} Timesheet view: {zone}
          .
        </div>
      ) : null}
      {mode === "week" ? (
        <>
          <div className="weekly-setup-row">
            <WeeklyTaskControls tasks={weekly} disabled={inlineActive || identityError} />
            <button
              type="button"
              className="text-button"
              disabled={inlineActive || identityError || copying}
              onClick={() => void copyPreviousTasks()}
            >
              {copying ? "Reading previous week…" : "Copy last week's tasks"}
            </button>
            <details className="weekly-entry-help">
              <summary>Time entry help</summary>
              <p>
                Enter hours: 2, 1.5 or 1:30. Tab moves to the next day. Changes save when
                you leave a cell. New entries use 09:00 in {zone}. Multiple worklogs open
                in details.
              </p>
            </details>
            <div className="timesheet-day-off-status">
              <span>
                {dayOff.complete ? "Day Off synced with GitHub" : "Shared Day Off"}
              </span>
              {dayOff.available ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={dayOff.busy || dayOff.loading}
                  onClick={() =>
                    void (dayOff.complete ? dayOff.refresh() : dayOff.connect())
                  }
                >
                  {dayOff.complete ? "Refresh Day Off" : "Allow GitHub storage access"}
                </button>
              ) : (
                <span>Сховище Day Off не налаштоване.</span>
              )}
              {dayOff.loading ? <span role="status">Loading Day Off…</span> : null}
              {dayOff.error || dayOffActionError ? (
                <span role="alert">{dayOff.error || dayOffActionError}</span>
              ) : null}
              {dayOff.uncertain ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={dayOff.acknowledgeUncertain}
                >
                  I refreshed and checked the date; enable changes
                </button>
              ) : null}
              {dayOff.warnings.map((warning) => (
                <span role="status" key={warning}>
                  {warning}
                </span>
              ))}
            </div>
          </div>
          {copyMessage ? <p role="status">{copyMessage}</p> : null}
          {priority.error ? <p role="status">{priority.error}</p> : null}
        </>
      ) : null}

      {mode === "month" ? (
        <div className="timesheet-day-off-status">
          <span>{dayOff.complete ? "Day Off synced with GitHub" : "Shared Day Off"}</span>
          {dayOff.available ? (
            <button
              type="button"
              className="text-button"
              disabled={dayOff.busy || dayOff.loading}
              onClick={() => void (dayOff.complete ? dayOff.refresh() : dayOff.connect())}
            >
              {dayOff.complete ? "Refresh Day Off" : "Allow GitHub storage access"}
            </button>
          ) : (
            <span>Сховище Day Off не налаштоване.</span>
          )}
          {dayOff.loading ? <span role="status">Loading Day Off…</span> : null}
          {dayOff.error || dayOffActionError ? (
            <span role="alert">{dayOff.error || dayOffActionError}</span>
          ) : null}
          {dayOff.uncertain ? (
            <button
              type="button"
              className="text-button"
              onClick={dayOff.acknowledgeUncertain}
            >
              I refreshed and checked the date; enable changes
            </button>
          ) : null}
          {dayOff.warnings.map((warning) => (
            <span role="status" key={warning}>
              {warning}
            </span>
          ))}
        </div>
      ) : null}
      <fieldset
        className="timesheet-meta"
        disabled={inlineActive}
        aria-label="Timesheet filters"
      >
        <details className="timesheet-filters">
          <summary>
            Filters & time zone
            {projectIds.length ? ` · ${projectIds.length} projects` : " · all projects"}
            {explicitJql ? " · Setup filter applied" : ""}
          </summary>
          <div className="timesheet-filter-body">
            <label>
              Time zone
              <select
                value={prefs.zoneSource === "jira" ? "jira" : zone}
                onChange={(event) =>
                  patchPrefs(
                    event.target.value === "jira"
                      ? { zone: defaultZone, zoneSource: "jira" }
                      : { zone: event.target.value, zoneSource: "custom" },
                  )
                }
              >
                <option value="jira">
                  {profileZone
                    ? `Jira profile · ${profileZone}`
                    : `Jira time zone unavailable · ${defaultZone}`}
                </option>
                {Array.from(
                  new Set([
                    "Europe/Kyiv",
                    "UTC",
                    ...((
                      Intl as typeof Intl & {
                        supportedValuesOf?: (key: string) => string[];
                      }
                    ).supportedValuesOf?.("timeZone") ?? []),
                  ]),
                ).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Find project
              <input
                type="search"
                value={projectSearch}
                onChange={(event) => setProjectSearch(event.target.value)}
                placeholder="Project name or key"
              />
            </label>
            {projectError ? <p role="alert">{projectError}</p> : null}
            <div className="timesheet-projects">
              {projects.map((project) => (
                <label key={project.id}>
                  <input
                    type="checkbox"
                    checked={projectIds.includes(project.id)}
                    onChange={(event) =>
                      patchPrefs({
                        projectIds: event.target.checked
                          ? [...projectIds, project.id]
                          : projectIds.filter((id) => id !== project.id),
                      })
                    }
                  />
                  {project.key} · {project.name}
                </label>
              ))}
            </div>
            <div>
              Selected projects:{" "}
              {projectIds.length
                ? `${projectIds.length} selected`
                : "All accessible projects"}{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => patchPrefs({ projectIds: [], explicitJql: "" })}
              >
                Clear filters
              </button>
            </div>
            {setupJql ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => patchPrefs({ explicitJql: setupJql })}
              >
                Use current Setup context
              </button>
            ) : null}
            {explicitJql ? (
              <p>
                Filter copied from Setup: <code>{explicitJql}</code>{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => patchPrefs({ explicitJql: "" })}
                >
                  Remove Setup filter
                </button>
              </p>
            ) : null}
          </div>
        </details>
        <label>
          Find issue{" "}
          <input
            type="search"
            value={search}
            placeholder="Filter loaded rows"
            onChange={(event) => {
              if (!activities.current.size) setSearch(event.target.value);
            }}
          />
        </label>
        <details>
          <summary>Add/check issue by key</summary>
          <form
            className="timesheet-check"
            onSubmit={(event) => {
              event.preventDefault();
              void checkIssue();
            }}
          >
            <label>
              Jira issue key
              <input
                value={manualKey}
                onChange={(event) => setManualKey(event.target.value)}
                placeholder="LBR-123"
              />
            </label>
            <button
              type="submit"
              className="secondary-button"
              disabled={manualBusy || identityError}
            >
              {manualBusy ? "Checking…" : "Check issue"}
            </button>
          </form>
          {manualError ? <p role="alert">{manualError}</p> : null}
        </details>
      </fieldset>
      {inlineActive ? (
        <p role="status" className="timesheet-draft-status">
          Finish saving or resolve the edited cell before changing this view. Press Escape
          in a cell to cancel an unsaved edit.
        </p>
      ) : null}
      <div className="timesheet-coverage">
        <strong>
          Found time: {data ? duration(total(rows)) : "—"}
          {partial ? " · loaded records only" : ""}
        </strong>
        <span>{data ? count : "—"} issues with worklogs</span>
        <span>Jira search may omit part of your history.</span>
        <details className="timesheet-coverage-help">
          <summary>About totals</summary>
          <p>
            Only the latest 1,000 worklogs per issue are searchable; check a known issue
            by key if needed.
          </p>
        </details>
      </div>
      {loading ? (
        <div role="status" className="timesheet-loading">
          <span className="reporting-spinner" aria-hidden="true" />
          {load.key === queryKey ? load.progress : "Reading Jira user…"}
          {data ? " · Showing the previous result while refreshing." : ""}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              controllerRef.current?.abort();
              setLoad({
                key: queryKey,
                loading: false,
                progress: "",
                error:
                  "Loading cancelled. Refresh to retry; no completed selection is claimed.",
              });
            }}
          >
            Cancel loading
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="timesheet-alert">
          {error} {data ? "Displayed data is stale." : "No totals are available."}
        </p>
      ) : null}
      {partial ? (
        <p role="alert" className="timesheet-alert">
          Incomplete reading: {data.failedIssueIds.length} issue requests failed. Totals
          cover loaded records only; missing records are unknown.
        </p>
      ) : null}
      {saved && !identityError ? (
        <div role="status" className="timesheet-save-status">
          {saved.message} The record may be outside the current filters or period.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              patchPrefs({ projectIds: [], explicitJql: "" });
              if (saved.log) setAnchor(dayInZone(saved.log.started, zone));
              addKnown(saved.issue);
              setRefresh((value) => value + 1);
            }}
          >
            Show record
          </button>
        </div>
      ) : null}
      {(detail && data) || form ? (
        <WorklogDialog
          label={
            form
              ? form.deleting
                ? "Delete worklog"
                : form.original
                  ? "Edit worklog"
                  : "Log time"
              : "Worklog details"
          }
          onClose={closeDetails}
          restoreFocus={restoreDetailFocus}
        >
          {detail && data ? (
            <section className="timesheet-details" aria-label="Worklog details">
              <header>
                <h2>
                  {detail.issue.key} · {detail.day} · {zone}
                </h2>
                <button
                  type="button"
                  ref={detailClose}
                  className="secondary-button"
                  onClick={closeDetails}
                >
                  Close details
                </button>
              </header>
              <p>
                {detailLogs.length} worklogs · {duration(sumWorklogs(detailLogs))}. All
                time belongs to the start day.
              </p>
              <ul>
                {detailLogs.map((log) => (
                  <li key={log.id}>
                    <div>
                      <time dateTime={log.started}>
                        {new Date(log.started).toLocaleString("en-GB", {
                          timeZone: zone,
                        })}
                      </time>
                      <strong>{duration(log.timeSpentSeconds)}</strong>
                      <span>Worklog {log.id}</span>
                      {log.commentText ? (
                        <p className="worklog-comment">{log.commentText}</p>
                      ) : null}
                    </div>
                    <div>
                      <button
                        type="button"
                        disabled={loading || Boolean(error)}
                        className="secondary-button"
                        onClick={() =>
                          openForm({
                            issue: detail.issue,
                            day: detail.day,
                            original: log,
                          })
                        }
                      >
                        Edit worklog {log.id}
                      </button>
                      <button
                        type="button"
                        disabled={loading || Boolean(error)}
                        className="text-button"
                        onClick={() =>
                          openForm({
                            issue: detail.issue,
                            day: detail.day,
                            original: log,
                            deleting: true,
                          })
                        }
                      >
                        Delete worklog {log.id}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="primary-button"
                onClick={() => openForm({ issue: detail.issue, day: detail.day })}
              >
                Add another worklog
              </button>
            </section>
          ) : null}
          {form ? (
            <WorklogForm
              key={`${form.issue.id}:${form.day}:${form.original?.id ?? "new"}:${Boolean(form.deleting)}`}
              api={api}
              baseUrl={baseUrl}
              accountId={accountId}
              timeZone={zone}
              initialDay={form.day}
              issue={form.issue}
              {...(form.original ? { original: form.original } : {})}
              {...(form.deleting ? { deleting: true } : {})}
              beforeSave={checkDayOff}
              onIdentityError={() => {
                setIdentityError(true);
                setSnapshot(undefined);
                setForm(undefined);
                setLoad({
                  key: queryKey,
                  loading: false,
                  progress: "",
                  error: "The Jira account changed. Reconnect in Settings.",
                });
              }}
              onClose={() => setForm(undefined)}
              onSaved={handleSaved}
              onGuardChange={registerGuard}
            />
          ) : null}
        </WorklogDialog>
      ) : null}
      {data ? (
        <>
          {search ? (
            <p className="timesheet-visible-total">
              Visible rows: {duration(total(visible))}. Full loaded selection:{" "}
              {duration(total(rows))}.
            </p>
          ) : null}
          {visible.length ? (
            <div
              className="timesheet-table-scroll"
              tabIndex={0}
              aria-label="Timesheet table, scroll to see all days"
            >
              <table className="timesheet-table">
                <caption>
                  {partial ? "Loaded records only · " : ""}Personal worklogs · {zone}
                  {prefs.zoneSource === "jira" && profileZone ? " · Jira profile" : ""}
                  {loading || error ? " · previous result" : ""}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Issue</th>
                    {days.map((day) => (
                      <th
                        key={day}
                        scope="col"
                        className={
                          daysOff.has(day)
                            ? "timesheet-day-off"
                            : day === dayInZone(new Date(), zone)
                              ? "timesheet-today"
                              : new Date(`${day}T12:00Z`).getUTCDay() % 6 === 0
                                ? "timesheet-weekend"
                                : ""
                        }
                      >
                        <span>{dateLabel(day)}</span>
                        <DayOffToggle
                          day={day}
                          disabledReason={
                            !dayOff.available
                              ? "Сховище Day Off не налаштоване."
                              : dayOff.busy
                                ? "Saving Day Off…"
                                : dayOff.loading
                                  ? "Loading Day Off…"
                                  : !dayOff.complete
                                    ? dayOff.warnings.join(" ") ||
                                      "Shared Day Off is unavailable. Refresh before making changes."
                                    : identityError
                                      ? "The Jira account changed. Refresh first."
                                      : inlineActive
                                        ? "Finish editing time first."
                                        : "Own worklogs exist or time data is incomplete. Refresh before marking Day Off."
                          }
                          checked={daysOff.has(day)}
                          onConnect={
                            dayOff.available && !dayOff.complete && !dayOff.enforced
                              ? () => void dayOff.connect()
                              : undefined
                          }
                          connecting={dayOff.busy || dayOff.loading}
                          disabled={
                            !dayOff.complete ||
                            dayOff.loading ||
                            dayOff.busy ||
                            dayOff.uncertain ||
                            inlineActive ||
                            identityError ||
                            (!daysOff.has(day) &&
                              (loading ||
                                !data ||
                                Boolean(error) ||
                                data.worklogs.some(
                                  (log) => dayInZone(log.started, zone) === day,
                                )))
                          }
                          onChange={(checked) => {
                            setDayOffActionError("");
                            void (async () => {
                              if ((await api.getUser()).accountId !== accountId) {
                                setIdentityError(true);
                                setSnapshot(undefined);
                                return;
                              }
                              await dayOff.setDayOff(accountId, day, checked);
                            })().catch((reason: unknown) =>
                              setDayOffActionError(
                                reason instanceof Error
                                  ? reason.message
                                  : "Your Jira account could not be checked. Try again.",
                              ),
                            );
                          }}
                        />
                      </th>
                    ))}
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(
                    (
                      {
                        issue,
                        cells,
                        group,
                        depth,
                        hasChildren,
                        withoutParent,
                        parentHeading,
                      },
                      index,
                    ) => (
                      <Fragment key={issue.id}>
                        {mode === "week" &&
                        (index === 0 || visible[index - 1]!.group !== group) ? (
                          <tr className="weekly-group">
                            <th colSpan={days.length + 2} scope="rowgroup">
                              {
                                [
                                  "Pinned issues",
                                  "My worklogs this week",
                                  "Priority issues",
                                  "Assigned to me",
                                  "Other issues",
                                ][group]
                              }
                            </th>
                          </tr>
                        ) : null}
                        {mode === "week" &&
                        withoutParent &&
                        index === withoutParentIndex ? (
                          <tr className="weekly-group">
                            <th colSpan={days.length + 2}>Without parent issue</th>
                          </tr>
                        ) : null}
                        {mode === "week" && parentHeading ? (
                          <tr className="weekly-group">
                            <th colSpan={days.length + 2}>
                              Children of {parentHeading.key} · {parentHeading.summary}
                            </th>
                          </tr>
                        ) : null}
                        <tr>
                          <th
                            scope="row"
                            style={
                              mode === "week"
                                ? { paddingLeft: 12 + depth * 20 }
                                : undefined
                            }
                          >
                            {mode === "week" && weekly.boardId > 0 ? (
                              <button
                                type="button"
                                className="weekly-pin"
                                disabled={inlineActive}
                                aria-pressed={weekly.pins.includes(issue.key)}
                                aria-label={`${weekly.pins.includes(issue.key) ? "Unpin" : "Pin"} ${issue.key}`}
                                onClick={() => weekly.togglePin(issue.key)}
                              >
                                <svg
                                  width="15"
                                  height="15"
                                  viewBox="0 0 24 24"
                                  fill={
                                    weekly.pins.includes(issue.key)
                                      ? "currentColor"
                                      : "none"
                                  }
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M16 3l5 5-4 1-3 5 1 3-2 2-4-4-6 6 6-6-4-4 2-2 3 1 5-3z" />
                                </svg>
                              </button>
                            ) : null}
                            <a
                              href={`${baseUrl}/browse/${issue.key}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {issue.key}
                            </a>
                            <span>{issue.summary}</span>
                            {mode === "week" &&
                            !Object.hasOwn(data.issueWorklogCounts, issue.id) ? (
                              <button
                                type="button"
                                disabled={loading || inlineActive}
                                className="weekly-load-hours"
                                aria-label={`Add to table ${issue.key}`}
                                onClick={() => {
                                  weekly.add(issue.key);
                                  setKnownIssues((current) =>
                                    current.some((item) => item.id === issue.id)
                                      ? current
                                      : [...current, issue],
                                  );
                                }}
                              >
                                Load hours
                              </button>
                            ) : null}
                            {mode === "week" && hasChildren ? (
                              <button
                                type="button"
                                className="text-button"
                                disabled={inlineActive}
                                aria-label={`${weekly.expanded.includes(issue.key) ? "Collapse" : "Expand"} ${issue.key}`}
                                aria-expanded={weekly.expanded.includes(issue.key)}
                                onClick={() => weekly.toggleExpanded(issue.key)}
                              >
                                {weekly.expanded.includes(issue.key)
                                  ? "Collapse"
                                  : "Expand"}{" "}
                                {issue.key}
                              </button>
                            ) : null}
                          </th>
                          {days.map((day) => {
                            const logs = cells.get(day);
                            const unread = !Object.hasOwn(
                              data.issueWorklogCounts,
                              issue.id,
                            );
                            const unknown =
                              data.failedIssueIds.includes(issue.id) || unread;
                            return (
                              <td
                                key={day}
                                data-worklog-cell={`${issue.id}:${day}`}
                                className={
                                  daysOff.has(day)
                                    ? "timesheet-day-off"
                                    : new Date(`${day}T12:00Z`).getUTCDay() % 6 === 0
                                      ? "timesheet-weekend"
                                      : ""
                                }
                              >
                                {mode === "week" &&
                                !unknown &&
                                (logs?.length ?? 0) <= 1 ? (
                                  <WeeklyTimeCell
                                    key={`${day}:${JSON.stringify(logs ?? [])}:${zone}`}
                                    api={api}
                                    issue={issue}
                                    day={day}
                                    zone={zone}
                                    accountId={accountId}
                                    logs={logs ?? []}
                                    disabled={
                                      loading ||
                                      Boolean(error) ||
                                      identityError ||
                                      (dayOff.enforced && dayOff.loading) ||
                                      daysOff.has(day)
                                    }
                                    beforeSave={() => checkDayOff(day)}
                                    onSaved={handleSaved}
                                    onDetails={(trigger) =>
                                      openDetails(issue, day, trigger)
                                    }
                                    onActivity={onCellActivity}
                                    onReload={() => {
                                      weekly.add(issue.key);
                                      setKnownIssues((current) =>
                                        current.some((item) => item.id === issue.id)
                                          ? current
                                          : [...current, issue],
                                      );
                                      setRefresh((value) => value + 1);
                                    }}
                                    onIdentityError={() => {
                                      setIdentityError(true);
                                      setSnapshot(undefined);
                                    }}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    disabled={
                                      loading || Boolean(error) || (unknown && !unread)
                                    }
                                    aria-label={
                                      logs
                                        ? `${issue.key}, ${day}, ${duration(sumWorklogs(logs))}, ${logs.length} worklogs`
                                        : `${issue.key}, ${day}, ${unread ? "enter hours" : unknown ? "records unknown" : "add worklog"}`
                                    }
                                    onClick={(event) => {
                                      detailTrigger.current = event.currentTarget;
                                      if (unread) {
                                        setPendingCell({ key: issue.key, day });
                                        weekly.add(issue.key);
                                        setKnownIssues((current) =>
                                          current.some((item) => item.id === issue.id)
                                            ? current
                                            : [...current, issue],
                                        );
                                      } else if (logs)
                                        openDetails(issue, day, event.currentTarget);
                                      else {
                                        setAnchor(day);
                                        patchPrefs({ mode: "week" });
                                        addKnown(issue);
                                        setPendingCell({ key: issue.key, day });
                                      }
                                    }}
                                  >
                                    {logs
                                      ? duration(sumWorklogs(logs))
                                      : unknown
                                        ? "?"
                                        : "+"}
                                  </button>
                                )}
                              </td>
                            );
                          })}
                          <td>
                            <strong>
                              {data.failedIssueIds.includes(issue.id) ||
                              !Object.hasOwn(data.issueWorklogCounts, issue.id)
                                ? "?"
                                : duration(
                                    [...cells.values()].reduce(
                                      (sum, logs) => sum + sumWorklogs(logs),
                                      0,
                                    ),
                                  )}
                            </strong>
                          </td>
                        </tr>
                      </Fragment>
                    ),
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">
                      {search ? "Visible totals" : "Total"}
                      {partial ? " (loaded only)" : ""}
                    </th>
                    {days.map((day) => (
                      <td key={day}>
                        {duration(
                          visible.reduce(
                            (sum, row) => sum + sumWorklogs(row.cells.get(day) ?? []),
                            0,
                          ),
                        )}
                      </td>
                    ))}
                    <td>{duration(total(visible))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : !loading ? (
            <div className="timesheet-empty">
              <h2>
                {search
                  ? "No matching issues"
                  : partial
                    ? "No matching records loaded"
                    : mode === "week" && !weekly.boardId
                      ? "Choose a board to see your tasks"
                      : "No worklogs found for this period and filters"}
              </h2>
              <p>
                {search
                  ? "Try another key or summary."
                  : "Jira search can omit older records. Change the period or filters, check a known issue by key, or select a board to enter hours in the weekly table."}
              </p>
              <button
                type="button"
                className="primary-button"
                disabled={identityError}
                onClick={() => patchPrefs({ mode: "week" })}
              >
                Show weekly tasks
              </button>
            </div>
          ) : null}
          <details className="timesheet-diagnostics">
            <summary>
              Selection details · last read{" "}
              {new Date(data.loadedAt).toLocaleString("en-GB", { timeZone: zone })}
              {loading || error ? " · stale" : ""}
            </summary>
            <dl>
              <dt>Instance / author</dt>
              <dd>
                {baseUrl} · {data.user.displayName}
              </dd>
              <dt>Period / time zone</dt>
              <dd>
                {days[0]} – {days.at(-1)} · {zone}
              </dd>
              <dt>Discovery</dt>
              <dd>{data.discoveryJql}</dd>
              <dt>Coverage</dt>
              <dd>
                JQL-limited · visible records only
                {data.dateDiscovery
                  ? " · widened date discovery"
                  : " · Jira profile time zone unavailable; discovery by author, period filtered locally"}
              </dd>
              <dt>Issues found / read</dt>
              <dd>
                {data.candidateIssueCount} / {data.loadedIssueCount}
              </dd>
              <dt>Worklogs received / matched</dt>
              <dd>
                {data.loadedWorklogCount} / {data.matchedWorklogCount}
              </dd>
            </dl>
            {data.reasons.length ? (
              <ul>
                {data.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </details>
        </>
      ) : null}
    </section>
  );
}
