import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  build: {
    target: "node22",
    outDir: "../../dist/report-bot",
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/morning-cli.ts"),
      formats: ["es"],
      fileName: () => "morning-report.mjs",
    },
    rollupOptions: { external: [/^node:/] },
  },
});
