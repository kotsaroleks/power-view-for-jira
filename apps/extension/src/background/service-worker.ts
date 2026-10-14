import { PRODUCT_NAME } from "@power-view/domain";

import {
  createExtensionMessageHandler,
  type MessageSenderContext,
} from "./message-handler";
import { platformOperations, removeContextForTab } from "./platform-operations";
import { registerUpdateChecks, runUpdateCheck } from "./update-checker-runner";

const handleMessage = createExtensionMessageHandler(platformOperations);

chrome.runtime.onInstalled.addListener((details) => {
  const version = chrome.runtime.getManifest().version;
  console.info(`${PRODUCT_NAME} ${version} installed.`);
  void runUpdateCheck();
  if (details.reason === "update") {
    void chrome.tabs
      .query({ url: `${chrome.runtime.getURL("app/index.html")}*` })
      .then((tabs) =>
        Promise.all(
          tabs
            .filter((tab) => tab.id !== undefined)
            .map((tab) => chrome.tabs.reload(tab.id!)),
        ),
      )
      .catch(() => {
        console.warn("Power View could not refresh an open workspace after updating.");
      });
  }
});

chrome.runtime.onStartup.addListener(() => {
  void runUpdateCheck();
});

registerUpdateChecks();

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const senderContext: MessageSenderContext = {
    ...(sender.tab?.id === undefined ? {} : { tabId: sender.tab.id }),
    ...(sender.url ? { url: sender.url } : {}),
  };

  void handleMessage(rawMessage, senderContext).then(sendResponse, () => {
    sendResponse({
      type: "ERROR",
      ok: false,
      error: {
        code: "UNKNOWN",
        message: "Power View could not process the extension message.",
        retryable: true,
      },
    });
  });

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeContextForTab(tabId).catch(() => {
    console.warn("Power View could not remove stale tab context.");
  });
});
