import { describe, expect, it } from "vitest";

import { ganttVirtualWindow } from "./ganttVirtualization";

describe("ganttVirtualWindow", () => {
  it("renders smaller task sets without virtualization", () => {
    expect(ganttVirtualWindow(40, 500)).toMatchObject({
      startIndex: 0,
      endIndex: 40,
      renderedRowCount: 40,
      virtualized: false,
    });
  });

  it("keeps a bounded overscanned window for 1,000 rows", () => {
    const window = ganttVirtualWindow(1_000, 15_000);

    expect(window.virtualized).toBe(true);
    expect(window.renderedRowCount).toBeLessThan(40);
    expect(window.startIndex).toBeGreaterThan(0);
    expect(window.topSpacerHeight + window.bottomSpacerHeight).toBeGreaterThan(0);
    expect(window.endIndex).toBeLessThanOrEqual(1_000);
  });

  it("clamps the window when filtering shrinks the result", () => {
    const window = ganttVirtualWindow(101, 99_999);

    expect(window.endIndex).toBe(101);
    expect(window.startIndex).toBeGreaterThan(0);
  });
});
