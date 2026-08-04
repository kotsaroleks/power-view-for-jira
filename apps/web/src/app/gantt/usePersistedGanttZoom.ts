import type { SettingsStore } from "@power-view/storage";
import { useEffect, useState } from "react";

import type { GanttZoom } from "./GanttRenderer";

export interface GanttZoomPersistence {
  store: SettingsStore;
  jiraBaseUrl: string;
  workspaceKey: string;
}

export function usePersistedGanttZoom(persistence?: GanttZoomPersistence): {
  zoom: GanttZoom;
  setZoom: (zoom: GanttZoom) => void;
} {
  const [zoom, setZoom] = useState<GanttZoom>("week");
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
    void store.getGanttViewPreferences(jiraBaseUrl, workspaceKey).then(
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
  }, [jiraBaseUrl, workspaceKey, store]);

  useEffect(() => {
    if (!store || !jiraBaseUrl || !workspaceKey || !hydrated) {
      return;
    }

    const timer = setTimeout(() => {
      void store
        .saveGanttViewPreferences(jiraBaseUrl, workspaceKey, { zoom })
        .catch(() => console.warn("Power View could not save Gantt zoom."));
    }, 300);
    return () => clearTimeout(timer);
  }, [hydrated, jiraBaseUrl, store, workspaceKey, zoom]);

  return { zoom, setZoom };
}
