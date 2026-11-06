import { execFileSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (process.platform !== "darwin") {
  throw new Error("Creating a Safari app requires macOS and Xcode.");
}
const extension = resolve(import.meta.dirname, "../dist/safari-extension");
await access(resolve(extension, "manifest.json"));
// Keep the Xcode project outside dist so normal web builds preserve signing settings.
// Resources reference dist/safari-extension; build:safari refreshes those in place.
execFileSync(
  "xcrun",
  [
    "safari-web-extension-converter",
    extension,
    "--project-location",
    resolve(import.meta.dirname, "../safari"),
    "--app-name",
    "Power View for Jira",
    "--bundle-identifier",
    "com.kotsaroleks.powerviewforjira",
    "--macos-only",
    "--swift",
    "--no-open",
    "--no-prompt",
  ],
  { stdio: "inherit" },
);

// Apple's converter can derive the containing app ID from its display name
// even when --bundle-identifier is supplied. Keep parent and child IDs aligned.
const projectFile = resolve(
  import.meta.dirname,
  "../safari/Power View for Jira/Power View for Jira.xcodeproj/project.pbxproj",
);
const project = await readFile(projectFile, "utf8");
await writeFile(
  projectFile,
  project.replaceAll(
    'PRODUCT_BUNDLE_IDENTIFIER = "com.kotsaroleks.Power-View-for-Jira";',
    "PRODUCT_BUNDLE_IDENTIFIER = com.kotsaroleks.powerviewforjira;",
  ),
);
