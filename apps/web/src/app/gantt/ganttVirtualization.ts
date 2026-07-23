export interface GanttVirtualWindow {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  renderedRowCount: number;
  virtualized: boolean;
}

export interface GanttVirtualizationOptions {
  rowHeight?: number;
  viewportHeight?: number;
  overscan?: number;
  threshold?: number;
}

export function ganttVirtualWindow(
  rowCount: number,
  scrollTop: number,
  options: GanttVirtualizationOptions = {},
): GanttVirtualWindow {
  const rowHeight = options.rowHeight ?? 50;
  const viewportHeight = options.viewportHeight ?? 540;
  const overscan = options.overscan ?? 8;
  const threshold = options.threshold ?? 100;
  const safeRowCount = Math.max(0, Math.trunc(rowCount));

  if (safeRowCount <= threshold) {
    return {
      startIndex: 0,
      endIndex: safeRowCount,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      renderedRowCount: safeRowCount,
      virtualized: false,
    };
  }

  const viewportRows = Math.ceil(viewportHeight / rowHeight);
  const windowSize = viewportRows + overscan * 2;
  const requestedStart = Math.max(
    0,
    Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan,
  );
  const startIndex = Math.min(requestedStart, Math.max(0, safeRowCount - windowSize));
  const endIndex = Math.min(safeRowCount, startIndex + windowSize);

  return {
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * rowHeight,
    bottomSpacerHeight: (safeRowCount - endIndex) * rowHeight,
    renderedRowCount: endIndex - startIndex,
    virtualized: true,
  };
}
