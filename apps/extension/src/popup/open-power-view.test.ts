import type { ExtensionRuntime } from "@power-view/extension-messaging";
import { describe, expect, it, vi } from "vitest";

import { openPowerView } from "./open-power-view";

describe("openPowerView", () => {
  it("requests a separate Power View tab through typed messaging", async () => {
    const sendMessage = vi.fn().mockImplementation((message: unknown) => {
      const request = message as { requestId: string };
      return Promise.resolve({
        type: "POWER_VIEW_OPENED",
        requestId: request.requestId,
        ok: true,
        tabId: 42,
      });
    });
    const runtime: ExtensionRuntime = { sendMessage };

    await openPowerView(undefined, runtime);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "POWER_VIEW_OPEN" }),
    );
  });
});
