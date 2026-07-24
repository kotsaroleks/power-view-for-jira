import { UpdateStore } from "@power-view/storage";
import { checkForUpdate } from "@power-view/update-checker";

import { getBuildInfo, type BuildInfo } from "../lib/build-info";

const ALARM_NAME = "power-view-update-check";
const CHECK_PERIOD_MINUTES = 60;
const UPDATE_BADGE_COLOR = "#ae2a19";
const ATTENTION_BADGE_COLOR = "#626f86";

const updateStore = new UpdateStore(chrome.storage.local);
let cachedBuildInfo: BuildInfo | undefined;

async function resolveBuildInfo(): Promise<BuildInfo | undefined> {
  if (!cachedBuildInfo) {
    cachedBuildInfo = await getBuildInfo();
  }
  return cachedBuildInfo;
}

async function updateBadge(status: Awaited<ReturnType<typeof checkForUpdate>>["status"]) {
  if (status === "update-available") {
    await chrome.action.setBadgeText({ text: "●" });
    await chrome.action.setBadgeBackgroundColor({ color: UPDATE_BADGE_COLOR });
    return;
  }

  if (status === "token-invalid" || status === "check-failed") {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: ATTENTION_BADGE_COLOR });
    return;
  }

  await chrome.action.setBadgeText({ text: "" });
}

export async function runUpdateCheck(): Promise<void> {
  const [token, buildInfo] = await Promise.all([
    updateStore.getToken(),
    resolveBuildInfo(),
  ]);

  const result = await checkForUpdate({
    token,
    owner: buildInfo?.repoOwner ?? "",
    repo: buildInfo?.repoName ?? "",
    branch: "main",
    currentCommitSha: buildInfo?.commitSha ?? null,
  });

  await updateStore.saveCheckResult(result);
  await updateBadge(result.status);
}

export function registerUpdateChecks(): void {
  void chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_PERIOD_MINUTES });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      void runUpdateCheck();
    }
  });
}
