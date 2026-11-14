import { execFileSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const projectRoot = import.meta.dirname;
const outputDirectory = resolve(projectRoot, "../../dist/extension");
const manifestSource = resolve(projectRoot, "src/manifest.json");
const manifestOutput = resolve(outputDirectory, "manifest.json");
const buildInfoOutput = resolve(outputDirectory, "build-info.json");
const appEntry = resolve(outputDirectory, "app/index.html");
const iconsSourceDirectory = resolve(projectRoot, "icons");
const iconsOutputDirectory = resolve(outputDirectory, "icons");

const copyManifest = (): Plugin => ({
  name: "copy-extension-manifest",
  async closeBundle() {
    await mkdir(dirname(manifestOutput), { recursive: true });
    const manifest = JSON.parse(await readFile(manifestSource, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(manifestOutput, JSON.stringify(manifest, null, 2) + "\n");
  },
});

const copyIcons = (): Plugin => ({
  name: "copy-extension-icons",
  async closeBundle() {
    await mkdir(iconsOutputDirectory, { recursive: true });
    const entries = await readdir(iconsSourceDirectory);
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".png"))
        .map((entry) =>
          copyFile(
            resolve(iconsSourceDirectory, entry),
            resolve(iconsOutputDirectory, entry),
          ),
        ),
    );
  },
});

function runGit(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function parseRepoFromRemoteUrl(
  remoteUrl: string | undefined,
): { owner: string; repo: string } | undefined {
  if (!remoteUrl) {
    return undefined;
  }

  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl);
  return match?.[1] && match[2] ? { owner: match[1], repo: match[2] } : undefined;
}

const emitBuildInfo = (): Plugin => ({
  name: "emit-extension-build-info",
  async closeBundle() {
    const commitSha = runGit(["rev-parse", "HEAD"]);
    const commitShaShort = runGit(["rev-parse", "--short", "HEAD"]);
    const remoteUrl = runGit(["config", "--get", "remote.origin.url"]);
    const parsedRepo = parseRepoFromRemoteUrl(remoteUrl);
    const gitAvailable = Boolean(commitSha && commitShaShort && parsedRepo);

    const buildInfo = {
      schemaVersion: 1,
      commitSha: commitSha ?? null,
      commitShaShort: commitShaShort ?? null,
      repoOwner: parsedRepo?.owner ?? null,
      repoName: parsedRepo?.repo ?? null,
      builtAt: new Date().toISOString(),
      gitAvailable,
    };

    await mkdir(dirname(buildInfoOutput), { recursive: true });
    const html = await readFile(appEntry, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      },
    );
    if (html !== undefined) {
      await writeFile(
        appEntry,
        html.replace(
          /<meta name="power-view-built-at" content="[^"]*"\s*\/?>/,
          `<meta name="power-view-built-at" content="${buildInfo.builtAt}" />`,
        ),
      );
    }
    await writeFile(buildInfoOutput, `${JSON.stringify(buildInfo, null, 2)}\n`);
  },
});

export default defineConfig({
  base: "./",
  plugins: [react(), copyManifest(), copyIcons(), emitBuildInfo()],
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
