import { UpdateStore } from "@power-view/storage";
import { checkForUpdate, type UpdateCheckResult } from "@power-view/update-checker";

import { getBuildInfo } from "../lib/build-info";

export async function defaultGetCheckResult(): Promise<UpdateCheckResult | undefined> {
  return new UpdateStore(chrome.storage.local).getCheckResult();
}

export async function defaultCheckForUpdateNow(): Promise<UpdateCheckResult> {
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

export async function defaultCopyUpdateCommand(): Promise<void> {
  await navigator.clipboard.writeText("git pull && pnpm build");
}
