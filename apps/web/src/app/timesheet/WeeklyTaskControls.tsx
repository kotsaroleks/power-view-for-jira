import type { useWeeklyTasks } from "./use-weekly-tasks";
export function WeeklyTaskControls({
  tasks,
  disabled,
}: {
  tasks: ReturnType<typeof useWeeklyTasks>;
  disabled: boolean;
}) {
  return (
    <div className="weekly-task-controls" aria-label="Weekly tasks">
      <label>
        Board{" "}
        <select
          value={tasks.boardId || ""}
          disabled={disabled}
          onChange={(event) => {
            tasks.changeBoard(Number(event.target.value));
          }}
        >
          <option value="">Select your board</option>
          {tasks.boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name}
            </option>
          ))}
        </select>
      </label>
      {tasks.loading ? <span role="status">Loading your tasks…</span> : null}
      {tasks.error ? (
        <p role="alert">
          {tasks.error}{" "}
          <button type="button" disabled={disabled} onClick={tasks.retry}>
            Retry
          </button>
        </p>
      ) : null}
      {tasks.storageError ? (
        <p role="status">Pins could not be remembered on this device.</p>
      ) : null}
      {tasks.boardId > 0 && !tasks.loading && !tasks.error ? (
        <>
          {tasks.unavailablePins.map((key) => (
            <span key={key}>
              {key} could not be loaded{" "}
              <button
                type="button"
                disabled={disabled}
                onClick={() => tasks.togglePin(key)}
              >
                Unpin {key}
              </button>
            </span>
          ))}
        </>
      ) : null}
    </div>
  );
}
