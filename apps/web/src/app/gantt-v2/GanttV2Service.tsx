import { DEFAULT_GANTT_FILTERS, type GanttFilters } from "@power-view/domain";
import type {
  GanttBoardState,
  GanttViewPreferences,
  SettingsStore,
} from "@power-view/storage";
import { useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceContext } from "../workspace/WorkspaceContext";
import { GanttV2 } from "./GanttV2";

const EMPTY_BOARD_STATE: GanttBoardState = {
  dependencies: [],
  reconciledDates: {},
};

const DEFAULT_VIEW_PREFERENCES: GanttViewPreferences = {
  zoom: "week",
  sortBy: "default",
  sortDirection: "asc",
};

export interface GanttV2ServiceProps {
  workspace: WorkspaceContext;
  settingsStore?: SettingsStore;
}

/** New isolated Gantt feature boundary. The legacy Gantt remains untouched. */
export function GanttV2Service({ workspace, settingsStore }: GanttV2ServiceProps) {
  const workspaceKey = `${workspace.projectKey}:${workspace.scope.boardId}`;
  const [boardState, setBoardState] = useState<GanttBoardState>(EMPTY_BOARD_STATE);
  const [filters, setFilters] = useState<GanttFilters>({
    ...DEFAULT_GANTT_FILTERS,
  });
  const [viewPreferences, setViewPreferences] = useState<GanttViewPreferences>(
    DEFAULT_VIEW_PREFERENCES,
  );
  const scopeKey = `${workspace.jiraBaseUrl}:${workspaceKey}`;
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    store: SettingsStore;
    error: string;
  }>();
  const [saveError, setSaveError] = useState("");
  const [retryingSave, setRetryingSave] = useState(false);
  const generation = useRef(0);
  const ready =
    !settingsStore ||
    (loaded?.key === scopeKey && loaded.store === settingsStore && !loaded.error);

  useEffect(() => {
    let active = true;
    const current = ++generation.current;
    setLoaded(undefined);
    setSaveError("");
    setRetryingSave(false);
    setBoardState(EMPTY_BOARD_STATE);
    setFilters({ ...DEFAULT_GANTT_FILTERS });
    setViewPreferences(DEFAULT_VIEW_PREFERENCES);
    if (!settingsStore) return;
    void Promise.all([
      settingsStore.getGanttBoardState(workspace.jiraBaseUrl, workspaceKey),
      settingsStore.getGanttFilters(workspace.jiraBaseUrl, workspaceKey),
      settingsStore.getGanttViewPreferences(workspace.jiraBaseUrl, workspaceKey),
    ])
      .then(([storedBoardState, storedFilters, storedViewPreferences]) => {
        if (!active) return;
        setBoardState(storedBoardState ?? EMPTY_BOARD_STATE);
        setFilters(storedFilters ?? { ...DEFAULT_GANTT_FILTERS });
        setViewPreferences(storedViewPreferences ?? DEFAULT_VIEW_PREFERENCES);
        setLoaded({ key: scopeKey, store: settingsStore, error: "" });
      })
      .catch(() => {
        if (active)
          setLoaded({
            key: scopeKey,
            store: settingsStore,
            error:
              "Saved Gantt settings could not be loaded. Retry before editing to preserve existing dependencies.",
          });
      });
    return () => {
      active = false;
      generation.current = current + 1;
    };
  }, [scopeKey, settingsStore, workspace.jiraBaseUrl, workspaceKey, retry]);

  const persist = async (write: () => Promise<void> | undefined) => {
    const current = generation.current;
    try {
      await write();
      return true;
    } catch {
      if (current === generation.current)
        setSaveError(
          "Gantt changes are visible in this session, but could not be saved on this device. Keep this view open and retry the change before leaving.",
        );
      return false;
    }
  };

  const editing = useMemo(
    () => ({
      ...workspace.editing,
      fieldMapping: { ...workspace.editing.fieldMapping },
    }),
    [workspace.editing],
  );

  if (!ready)
    return (
      <section className="gantt-state-feedback" role={loaded?.error ? "alert" : "status"}>
        {loaded?.key === scopeKey && loaded.store === settingsStore && loaded.error ? (
          <>
            <p>{loaded.error}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry settings
            </button>
          </>
        ) : (
          "Loading saved Gantt settings…"
        )}
      </section>
    );

  return (
    <>
      {saveError ? (
        <div className="gantt-state-feedback" role="alert">
          <p>{saveError}</p>
          <button
            type="button"
            className="secondary-button"
            disabled={retryingSave}
            onClick={() => {
              const current = generation.current;
              setRetryingSave(true);
              void persist(async () => {
                await Promise.all([
                  settingsStore?.saveGanttFilters(
                    workspace.jiraBaseUrl,
                    workspaceKey,
                    filters,
                  ),
                  settingsStore?.saveGanttViewPreferences(
                    workspace.jiraBaseUrl,
                    workspaceKey,
                    viewPreferences,
                  ),
                  settingsStore?.saveGanttBoardState(
                    workspace.jiraBaseUrl,
                    workspaceKey,
                    boardState,
                  ),
                ]);
              }).then((success) => {
                if (current !== generation.current) return;
                if (success) setSaveError("");
                setRetryingSave(false);
              });
            }}
          >
            {retryingSave ? "Saving settings…" : "Retry saving settings"}
          </button>
        </div>
      ) : null}
      <GanttV2
        key={workspace.queryKey}
        model={workspace.model}
        nonWorkingDays={workspace.nonWorkingDays}
        editing={editing}
        boardState={boardState}
        initialSearch={filters.search}
        initialHideCompleted={filters.excludeDone}
        initialViewPreferences={viewPreferences}
        onSearchChange={(search) => {
          const next = { ...filters, search };
          setFilters(next);
          void persist(() =>
            settingsStore?.saveGanttFilters(workspace.jiraBaseUrl, workspaceKey, next),
          );
        }}
        onHideCompletedChange={(excludeDone) => {
          const next = { ...filters, excludeDone };
          setFilters(next);
          void persist(() =>
            settingsStore?.saveGanttFilters(workspace.jiraBaseUrl, workspaceKey, next),
          );
        }}
        onViewPreferencesChange={(next) => {
          setViewPreferences(next);
          void persist(() =>
            settingsStore?.saveGanttViewPreferences(
              workspace.jiraBaseUrl,
              workspaceKey,
              next,
            ),
          );
        }}
        onBoardStateChange={async (next) => {
          setBoardState(next);
          await persist(() =>
            settingsStore?.saveGanttBoardState(workspace.jiraBaseUrl, workspaceKey, next),
          );
        }}
      />
    </>
  );
}
