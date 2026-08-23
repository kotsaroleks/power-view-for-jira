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
});
