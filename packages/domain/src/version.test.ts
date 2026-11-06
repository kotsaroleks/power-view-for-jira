import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PRODUCT_VERSION } from "./index";

describe("release version", () => {
  it("keeps the staff release version consistent in every release source", async () => {
    const rootPackage = JSON.parse(
      await readFile(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
    ) as { version: string };
    const manifest = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, "../../../apps/extension/src/manifest.json"),
        "utf8",
      ),
    ) as { version: string };

    expect(PRODUCT_VERSION).toBe("0.3.2");
    expect(rootPackage.version).toBe(PRODUCT_VERSION);
    expect(manifest.version).toBe(PRODUCT_VERSION);
  });
});
