import { DEFAULT_GANTT_FILTERS, type GanttFilters } from "@power-view/domain";
import type {
  GanttBoardState,
  GanttViewPreferences,
  SettingsStore,
} from "@power-view/storage";
import { useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    let active = true;
    setBoardState(EMPTY_BOARD_STATE);
    setFilters({ ...DEFAULT_GANTT_FILTERS });
    setViewPreferences(DEFAULT_VIEW_PREFERENCES);
    if (!settingsStore) return;
    void Promise.all([
      settingsStore.getGanttBoardState(workspace.jiraBaseUrl, workspaceKey),
      settingsStore.getGanttFilters(workspace.jiraBaseUrl, workspaceKey),
      settingsStore.getGanttViewPreferences(workspace.jiraBaseUrl, workspaceKey),
    ]).then(([storedBoardState, storedFilters, storedViewPreferences]) => {
      if (!active) return;
      setBoardState(storedBoardState ?? EMPTY_BOARD_STATE);
      setFilters(storedFilters ?? { ...DEFAULT_GANTT_FILTERS });
      setViewPreferences(storedViewPreferences ?? DEFAULT_VIEW_PREFERENCES);
    });
    return () => {
      active = false;
    };
  }, [scopeKey, settingsStore, workspace.jiraBaseUrl, workspaceKey]);

  const editing = useMemo(
    () => ({
      ...workspace.editing,
      fieldMapping: { ...workspace.editing.fieldMapping },
    }),
    [workspace.editing],
  );

  return (
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
        void settingsStore?.saveGanttFilters(workspace.jiraBaseUrl, workspaceKey, next);
      }}
      onHideCompletedChange={(excludeDone) => {
        const next = { ...filters, excludeDone };
        setFilters(next);
        void settingsStore?.saveGanttFilters(workspace.jiraBaseUrl, workspaceKey, next);
      }}
      onViewPreferencesChange={(next) => {
        setViewPreferences(next);
        void settingsStore?.saveGanttViewPreferences(
          workspace.jiraBaseUrl,
          workspaceKey,
          next,
        );
      }}
      onBoardStateChange={async (next) => {
        setBoardState(next);
        await settingsStore?.saveGanttBoardState(
          workspace.jiraBaseUrl,
          workspaceKey,
          next,
        );
      }}
    />
  );
}
