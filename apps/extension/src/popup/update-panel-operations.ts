import { UpdateStore } from "@power-view/storage";
import { checkForUpdate, type UpdateCheckResult } from "@power-view/update-checker";

import { getBuildInfo } from "../lib/build-info";

export async function defaultGetCheckResult(): Promise<UpdateCheckResult | undefined> {
  return new UpdateStore(chrome.storage.local).getCheckResult();
}

export async function defaultCheckForUpdateNow(): Promise<UpdateCheckResult> {
  if (typeof chrome.runtime.requestUpdateCheck === "function") {
    try {
      const update = await chrome.runtime.requestUpdateCheck();
      const checkedAt = new Date().toISOString();
      if (update.status === "update_available") {
        return {
          schemaVersion: 1,
          status: "update-available",
          checkedAt,
          ...(update.version ? { latestCommitSha: update.version } : {}),
        };
      }
      if (update.status === "no_update") {
        return { schemaVersion: 1, status: "up-to-date", checkedAt };
      }
      return {
        schemaVersion: 1,
        status: "check-failed",
        checkedAt,
        errorMessage: "Chrome throttled the update check. Try again later.",
      };
    } catch {
      return {
        schemaVersion: 1,
        status: "check-failed",
        checkedAt: new Date().toISOString(),
        errorMessage: "Chrome could not contact the enterprise update server.",
      };
    }
  }

  const store = new UpdateStore(chrome.storage.local);
  const buildInfo = await getBuildInfo();

  const result = await checkForUpdate({
    owner: buildInfo?.repoOwner ?? "",
    repo: buildInfo?.repoName ?? "",
    branch: "main",
    currentCommitSha: buildInfo?.commitSha ?? null,
  });

  await store.saveCheckResult(result);
  return result;
}

export function defaultOpenChromeExtensionsPage(): void {
  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
}

export function defaultReloadExtension(): void {
  void (async () => {
    if (typeof chrome.runtime.requestUpdateCheck === "function") {
      await chrome.runtime.requestUpdateCheck().catch(() => undefined);
    }
    chrome.runtime.reload();
  })();
}

export async function defaultCopyUpdateCommand(): Promise<void> {
  await navigator.clipboard.writeText("git pull && pnpm build");
}
