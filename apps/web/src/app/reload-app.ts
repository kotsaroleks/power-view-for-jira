import type { ExtensionRuntime } from "@power-view/extension-messaging";
import { AppReloadStore, ContextStore } from "@power-view/storage";

type ReloadableRuntime = ExtensionRuntime & { reload?: () => void };

export function loadedBuildTime(): string | undefined {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="power-view-built-at"]')
      ?.content || undefined
  );
}

export async function updateApp(runtime: ReloadableRuntime): Promise<string | undefined> {
  if (
    typeof chrome === "undefined" ||
    runtime !== chrome.runtime ||
    new URL(chrome.runtime.getURL("/")).protocol !== "chrome-extension:"
  ) {
    await reloadApp(runtime);
    return undefined;
  }

  const extension = await chrome.management?.getSelf?.().catch(() => undefined);
  if (extension?.installType === "development") {
    const currentBuild = loadedBuildTime();
    if (currentBuild) {
      const response = await fetch(chrome.runtime.getURL("build-info.json"), {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Build information is unavailable.");
      const build = (await response.json()) as { builtAt?: string };
      if (!build.builtAt) throw new Error("Build information is incomplete.");
      if (build.builtAt === currentBuild) {
        return "Chrome already has this local build. To apply a newer build, update the files in the folder shown under Loaded from in Chrome Extensions.";
      }
    }
  } else if (extension && typeof chrome.runtime.requestUpdateCheck === "function") {
    const update = await chrome.runtime.requestUpdateCheck();
    if (update.status === "no_update") {
      return `Chrome found no update for Power View ${extension.version}.`;
    }
    if (update.status === "throttled") {
      return "Chrome is limiting update checks. Try again in a few minutes.";
    }
  }

  await reloadApp(runtime);
  return undefined;
}

export async function reloadApp(runtime: ReloadableRuntime): Promise<void> {
  if (typeof runtime.reload !== "function") {
    window.location.reload();
    return;
  }
  if (typeof chrome !== "undefined" && runtime === chrome.runtime) {
    const context = await new ContextStore(chrome.storage.session).getLatest();
    const tab = await chrome.tabs.getCurrent();
    await new AppReloadStore(chrome.storage.local).save({
      requestedAt: new Date().toISOString(),
      ...(tab?.id === undefined ? {} : { tabId: tab.id }),
      ...(context ? { context } : {}),
    });
  }
  runtime.reload();
}
