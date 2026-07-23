import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/content/content-script.ts"),
      formats: ["iife"],
      name: "PowerViewContentScript",
      fileName: () => "content/content-script.js",
    },
    outDir: resolve(import.meta.dirname, "../../dist/extension"),
  },
});
