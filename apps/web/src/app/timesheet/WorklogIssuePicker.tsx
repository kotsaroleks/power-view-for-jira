import { isFavoriteParent, pickerGroups } from "./issue-picker-model";
import { useEffect, useState } from "react";
import type {
  TimesheetApi,
  TimesheetIssue,
  WorklogBoard,
  WorklogPickerIssue,
} from "@power-view/jira-client";

type Preferences = { boardId: number; favorites: Record<string, string[]> };
function readPreferences(key: string): Preferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "boardId" in value &&
      "favorites" in value &&
      typeof value.boardId === "number" &&
      Number.isSafeInteger(value.boardId) &&
      value.boardId >= 0 &&
      value.favorites &&
      typeof value.favorites === "object" &&
      !Array.isArray(value.favorites)
    ) {
      const favorites: Record<string, string[]> = {};
      for (const [board, keys] of Object.entries(value.favorites)) {
        if (
          Array.isArray(keys) &&
          keys.every(
            (item: unknown) =>
              typeof item === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(item),
          )
        )
          favorites[board] = keys.filter(
            (item: unknown): item is string => typeof item === "string",
          );
      }
      return { boardId: value.boardId, favorites };
    }
  } catch {
    /* Unavailable or malformed storage must not prevent logging. */
  }
  return { boardId: 0, favorites: {} };
}
export function WorklogIssuePicker({
  api,
  baseUrl,
  accountId,
  onSelect,
}: {
  api: TimesheetApi;
  baseUrl: string;
  accountId: string;
  onSelect: (issue: TimesheetIssue) => void;
}) {
  const storageKey = `power-view:worklog-picker:v1:${baseUrl.replace(/\/$/, "")}:${accountId}`;
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const [boards, setBoards] = useState<WorklogBoard[]>([]);
  const [issues, setIssues] = useState<WorklogPickerIssue[]>([]);
  const [parentKey, setParentKey] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [retry, setRetry] = useState(0);
  const boardId = preferences.boardId;
  const favorites = preferences.favorites[String(boardId)] ?? [];
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setIssues([]);
    setParentKey("");
    setSearch("");
    void (async () => {
      const available = await api.getWorklogBoards(controller.signal);
      if (controller.signal.aborted) return;
      setBoards(available);
      if (boardId) {
        if (!available.some((board) => board.id === boardId))
          throw new Error("The remembered board is unavailable. Select another board.");
        const loaded = await api.getBoardPickerIssues(boardId, controller.signal);
        if (!controller.signal.aborted) setIssues(loaded);
      }
    })()
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Jira could not load the board. Try again.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [api, boardId, retry]);
  const persist = (next: Preferences) => {
    setPreferences(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  const toggleFavorite = (key: string) =>
    persist({
      ...preferences,
      favorites: {
        ...preferences.favorites,
        [String(boardId)]: favorites.includes(key)
          ? favorites.filter((item) => item !== key)
          : [...favorites, key],
      },
    });
  const query = search.trim().toLocaleLowerCase();
  const groups = pickerGroups(issues, accountId, parentKey).map((group) => ({
    ...group,
    issues: group.issues.filter((issue) =>
      `${issue.key} ${issue.summary}`.toLocaleLowerCase().includes(query),
    ),
  }));
  const parents = issues.filter(isFavoriteParent);
  return (
    <section className="worklog-picker" aria-label="Choose Jira issue">
      <label>
        Board
        <select
          value={boardId || ""}
          onChange={(event) => {
            setIssues([]);
            setParentKey("");
            setSearch("");
            setLoading(true);
            persist({ ...preferences, boardId: Number(event.target.value) });
          }}
        >
          <option value="">Select a board</option>
          {boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name}
            </option>
          ))}
        </select>
      </label>
      {storageError ? (
        <p role="status">Preferences could not be remembered on this device.</p>
      ) : null}
      {loading ? <p role="status">Loading board choices…</p> : null}
      {error ? (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      ) : null}
      {boardId > 0 && !loading && !error ? (
        <>
          <div className="worklog-favorites" aria-label="Favorite Epic or Story">
            {favorites.map((key) => {
              const parent = parents.find((item) => item.key === key);
              return (
                <span key={key}>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!parent}
                    aria-pressed={parentKey === key}
                    onClick={() => setParentKey(key)}
                  >
                    {key} · {parent?.summary ?? "Unavailable on this board"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`Remove favorite ${key}`}
                    onClick={() => toggleFavorite(key)}
                  >
                    ★
                  </button>
                </span>
              );
            })}
          </div>
          <div role="group" aria-label="Epic or Story">
            <button
              type="button"
              aria-pressed={!parentKey}
              onClick={() => setParentKey("")}
            >
              All board issues
            </button>
            <ul>
              {parents.map((parent) => (
                <li key={parent.id}>
                  <button
                    type="button"
                    aria-label={`Show children of ${parent.key}`}
                    aria-pressed={parentKey === parent.key}
                    onClick={() => setParentKey(parent.key)}
                  >
                    {parent.key} · {parent.summary}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {parentKey ? (
            <button
              type="button"
              className="text-button"
              aria-pressed={favorites.includes(parentKey)}
              onClick={() => toggleFavorite(parentKey)}
            >
              {favorites.includes(parentKey) ? "★ Remove favorite" : "☆ Add favorite"}
            </button>
          ) : null}
          <label>
            Filter issue choices
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Issue key or summary"
            />
          </label>
          <div role="group" aria-label="Jira issue">
            {groups
              .filter((group) => group.issues.length)
              .map((group) => (
                <div role="group" aria-label={group.label} key={group.label}>
                  <h4>{group.label}</h4>
                  <ul>
                    {group.issues.map((issue) => (
                      <li key={issue.id}>
                        <button type="button" onClick={() => onSelect(issue)}>
                          {issue.key} · {issue.summary} ({issue.typeName})
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
          {!groups[0]?.issues.length ? (
            <p>No matching issues assigned to you on this board.</p>
          ) : null}
          {!groups.slice(1).some((group) => group.issues.length) ? (
            <p>
              No other matching issues
              {parentKey ? " in this selection" : " on this board"}.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
