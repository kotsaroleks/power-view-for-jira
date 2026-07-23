import type { SerializableAppError } from "@power-view/domain";

export function jiraStatusError(
  status: number,
  retryable: boolean,
  path: string,
): SerializableAppError {
  if (status === 401) {
    return {
      code: "AUTH_REQUIRED",
      message: "Jira did not accept the current browser session.",
      details: "Open Jira, sign in, then test the connection again.",
      retryable: true,
      httpStatus: status,
    };
  }
  if (status === 403) {
    return {
      code: "PERMISSION_DENIED",
      message: "Jira denied access for the current user.",
      details: "Ask a Jira administrator to verify your product and project permissions.",
      retryable: false,
      httpStatus: status,
    };
  }
  if (status === 429) {
    return {
      code: "RATE_LIMITED",
      message: "Jira is temporarily rate limiting Power View.",
      details: "Wait for the Jira retry window, then try again.",
      retryable: true,
      httpStatus: status,
    };
  }
  if (status === 404) {
    return {
      code: "UNSUPPORTED_DEPLOYMENT",
      message: "This Jira instance does not expose the required REST endpoint.",
      details: "Verify the detected Jira deployment and base URL.",
      retryable: false,
      httpStatus: status,
    };
  }
  if (
    status === 400 &&
    (path === "/rest/api/2/search" || path === "/rest/api/3/search/jql")
  ) {
    return {
      code: "INVALID_JQL",
      message: "Jira rejected the JQL query.",
      details: "Review the query syntax and fields, then try again.",
      retryable: false,
      httpStatus: status,
    };
  }
  if (status >= 500) {
    return {
      code: "NETWORK_ERROR",
      message: "Jira could not complete the request.",
      details: "The Jira server returned a temporary server error.",
      retryable,
      httpStatus: status,
    };
  }

  return {
    code: "INVALID_RESPONSE",
    message: "Jira returned an unexpected HTTP response.",
    retryable: false,
    httpStatus: status,
  };
}
