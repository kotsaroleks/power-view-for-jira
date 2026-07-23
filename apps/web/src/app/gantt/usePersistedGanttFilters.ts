import { DEFAULT_GANTT_FILTERS, type GanttFilters } from "@power-view/domain";
import type { SettingsStore } from "@power-view/storage";
import { useEffect, useState } from "react";

export interface GanttFilterPersistence {
  store: SettingsStore;
  jiraBaseUrl: string;
  projectKey: string;
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
  const projectKey = persistence?.projectKey;

  useEffect(() => {
    if (!store || !jiraBaseUrl || !projectKey) {
      setHydrated(true);
      return;
    }

    let isCurrent = true;
    setHydrated(false);
    void store.getGanttFilters(jiraBaseUrl, projectKey).then(
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
  }, [jiraBaseUrl, projectKey, store]);

  useEffect(() => {
    if (!store || !jiraBaseUrl || !projectKey || !hydrated) {
      return;
    }
    const timer = setTimeout(() => {
      void store
        .saveGanttFilters(jiraBaseUrl, projectKey, filters)
        .catch(() => console.warn("Power View could not save Gantt filters."));
    }, 300);
    return () => clearTimeout(timer);
  }, [filters, hydrated, jiraBaseUrl, projectKey, store]);

  return { filters, setFilters, hydrated };
}
