import react from "@vitejs/plugin-react";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const projectRoot = import.meta.dirname;
const outputDirectory = resolve(projectRoot, "../../dist/extension");
const manifestSource = resolve(projectRoot, "src/manifest.json");
const manifestOutput = resolve(outputDirectory, "manifest.json");

const copyManifest = (): Plugin => ({
  name: "copy-extension-manifest",
  async closeBundle() {
    await mkdir(dirname(manifestOutput), { recursive: true });
    await copyFile(manifestSource, manifestOutput);
  },
});

export default defineConfig({
  base: "./",
  plugins: [react(), copyManifest()],
  build: {
    emptyOutDir: false,
    outDir: outputDirectory,
    rollupOptions: {
      input: {
        popup: resolve(projectRoot, "popup/index.html"),
        background: resolve(projectRoot, "src/background/service-worker.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background/service-worker.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
