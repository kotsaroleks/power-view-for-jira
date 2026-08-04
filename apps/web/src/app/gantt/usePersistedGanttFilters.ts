import { DEFAULT_GANTT_FILTERS, type GanttFilters } from "@power-view/domain";
import type { SettingsStore } from "@power-view/storage";
import { useEffect, useState } from "react";

export interface GanttFilterPersistence {
  store: SettingsStore;
  jiraBaseUrl: string;
  workspaceKey: string;
}

export function usePersistedGanttFilters(persistence?: GanttFilterPersistence): {
  filters: GanttFilters;
  setFilters: (filters: GanttFilters) => void;
  hydrated: boolean;
} {
  const [filters, setFilters] = useState<GanttFilters>(() => ({
    ...DEFAULT_GANTT_FILTERS,
  }));
  const [hydrated, setHydrated] = useState(!persistence);
  const store = persistence?.store;
  const jiraBaseUrl = persistence?.jiraBaseUrl;
  const workspaceKey = persistence?.workspaceKey;

  useEffect(() => {
    if (!store || !jiraBaseUrl || !workspaceKey) {
      setHydrated(true);
      return;
    }

    let isCurrent = true;
    setHydrated(false);
    void store.getGanttFilters(jiraBaseUrl, workspaceKey).then(
      (storedFilters) => {
        if (isCurrent) {
          setFilters(storedFilters ?? { ...DEFAULT_GANTT_FILTERS });
          setHydrated(true);
        }
      },
      () => {
        if (isCurrent) {
          console.warn("Power View could not load saved Gantt filters.");
          setHydrated(true);
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [jiraBaseUrl, workspaceKey, store]);

  useEffect(() => {
    if (!store || !jiraBaseUrl || !workspaceKey || !hydrated) {
      return;
    }
    const timer = setTimeout(() => {
      void store
        .saveGanttFilters(jiraBaseUrl, workspaceKey, filters)
        .catch(() => console.warn("Power View could not save Gantt filters."));
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, hydrated, jiraBaseUrl, workspaceKey, store]);

  return { filters, setFilters, hydrated };
}
