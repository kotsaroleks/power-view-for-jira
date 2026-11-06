import { existsSync, readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const configPath = resolve(
  import.meta.dirname,
  "../../.secrets/day-off-github.local.json",
);
const rawDayOffConfig: unknown = process.env.POWERVIEW_DAY_OFF_GITHUB_CONFIG
  ? JSON.parse(process.env.POWERVIEW_DAY_OFF_GITHUB_CONFIG)
  : existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : null;

const configRecord =
  rawDayOffConfig && typeof rawDayOffConfig === "object"
    ? (rawDayOffConfig as Record<string, unknown>)
    : null;
const dayOffConfig =
  configRecord &&
  ["owner", "repo", "branch", "root", "token"].every((key) => {
    const value = configRecord[key];
    return typeof value === "string" && value.trim();
  })
    ? configRecord
    : null;

export default defineConfig({
  define: { __DAY_OFF_GITHUB_CONFIG__: JSON.stringify(dayOffConfig) },
  base: "./",
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: resolve(import.meta.dirname, "../../dist/extension/app"),
  },
});
