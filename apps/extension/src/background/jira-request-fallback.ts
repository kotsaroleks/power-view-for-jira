import {
  JiraRequestExecutionError,
  type JiraRequestResult,
} from "./jira-request-handler";

const PAGE_BRIDGE_FALLBACK_CODES = new Set(["AUTH_REQUIRED", "NETWORK_ERROR", "TIMEOUT"]);

export async function executeWithJiraPageFallback(
  primary: () => Promise<JiraRequestResult>,
  pageBridge: () => Promise<JiraRequestResult>,
): Promise<JiraRequestResult> {
  try {
    return await primary();
  } catch (error) {
    if (
      !(error instanceof JiraRequestExecutionError) ||
      !PAGE_BRIDGE_FALLBACK_CODES.has(error.appError.code) ||
      error.appError.message === "The Jira request was cancelled."
    ) {
      throw error;
    }

    try {
      const bridgeResult = await pageBridge();
      return {
        ...bridgeResult,
        durationMs: error.durationMs + bridgeResult.durationMs,
        retryCount: error.retryCount + bridgeResult.retryCount,
      };
    } catch (bridgeError) {
      if (bridgeError instanceof JiraRequestExecutionError) {
        throw new JiraRequestExecutionError(
          bridgeError.appError,
          error.durationMs + bridgeError.durationMs,
          error.retryCount + bridgeError.retryCount,
          bridgeError.transport,
          bridgeError.failureStage,
        );
      }
      throw bridgeError;
    }
  }
}
