import { useEffect, useRef, useState } from "react";
import {
  UnknownDayOffOutcomeError,
  type DayOffReadResult,
  type DayOffStore,
} from "./DayOffStore";
import { grantGitHubDayOffAccess } from "./browser-github-day-off";
const changeEvent = "powerview:shared-day-off-changed";
const established = new WeakMap<DayOffStore, Set<string>>();
const unresolved = new WeakMap<DayOffStore, Set<string>>();
const empty: DayOffReadResult = { dayOffs: [], complete: false, warnings: [] };
export function useSharedDayOff(
  store: DayOffStore | undefined,
  baseUrl: string,
  accounts: string[],
  days: string[],
  verifyIdentity?: () => Promise<void>,
) {
  const queryKey = JSON.stringify([baseUrl, accounts, days]);
  const context = useRef(queryKey);
  context.current = queryKey;
  const writeController = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => writeController.current?.abort(), [store, queryKey]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    store: DayOffStore;
    key: string;
    value: DayOffReadResult;
  }>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [, markUncertain] = useState(0);
  const establish = (ids: string[]) => {
    if (!store) return;
    const known = established.get(store) ?? new Set<string>();
    for (const id of ids) known.add(JSON.stringify([baseUrl, id]));
    established.set(store, known);
  };
  const enforced = Boolean(
    store &&
    accounts.some((id) => established.get(store)?.has(JSON.stringify([baseUrl, id]))),
  );
  const writeKey = (id: string, date: string) => JSON.stringify([baseUrl, id, date]);
  const uncertain = Boolean(
    store &&
    accounts.some((id) =>
      days.some((date) => unresolved.get(store)?.has(writeKey(id, date))),
    ),
  );
  const acknowledgeUncertain = () => {
    if (store)
      for (const id of accounts)
        for (const date of days) unresolved.get(store)?.delete(writeKey(id, date));
    setError("");
    markUncertain((value) => value + 1);
    refresh();
  };
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1);
    window.addEventListener(changeEvent, changed);
    return () => window.removeEventListener(changeEvent, changed);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const [site, ids, dates] = JSON.parse(queryKey) as [string, string[], string[]];
    setError("");
    if (!store || !ids.length || !dates.length) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void store
      .read(site, ids, dates, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          if (value.complete && store) {
            const known = established.get(store) ?? new Set<string>();
            for (const id of ids) known.add(JSON.stringify([site, id]));
            established.set(store, known);
          }
          setResult((previous) => ({
            store,
            key: queryKey,
            value:
              !value.complete && previous?.store === store && previous.key === queryKey
                ? {
                    ...value,
                    dayOffs: [
                      ...new Map(
                        [...previous.value.dayOffs, ...value.dayOffs].map((item) => [
                          JSON.stringify([item.userId, item.date]),
                          item,
                        ]),
                      ).values(),
                    ],
                  }
                : value,
          }));
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          // Preserve known flags as stale evidence, never preserve a successful
          // completeness claim after a failed refresh.
          setResult((previous) => ({
            store,
            key: queryKey,
            value: {
              ...empty,
              dayOffs:
                previous?.store === store && previous.key === queryKey
                  ? previous.value.dayOffs
                  : [],
            },
          }));
          setError(
            reason instanceof Error
              ? reason.message
              : "Shared Day Off could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [store, queryKey, revision]);
  const connect = async () => {
    if (!store || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await grantGitHubDayOffAccess();
      await store.connect();
      establish(accounts);
      window.dispatchEvent(new Event(changeEvent));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "GitHub storage access is unavailable.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const setDayOff = async (accountId: string, date: string, checked: boolean) => {
    if (
      !store ||
      busyRef.current ||
      unresolved.get(store)?.has(writeKey(accountId, date))
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const key = queryKey;
      const controller = new AbortController();
      writeController.current = controller;
      await store.set(baseUrl, accountId, date, checked, controller.signal, async () => {
        if (context.current !== key)
          throw new Error("The Jira context changed. Refresh Day Off.");
        await verifyIdentity?.();
        controller.signal.throwIfAborted();
        if (context.current !== key)
          throw new Error("The Jira context changed. Refresh Day Off.");
      });
      if (context.current !== key) return;
      window.dispatchEvent(new Event(changeEvent));
    } catch (reason) {
      if (context.current !== queryKey) return;
      if (reason instanceof UnknownDayOffOutcomeError) {
        const locked = unresolved.get(store) ?? new Set<string>();
        locked.add(writeKey(accountId, date));
        unresolved.set(store, locked);
        markUncertain((value) => value + 1);
      }
      setError(reason instanceof Error ? reason.message : "Day Off could not be saved.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return {
    ...(result && result.store === store && result.key === queryKey
      ? result.value
      : empty),
    loading,
    busy,
    error:
      error ||
      (uncertain
        ? "The Day Off update result is unknown. Refresh shared storage and check the date before enabling changes again."
        : ""),
    uncertain,
    acknowledgeUncertain,
    available: Boolean(store),
    enforced,
    connect,
    setDayOff,
    refresh,
  };
}
