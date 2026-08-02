import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDirectory = resolve(import.meta.dirname, "..");
const extensionDirectory = resolve(rootDirectory, "dist/extension");
const outputDirectory = resolve(rootDirectory, "dist/enterprise");
const packageJson = JSON.parse(
  await readFile(resolve(rootDirectory, "package.json"), "utf8"),
);
const keyPath = process.env.EXTENSION_PRIVATE_KEY_PATH;
const updateUrl = process.env.EXTENSION_CRX_URL;

if (!keyPath || !updateUrl) {
  throw new Error(
    "EXTENSION_PRIVATE_KEY_PATH and EXTENSION_CRX_URL are required to package an enterprise update.",
  );
}

await mkdir(outputDirectory, { recursive: true });
const crxPath = resolve(outputDirectory, "power-view-for-jira.crx");
const xmlPath = resolve(outputDirectory, "updates.xml");

execFileSync(
  "pnpm",
  [
    "exec",
    "crx3",
    "--key",
    keyPath,
    "--crx",
    crxPath,
    "--xml",
    xmlPath,
    "--appVersion",
    packageJson.version,
    "--crxURL",
    updateUrl,
    extensionDirectory,
  ],
  { cwd: rootDirectory, stdio: "inherit" },
);

console.info(`Enterprise update packaged for version ${packageJson.version}.`);
