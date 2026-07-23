import type { SettingsStore } from "@power-view/storage";
import { useEffect, useState } from "react";

import type { GanttZoom } from "./GanttRenderer";

export interface GanttZoomPersistence {
  store: SettingsStore;
  jiraBaseUrl: string;
  projectKey: string;
}

export function usePersistedGanttZoom(persistence?: GanttZoomPersistence): {
  zoom: GanttZoom;
  setZoom: (zoom: GanttZoom) => void;
} {
  const [zoom, setZoom] = useState<GanttZoom>("week");
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
    void store.getGanttViewPreferences(jiraBaseUrl, projectKey).then(
      (preferences) => {
        if (isCurrent) {
          if (preferences) {
            setZoom(preferences.zoom);
          }
          setHydrated(true);
        }
      },
      () => {
        if (isCurrent) {
          console.warn("Power View could not load saved Gantt zoom.");
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
        .saveGanttViewPreferences(jiraBaseUrl, projectKey, { zoom })
        .catch(() => console.warn("Power View could not save Gantt zoom."));
    }, 300);
    return () => clearTimeout(timer);
  }, [hydrated, jiraBaseUrl, projectKey, store, zoom]);

  return { zoom, setZoom };
}
