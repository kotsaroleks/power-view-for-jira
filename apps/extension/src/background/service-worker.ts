import { PRODUCT_NAME } from "@power-view/domain";

import {
  createExtensionMessageHandler,
  type MessageSenderContext,
} from "./message-handler";
import { platformOperations, removeContextForTab } from "./platform-operations";

const handleMessage = createExtensionMessageHandler(platformOperations);

chrome.runtime.onInstalled.addListener(() => {
  const version = chrome.runtime.getManifest().version;
  console.info(`${PRODUCT_NAME} ${version} installed.`);
});

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
