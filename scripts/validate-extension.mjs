import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const extensionDirectory = resolve(import.meta.dirname, "../dist/extension");
const requiredFiles = [
  "manifest.json",
  "background/service-worker.js",
  "content/content-script.js",
  "popup/index.html",
  "app/index.html",
];

await Promise.all(
  requiredFiles.map((relativePath) => access(resolve(extensionDirectory, relativePath))),
);

const manifestText = await readFile(resolve(extensionDirectory, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText);
const contentScriptText = await readFile(
  resolve(extensionDirectory, "content/content-script.js"),
  "utf8",
);

if (manifest.manifest_version !== 3) {
  throw new Error("The production manifest must use Manifest V3.");
}

if (
  manifest.background?.service_worker !== "background/service-worker.js" ||
  manifest.background?.type !== "module"
) {
  throw new Error("The production service worker must remain an MV3 module.");
}

const requiredPermissions = ["activeTab", "scripting", "storage"];
const actualPermissions = [...(manifest.permissions ?? [])].sort();

if (JSON.stringify(actualPermissions) !== JSON.stringify(requiredPermissions)) {
  throw new Error("The production permission set is missing or unexpectedly broad.");
}

if (manifest.host_permissions?.length > 0) {
  throw new Error("Jira hosts must not be included in mandatory host permissions.");
}

if (
  JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(["https://*/*"])
) {
  throw new Error("Custom Jira access must remain an optional HTTPS host permission.");
}

if (
  manifest.content_security_policy?.extension_pages !==
  "script-src 'self'; object-src 'self'"
) {
  throw new Error("Extension pages must keep the self-only production CSP.");
}

if (manifest.externally_connectable || manifest.web_accessible_resources) {
  throw new Error("The production extension must not expose external connection points.");
}

const contentMatches = manifest.content_scripts?.flatMap(
  (contentScript) => contentScript.matches ?? [],
);
if (JSON.stringify(contentMatches) !== JSON.stringify(["https://*.atlassian.net/*"])) {
  throw new Error("Static content-script scope changed unexpectedly.");
}

if (/^\s*(?:import|export)\s/m.test(contentScriptText)) {
  throw new Error("The content script must be bundled as a classic non-module script.");
}

console.info(`Validated ${requiredFiles.length} extension entry points.`);
