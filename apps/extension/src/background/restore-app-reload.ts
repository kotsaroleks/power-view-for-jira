import { AppReloadStore, ContextStore } from "@power-view/storage";

export async function restoreAppReload(platform = chrome): Promise<boolean> {
  const pending = await new AppReloadStore(platform.storage.local).take();
  if (!pending) return false;

  if (pending.context) {
    const { tabId, context } = pending.context;
    const jiraTab = await platform.tabs.get(tabId).catch(() => undefined);
    if (
      jiraTab?.url &&
      new URL(jiraTab.url).origin === new URL(context.baseUrl).origin &&
      (await platform.permissions.contains({
        origins: [`${new URL(context.baseUrl).origin}/*`],
      }))
    ) {
      await new ContextStore(platform.storage.session).save(tabId, context);
    }
  }

  const appUrl = platform.runtime.getURL("app/index.html");
  const tabs = await platform.tabs.query({ url: `${appUrl}*` });
  const existing = tabs.find((tab) => tab.id === pending.tabId) ?? tabs[0];
  if (existing?.id !== undefined) {
    await platform.tabs.reload(existing.id);
  } else {
    await platform.tabs.create({ url: appUrl, active: true });
  }
  return true;
}
