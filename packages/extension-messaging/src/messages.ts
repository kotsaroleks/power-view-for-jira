import type { JiraPageContext } from "@power-view/domain";

import type { ExtensionRequest, JiraTransportRequest } from "./schemas";

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function createContextGetRequest(requestId = createRequestId()): ExtensionRequest {
  return { type: "CONTEXT_GET", requestId };
}

export function createContextRefreshRequest(
  requestId = createRequestId(),
  tabId?: number,
): ExtensionRequest {
  return tabId === undefined
    ? { type: "CONTEXT_REFRESH", requestId }
    : { type: "CONTEXT_REFRESH", requestId, tabId };
}

export function createPowerViewOpenRequest(
  context?: JiraPageContext,
  requestId = createRequestId(),
): ExtensionRequest {
  return context === undefined
    ? { type: "POWER_VIEW_OPEN", requestId }
    : { type: "POWER_VIEW_OPEN", requestId, context };
}

export function createHostPermissionRequest(
  originPattern: string,
  requestId = createRequestId(),
): ExtensionRequest {
  return { type: "HOST_PERMISSION_REQUEST", requestId, originPattern };
}

export function createJiraRequest(
  payload: JiraTransportRequest,
  requestId = createRequestId(),
): ExtensionRequest {
  return { type: "JIRA_REQUEST", requestId, payload };
}

export function createJiraRequestCancellation(
  targetRequestId: string,
  requestId = createRequestId(),
): ExtensionRequest {
  return { type: "JIRA_REQUEST_CANCEL", requestId, targetRequestId };
}

export function createIssueLoadReportRequest(
  loadedIssueCount: number,
  cacheStatus: "ready" | "error",
  requestId = createRequestId(),
): ExtensionRequest {
  return {
    type: "ISSUE_LOAD_REPORT",
    requestId,
    loadedIssueCount,
    cacheStatus,
  };
}

export function createDiagnosticsGetRequest(
  requestId = createRequestId(),
): ExtensionRequest {
  return { type: "DIAGNOSTICS_GET", requestId };
}
