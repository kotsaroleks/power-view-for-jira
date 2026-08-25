import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

let css = "";

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match?.[1]) throw new Error(`Missing CSS rule for ${selector}.`);
  return match[1];
}

function exactDeclarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declarations = css.match(
    new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`),
  )?.[1];
  if (!declarations) throw new Error(`Missing CSS rule for ${selector}.`);
  return declarations;
}

beforeAll(async () => {
  css = await readFile(resolve(import.meta.dirname, "gantt-v2.css"), "utf8");
});

describe("Gantt v2 page layout", () => {
  it("expands all rows into the page and reserves internal scrolling for the horizontal timeline", () => {
    expect(declarations(".gantt-v2")).toMatch(/overflow\s*:\s*visible/);
    expect(declarations(".gantt-v2-split")).not.toMatch(/max-height\s*:/);
    expect(declarations(".gantt-v2-table")).not.toMatch(/overflow\s*:\s*auto/);

    const timelineScroll = declarations(".gantt-v2-timeline-scroll");
    expect(timelineScroll).toMatch(/overflow-x\s*:\s*auto/);
    expect(timelineScroll).not.toMatch(/overflow-y\s*:\s*auto/);
    expect(timelineScroll).not.toMatch(/overflow\s*:\s*auto/);
  });

  it("gives dependency connectors a usable hit target without enlarging the dot", () => {
    const handle = exactDeclarations(".gantt-v2-dependency-handle");
    expect(handle).toMatch(/width\s*:\s*24px/);
    expect(handle).toMatch(/height\s*:\s*24px/);

    const dot = declarations(".gantt-v2-dependency-handle::after");
    expect(dot).toMatch(/width\s*:\s*10px/);
    expect(dot).toMatch(/height\s*:\s*10px/);
    expect(declarations(".gantt-v2.is-linking .gantt-v2-dependency-handle")).toMatch(
      /opacity\s*:\s*1/,
    );
  });
});
