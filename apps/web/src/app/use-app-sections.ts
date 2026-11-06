import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_APP_SECTIONS,
  type AppSection,
  type AppSectionVisibility,
  type SettingsStore,
} from "@power-view/storage";

export function useAppSections(store: SettingsStore | undefined) {
  const [visibility, setVisibility] = useState<AppSectionVisibility>({
    ...DEFAULT_APP_SECTIONS,
  });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const generation = useRef(0);
  const writing = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    writing.current = false;
    setBusy(false);
    setReady(false);
    setLoadFailed(false);
    setVisibility({ ...DEFAULT_APP_SECTIONS });
    setError("");
    if (!store) {
      setReady(true);
      return;
    }
    void store
      .getSectionVisibility()
      .then((value) => {
        if (generation.current === current) setVisibility(value);
      })
      .catch(() => {
        if (generation.current !== current) return;
        setLoadFailed(true);
        setError("Section settings could not be loaded. Reopen Power View to try again.");
      })
      .finally(() => {
        if (generation.current === current) setReady(true);
      });
    return () => {
      generation.current = current + 1;
    };
  }, [store]);

  const change = async (section: AppSection, enabled: boolean) => {
    if (!store || !ready || writing.current || loadFailed) return;
    const current = generation.current;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await store.saveSectionVisibility(section, enabled);
      if (generation.current === current) setVisibility(value);
    } catch {
      if (generation.current === current)
        setError(
          "The section setting could not be saved. Your previous choice is unchanged; try again.",
        );
    } finally {
      if (generation.current === current) {
        writing.current = false;
        setBusy(false);
      }
    }
  };
  return {
    visibility,
    ready,
    busy,
    error,
    disabled: !store || !ready || busy || loadFailed,
    change,
  };
}
