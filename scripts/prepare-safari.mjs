import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

const source = resolve(import.meta.dirname, "../dist/extension");
const destination = resolve(import.meta.dirname, "../dist/safari-extension");
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"));
// Chrome enterprise signing and update metadata do not apply to Safari apps.
delete manifest.key;
delete manifest.update_url;
// Safari does not support background.type; bundle a classic worker instead.
delete manifest.background.type;
manifest.browser_specific_settings = { safari: { strict_min_version: "18.4" } };
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
await build({
  configFile: false,
  build: {
    emptyOutDir: false,
    outDir: destination,
    lib: {
      entry: resolve(
        import.meta.dirname,
        "../apps/extension/src/background/service-worker.ts",
      ),
      formats: ["iife"],
      name: "PowerViewSafariBackground",
      fileName: () => "background/service-worker.js",
    },
  },
});
await writeFile(
  resolve(destination, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.info(`Prepared Safari web extension: ${destination}`);
