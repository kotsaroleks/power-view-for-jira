import { describe, expect, it, vi } from "vitest";

import { executeWithJiraPageFallback } from "./jira-request-fallback";
import { JiraRequestExecutionError } from "./jira-request-handler";

function requestError(
  code: "AUTH_REQUIRED" | "NETWORK_ERROR" | "PERMISSION_DENIED",
  message = "Primary request failed.",
) {
  return new JiraRequestExecutionError(
    { code, message, retryable: code !== "PERMISSION_DENIED" },
    12,
    1,
  );
}

describe("Jira request page fallback", () => {
  it.each(["AUTH_REQUIRED", "NETWORK_ERROR"] as const)(
    "uses the Jira page bridge after %s",
    async (code) => {
      const bridge = vi.fn().mockResolvedValue({
        status: 200,
        data: { displayName: "Alex" },
        durationMs: 8,
        retryCount: 0,
        transport: "jira-page-bridge",
      });

      await expect(
        executeWithJiraPageFallback(() => Promise.reject(requestError(code)), bridge),
      ).resolves.toMatchObject({ durationMs: 20, retryCount: 1 });
      expect(bridge).toHaveBeenCalledOnce();
    },
  );

  it("does not bypass Jira permission errors", async () => {
    const bridge = vi.fn();

    await expect(
      executeWithJiraPageFallback(
        () => Promise.reject(requestError("PERMISSION_DENIED")),
        bridge,
      ),
    ).rejects.toMatchObject({ appError: { code: "PERMISSION_DENIED" } });
    expect(bridge).not.toHaveBeenCalled();
  });

  it("does not restart a cancelled request through the bridge", async () => {
    const bridge = vi.fn();

    await expect(
      executeWithJiraPageFallback(
        () =>
          Promise.reject(
            requestError("NETWORK_ERROR", "The Jira request was cancelled."),
          ),
        bridge,
      ),
    ).rejects.toMatchObject({
      appError: { message: "The Jira request was cancelled." },
    });
    expect(bridge).not.toHaveBeenCalled();
  });
});
