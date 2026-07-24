import { UpdateStore } from "@power-view/storage";
import { checkForUpdate, type UpdateCheckResult } from "@power-view/update-checker";

import { getBuildInfo } from "../lib/build-info";

export interface UpdateStatus {
  hasToken: boolean;
  tokenHint?: string;
  checkResult?: UpdateCheckResult;
}

export async function defaultGetUpdateStatus(): Promise<UpdateStatus> {
  const store = new UpdateStore(chrome.storage.local);
  const [tokenHint, checkResult] = await Promise.all([
    store.getTokenHint(),
    store.getCheckResult(),
  ]);

  return {
    hasToken: tokenHint !== undefined,
    ...(tokenHint ? { tokenHint } : {}),
    ...(checkResult ? { checkResult } : {}),
  };
}

export async function defaultSaveUpdateToken(token: string): Promise<void> {
  await new UpdateStore(chrome.storage.local).saveToken(token);
}

export async function defaultClearUpdateToken(): Promise<void> {
  await new UpdateStore(chrome.storage.local).clearToken();
}

export async function defaultCheckForUpdateNow(): Promise<UpdateCheckResult> {
  const store = new UpdateStore(chrome.storage.local);
  const [token, buildInfo] = await Promise.all([store.getToken(), getBuildInfo()]);

  const result = await checkForUpdate({
    token,
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
