import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  build: {
    target: "node22",
    outDir: "../../dist/report-bot",
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/cli.ts"),
      formats: ["es"],
      fileName: () => "description-report.mjs",
    },
    rollupOptions: { external: [/^node:/] },
  },
});
