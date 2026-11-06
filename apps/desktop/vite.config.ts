import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "../../dist/desktop",
    lib: {
      entry: resolve(import.meta.dirname, "src/main.ts"),
      formats: ["es"],
      fileName: () => "main.mjs",
    },
    rollupOptions: { external: [/^node:/, "electron"] },
  },
});
