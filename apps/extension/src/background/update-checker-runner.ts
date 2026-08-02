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

  if (status === "check-failed") {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: ATTENTION_BADGE_COLOR });
    return;
  }

  await chrome.action.setBadgeText({ text: "" });
}

export async function runUpdateCheck(): Promise<void> {
  if (typeof chrome.runtime.requestUpdateCheck === "function") {
    try {
      const update = await chrome.runtime.requestUpdateCheck();
      const checkedAt = new Date().toISOString();
      const result =
        update.status === "update_available"
          ? {
              schemaVersion: 1 as const,
              status: "update-available" as const,
              checkedAt,
              ...(update.version ? { latestCommitSha: update.version } : {}),
            }
          : update.status === "no_update"
            ? { schemaVersion: 1 as const, status: "up-to-date" as const, checkedAt }
            : {
                schemaVersion: 1 as const,
                status: "check-failed" as const,
                checkedAt,
                errorMessage: "Chrome throttled the enterprise update check.",
              };
      await updateStore.saveCheckResult(result);
      await updateBadge(result.status);
      return;
    } catch {
      const result = {
        schemaVersion: 1 as const,
        status: "check-failed" as const,
        checkedAt: new Date().toISOString(),
        errorMessage: "Chrome could not contact the enterprise update server.",
      };
      await updateStore.saveCheckResult(result);
      await updateBadge(result.status);
      return;
    }
  }

  const buildInfo = await resolveBuildInfo();

  const result = await checkForUpdate({
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
