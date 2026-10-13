import { useRef, useState, type KeyboardEvent } from "react";

/** One tab stop for the grid; Enter/F2 enters a cell's action, arrows move cells. */
export function useGanttGridNavigation(taskIds: readonly string[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState({ taskId: taskIds[0], column: 0 });
  const activeId = taskIds.includes(active.taskId ?? "") ? active.taskId : taskIds[0];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest('[role="dialog"]')) return;
    const cell = event.target.closest<HTMLElement>('[role="gridcell"]');
    if (!cell) return;
    const cells = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role="gridcell"]') ?? [],
    );
    const index = cells.indexOf(cell);
    const row = Math.floor(index / 3);
    const column = index % 3;
    let target = index;
    switch (event.key) {
      case "ArrowUp":
        target = Math.max(0, row - 1) * 3 + column;
        break;
      case "ArrowDown":
        target = Math.min(taskIds.length - 1, row + 1) * 3 + column;
        break;
      case "ArrowLeft":
        target = row * 3 + Math.max(0, column - 1);
        break;
      case "ArrowRight":
        target = row * 3 + Math.min(2, column + 1);
        break;
      case "Home":
        target = event.ctrlKey ? 0 : row * 3;
        break;
      case "End":
        target = event.ctrlKey ? cells.length - 1 : row * 3 + 2;
        break;
      case "Enter":
      case " ":
      case "F2": {
        if (event.target !== cell) return;
        event.preventDefault();
        const action =
          event.key === "Enter"
            ? (cell.querySelector<HTMLElement>("a[href]") ??
              cell.querySelector<HTMLElement>("button"))
            : cell.querySelector<HTMLElement>("button, a[href]");
        action?.focus();
        return;
      }
      case "Escape":
        event.preventDefault();
        cell.focus();
        return;
      default:
        return;
    }
    event.preventDefault();
    cells[target]?.focus();
  };

  return {
    ref,
    onKeyDown,
    cellProps: (taskId: string, column: number) => ({
      tabIndex: activeId === taskId && active.column === column ? 0 : -1,
      onFocus: () => setActive({ taskId, column }),
    }),
  };
}
