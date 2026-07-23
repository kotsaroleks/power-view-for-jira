import type { JiraPageContext } from "@power-view/domain";
import {
  createPowerViewOpenRequest,
  sendExtensionRequest,
  type ExtensionRuntime,
} from "@power-view/extension-messaging";

export async function openPowerView(
  context?: JiraPageContext,
  runtime: ExtensionRuntime = chrome.runtime,
): Promise<void> {
  const response = await sendExtensionRequest(
    runtime,
    createPowerViewOpenRequest(context),
  );

  if (response.type === "ERROR") {
    throw new Error(response.error.message);
  }
  if (response.type !== "POWER_VIEW_OPENED") {
    throw new Error(
      "The extension returned an unexpected response while opening Power View.",
    );
  }
}
