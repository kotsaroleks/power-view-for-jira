import type {
  DiagnosticsSnapshot,
  JiraPageContext,
  RequestDiagnostic,
  SerializableAppError,
} from "@power-view/domain";
import {
  extensionResponseSchema,
  normalizeHostPermissionPattern,
  type JiraTransportRequest,
} from "@power-view/extension-messaging";
import {
  ContextStore,
  DiagnosticsStore,
  type StoredJiraContext,
} from "@power-view/storage";

import {
  sanitizedJiraRequestHeaders,
  validatedJiraRequestUrl,
} from "../jira-request-policy";
import { jiraStatusError } from "../jira-response-policy";
import {
  fetchJiraInMainWorld,
  parseJiraMainWorldFetchResult,
} from "./jira-main-world-bridge";
import { JiraRequestExecutionError, JiraRequestHandler } from "./jira-request-handler";
import { executeWithJiraPageFallback } from "./jira-request-fallback";
import {
  ExtensionOperationError,
  type MessageHandlerDependencies,
  type MessageSenderContext,
} from "./message-handler";

const CONTENT_SCRIPT_FILE = "content/content-script.js";
const contextStore = new ContextStore(chrome.storage.session);
const diagnosticsStore = new DiagnosticsStore(chrome.storage.session);
const jiraRequestHandler = new JiraRequestHandler();
const bridgeRequestTabs = new Map<string, number>();

const CONTEXT_PERMISSION_MEMO_TTL_MS = 2_000;

interface ContextPermissionMemo {
  value: StoredJiraContext;
  expiresAt: number;
}

let contextPermissionMemo: ContextPermissionMemo | undefined;

function clearContextPermissionMemo(): void {
  contextPermissionMemo = undefined;
}

// Revoking host access must take effect immediately, not after the memo's TTL
// expires. Without these listeners, a request could keep reaching a Jira host
// for up to CONTEXT_PERMISSION_MEMO_TTL_MS after the user revokes access.
// Do not remove these as "redundant with the TTL" — they are a security
// requirement, not an optimisation.
if (chrome.permissions?.onRemoved) {
  chrome.permissions.onRemoved.addListener(clearContextPermissionMemo);
}
if (chrome.permissions?.onAdded) {
  chrome.permissions.onAdded.addListener(clearContextPermissionMemo);
}

function operationError(error: SerializableAppError): ExtensionOperationError {
  return new ExtensionOperationError(error);
}

function requireTrustedExtensionSender(sender: MessageSenderContext): void {
  let senderUrl: URL | undefined;
  try {
    senderUrl = sender.url ? new URL(sender.url) : undefined;
  } catch {
    senderUrl = undefined;
  }

  if (
    !senderUrl ||
    senderUrl.protocol !== "chrome-extension:" ||
    senderUrl.hostname !== chrome.runtime.id
  ) {
    throw operationError({
      code: "PERMISSION_DENIED",
      message: "This extension operation is not available from a Jira page.",
      retryable: false,
    });
  }
}

function contentScriptId(originPattern: string): string {
  let hash = 2_166_136_261;
  for (const character of originPattern) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `jira-context-${(hash >>> 0).toString(36)}`;
}

async function registerCustomJiraContentScript(originPattern: string): Promise<void> {
  const id = contentScriptId(originPattern);
  const existingScripts = await chrome.scripting.getRegisteredContentScripts({
    ids: [id],
  });
  const script: chrome.scripting.RegisteredContentScript = {
    id,
    matches: [originPattern],
    js: [CONTENT_SCRIPT_FILE],
    runAt: "document_idle",
    persistAcrossSessions: true,
  };

  if (existingScripts.length > 0) {
    await chrome.scripting.updateContentScripts([script]);
  } else {
    await chrome.scripting.registerContentScripts([script]);
  }

  const matchingTabs = await chrome.tabs.query({ url: originPattern });
  const injections = await Promise.allSettled(
    matchingTabs.flatMap((tab) =>
      tab.id === undefined
        ? []
        : [
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: [CONTENT_SCRIPT_FILE],
            }),
          ],
    ),
  );

  if (injections.some((result) => result.status === "rejected")) {
    console.warn("Power View host access was granted, but one Jira tab needs a reload.");
  }
}

async function activeTab(requestedTabId?: number): Promise<chrome.tabs.Tab> {
  if (requestedTabId !== undefined) {
    return chrome.tabs.get(requestedTabId);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw operationError({
      code: "JIRA_NOT_DETECTED",
      message: "Power View could not find the active browser tab.",
      retryable: true,
    });
  }
  return tab;
}

async function refreshContext(tabId?: number): Promise<JiraPageContext> {
  const tab = await activeTab(tabId);
  if (tab.id === undefined || !tab.url) {
    throw operationError({
      code: "JIRA_NOT_DETECTED",
      message: "The active tab does not expose a Jira page URL.",
      retryable: true,
    });
  }

  let rawResponse: unknown;
  try {
    rawResponse = await chrome.tabs.sendMessage(tab.id, {
      type: "CONTEXT_GET",
      requestId: crypto.randomUUID(),
    });
  } catch {
    const originPattern = (() => {
      try {
        return normalizeHostPermissionPattern(tab.url ?? "");
      } catch {
        return undefined;
      }
    })();

    throw operationError({
      code: originPattern ? "HOST_PERMISSION_MISSING" : "JIRA_NOT_DETECTED",
      message: originPattern
        ? "Power View does not have access to this Jira site."
        : "Power View could not detect Jira on the active page.",
      details: originPattern
        ? "Grant access to the exact Jira host, then retry detection."
        : "Open a Jira Cloud page or enter a custom Jira URL.",
      retryable: true,
    });
  }

  const response = extensionResponseSchema.safeParse(rawResponse);
  if (!response.success) {
    throw operationError({
      code: "INVALID_RESPONSE",
      message: "The Jira page returned an invalid context response.",
      retryable: true,
    });
  }
  if (response.data.type === "ERROR") {
    throw operationError(response.data.error);
  }
  if (response.data.type !== "CONTEXT_RESULT") {
    throw operationError({
      code: "INVALID_RESPONSE",
      message: "The Jira page returned an unexpected response type.",
      retryable: true,
    });
  }

  await contextStore.save(tab.id, response.data.context);
  clearContextPermissionMemo();
  return response.data.context;
}

async function storeDetectedContext(
  context: JiraPageContext,
  sender: MessageSenderContext,
): Promise<void> {
  if (sender.tabId === undefined || !sender.url) {
    throw operationError({
      code: "PERMISSION_DENIED",
      message: "Detected context must come from a browser tab.",
      retryable: false,
    });
  }

  const senderOrigin = new URL(sender.url).origin;
  if (
    new URL(context.pageUrl).origin !== senderOrigin ||
    new URL(context.baseUrl).origin !== senderOrigin
  ) {
    throw operationError({
      code: "PERMISSION_DENIED",
      message: "The detected Jira context did not match its sender origin.",
      retryable: false,
    });
  }

  await contextStore.save(sender.tabId, context);
  clearContextPermissionMemo();
}

async function openPowerView(
  _context: JiraPageContext | undefined,
  sender: MessageSenderContext,
): Promise<number> {
  requireTrustedExtensionSender(sender);
  const appUrl = chrome.runtime.getURL("app/index.html");
  const existingTabs = await chrome.tabs.query({ url: `${appUrl}*` });
  const existingTab = existingTabs.find((tab) => tab.id !== undefined);

  if (existingTab?.id !== undefined) {
    const updatedTab = await chrome.tabs.update(existingTab.id, { active: true });
    if (!updatedTab) {
      throw operationError({
        code: "UNKNOWN",
        message: "Chrome could not activate the existing Power View tab.",
        retryable: true,
      });
    }
    await chrome.windows.update(updatedTab.windowId, { focused: true });
    // Reusing the tab only refocuses it — the page itself keeps running whatever
    // build was loaded when it was first opened, and its in-memory app state
    // (detected board, ready schedule) stays pinned to that first open too.
    // Reload so it re-detects context on the current Jira page and picks up
    // any extension rebuild since it was last opened.
    await chrome.tabs.reload(existingTab.id);
    return existingTab.id;
  }

  const createdTab = await chrome.tabs.create({ active: true, url: appUrl });
  if (createdTab.id === undefined) {
    throw operationError({
      code: "UNKNOWN",
      message: "Chrome opened Power View without returning a tab identifier.",
      retryable: true,
    });
  }
  return createdTab.id;
}

async function requestHostPermission(
  originPattern: string,
  sender: MessageSenderContext,
): Promise<boolean> {
  requireTrustedExtensionSender(sender);
  const granted = await chrome.permissions.request({ origins: [originPattern] });
  if (granted) {
    await registerCustomJiraContentScript(originPattern);
  }
  return granted;
}

function diagnosticEndpoint(path: string): RequestDiagnostic["endpoint"] {
  if (path.endsWith("/myself")) {
    return "myself";
  }
  if (path.endsWith("/serverInfo")) {
    return "server-info";
  }
  if (path.endsWith("/project") || path.endsWith("/project/search")) {
    return "projects";
  }
  if (path.endsWith("/field")) {
    return "fields";
  }
  if (path.endsWith("/search") || path.endsWith("/search/jql")) {
    return "issues";
  }
  return "unknown";
}

async function requireActiveJiraContextWithPermission(
  options: { fresh?: boolean } = {},
): Promise<StoredJiraContext> {
  if (
    !options.fresh &&
    contextPermissionMemo &&
    contextPermissionMemo.expiresAt > Date.now()
  ) {
    return contextPermissionMemo.value;
  }

  const storedContext = await contextStore.getLatest();
  if (!storedContext) {
    throw operationError({
      code: "JIRA_NOT_DETECTED",
      message: "No active Jira instance is available for this request.",
      details:
        "Keep a Jira tab open, choose Detect again in the Power View popup, then retry this action.",
      retryable: true,
    });
  }

  let originPattern: string;
  try {
    originPattern = normalizeHostPermissionPattern(storedContext.context.baseUrl);
  } catch {
    throw operationError({
      code: "HOST_PERMISSION_MISSING",
      message: "The detected Jira URL cannot be granted host access.",
      retryable: false,
    });
  }

  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
  if (!hasPermission) {
    throw operationError({
      code: "HOST_PERMISSION_MISSING",
      message: "Power View does not have access to the detected Jira host.",
      details: "Return to the popup and grant access to this exact Jira site.",
      retryable: true,
    });
  }

  contextPermissionMemo = {
    value: storedContext,
    expiresAt: Date.now() + CONTEXT_PERMISSION_MEMO_TTL_MS,
  };
  return storedContext;
}

async function executeJiraContentBridge(
  requestId: string,
  request: JiraTransportRequest,
  storedContext: StoredJiraContext,
) {
  const startedAt = Date.now();
  bridgeRequestTabs.set(requestId, storedContext.tabId);

  try {
    let rawResponse: unknown;
    try {
      rawResponse = await chrome.tabs.sendMessage(storedContext.tabId, {
        type: "JIRA_REQUEST",
        requestId,
        payload: request,
      });
    } catch {
      throw new JiraRequestExecutionError(
        {
          code: "NETWORK_ERROR",
          message: "Power View could not reach Jira through its open tab.",
          details: "Reload the Jira tab, confirm that you are signed in, then retry.",
          retryable: true,
        },
        Date.now() - startedAt,
        0,
        "jira-page-bridge",
        "bridge-unavailable",
      );
    }

    const response = extensionResponseSchema.safeParse(rawResponse);
    if (!response.success || response.data.requestId !== requestId) {
      throw new JiraRequestExecutionError(
        {
          code: "INVALID_RESPONSE",
          message: "The Jira page bridge returned an invalid response.",
          retryable: true,
        },
        Date.now() - startedAt,
        0,
        "jira-page-bridge",
        "response",
      );
    }
    if (response.data.type === "ERROR") {
      throw new JiraRequestExecutionError(
        response.data.error,
        Date.now() - startedAt,
        0,
        "jira-page-bridge",
        "request",
      );
    }
    if (response.data.type !== "JIRA_RESPONSE") {
      throw new JiraRequestExecutionError(
        {
          code: "INVALID_RESPONSE",
          message: "The Jira page bridge returned an unexpected response type.",
          retryable: true,
        },
        Date.now() - startedAt,
        0,
        "jira-page-bridge",
        "response",
      );
    }

    return {
      status: response.data.status,
      data: response.data.data,
      durationMs: response.data.durationMs,
      retryCount: response.data.retryCount,
      transport: "jira-page-bridge" as const,
    };
  } finally {
    bridgeRequestTabs.delete(requestId);
  }
}

async function executeJiraMainWorldBridge(
  request: JiraTransportRequest,
  storedContext: StoredJiraContext,
) {
  const startedAt = Date.now();
  let url: URL;

  try {
    url = validatedJiraRequestUrl(request, storedContext.context.baseUrl, false);
  } catch {
    throw new JiraRequestExecutionError(
      {
        code: "PERMISSION_DENIED",
        message: "The Jira main-world bridge rejected an unsafe request.",
        retryable: false,
      },
      Date.now() - startedAt,
      0,
      "jira-main-world",
      "request",
    );
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(storedContext.tabId);
  } catch {
    throw new JiraRequestExecutionError(
      {
        code: "JIRA_NOT_DETECTED",
        message: "The Jira tab used for the connection test is no longer open.",
        details: "Open Jira, detect its context again, then retry.",
        retryable: true,
      },
      Date.now() - startedAt,
      0,
      "jira-main-world",
      "bridge-unavailable",
    );
  }

  try {
    if (
      !tab.url ||
      new URL(tab.url).origin !== new URL(storedContext.context.pageUrl).origin
    ) {
      throw new Error("Jira tab origin changed.");
    }
  } catch {
    throw new JiraRequestExecutionError(
      {
        code: "JIRA_NOT_DETECTED",
        message: "The detected Jira tab no longer matches the active Jira instance.",
        details: "Return to Jira, select Detect again, then retry.",
        retryable: true,
      },
      Date.now() - startedAt,
      0,
      "jira-main-world",
      "bridge-unavailable",
    );
  }

  let rawResult: unknown;
  try {
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: storedContext.tabId },
      world: "MAIN",
      injectImmediately: true,
      func: fetchJiraInMainWorld,
      args: [
        url.href,
        request.method,
        sanitizedJiraRequestHeaders(request),
        request.body === undefined ? null : JSON.stringify(request.body),
        30_000,
      ],
    });
    rawResult = injectionResults[0]?.result;
  } catch {
    throw new JiraRequestExecutionError(
      {
        code: "NETWORK_ERROR",
        message: "Power View could not run the compatibility request in Jira.",
        details: "Reload the Jira tab, detect it again, then retry.",
        retryable: true,
      },
      Date.now() - startedAt,
      0,
      "jira-main-world",
      "bridge-unavailable",
    );
  }

  const result = parseJiraMainWorldFetchResult(rawResult);
  if (!result) {
    throw new JiraRequestExecutionError(
      {
        code: "INVALID_RESPONSE",
        message: "The Jira compatibility bridge returned an invalid response.",
        retryable: true,
      },
      Date.now() - startedAt,
      0,
      "jira-main-world",
      "response",
    );
  }
  if (result.kind === "success") {
    return {
      status: result.status,
      data: result.data,
      durationMs: Date.now() - startedAt,
      retryCount: 0,
      transport: "jira-main-world" as const,
    };
  }
  if (result.kind === "http-error") {
    const retryable = result.status === 429 || result.status >= 500;
    throw new JiraRequestExecutionError(
      jiraStatusError(result.status, retryable, request.path),
      Date.now() - startedAt,
      0,
      "jira-main-world",
      "request",
    );
  }

  const appError =
    result.reason === "timeout"
      ? {
          code: "TIMEOUT" as const,
          message: "The Jira compatibility request timed out.",
          details: "Jira did not respond within the 30-second request window.",
          retryable: true,
        }
      : result.reason === "redirect"
        ? {
            code: "AUTH_REQUIRED" as const,
            message: "Jira redirected the REST request to sign-in.",
            details: "Open Jira, complete sign-in, then retry the connection test.",
            retryable: true,
          }
        : result.reason === "invalid-response"
          ? {
              code: "INVALID_RESPONSE" as const,
              message: "Jira returned malformed JSON.",
              details: "The endpoint response could not be validated.",
              retryable: true,
              ...(result.status === undefined ? {} : { httpStatus: result.status }),
            }
          : {
              code: "NETWORK_ERROR" as const,
              message: "The Jira page could not complete the compatibility request.",
              details: "Confirm that Jira is open and signed in, then retry.",
              retryable: true,
            };

  throw new JiraRequestExecutionError(
    appError,
    Date.now() - startedAt,
    0,
    "jira-main-world",
    "request",
  );
}

async function executeJiraPageBridge(
  requestId: string,
  request: JiraTransportRequest,
  storedContext: StoredJiraContext,
  options: { allowUncertainFallback: boolean },
) {
  try {
    return await executeJiraContentBridge(requestId, request, storedContext);
  } catch (error) {
    if (!(error instanceof JiraRequestExecutionError)) {
      throw error;
    }

    const bridgeUnavailable = error.failureStage === "bridge-unavailable";
    const fallbackEligible =
      bridgeUnavailable ||
      (options.allowUncertainFallback &&
        ["AUTH_REQUIRED", "NETWORK_ERROR", "TIMEOUT", "INVALID_RESPONSE"].includes(
          error.appError.code,
        ));

    if (!fallbackEligible) {
      throw error;
    }

    try {
      const mainWorldResult = await executeJiraMainWorldBridge(request, storedContext);
      return {
        ...mainWorldResult,
        durationMs: error.durationMs + mainWorldResult.durationMs,
        retryCount: error.retryCount + mainWorldResult.retryCount,
      };
    } catch (mainWorldError) {
      if (mainWorldError instanceof JiraRequestExecutionError) {
        throw new JiraRequestExecutionError(
          mainWorldError.appError,
          error.durationMs + mainWorldError.durationMs,
          error.retryCount + mainWorldError.retryCount,
          mainWorldError.transport,
          mainWorldError.failureStage,
        );
      }
      throw mainWorldError;
    }
  }
}

async function executeJiraRequest(
  requestId: string,
  request: JiraTransportRequest,
  sender: MessageSenderContext,
) {
  requireTrustedExtensionSender(sender);
  const startedAt = Date.now();

  try {
    let storedContext = await requireActiveJiraContextWithPermission();
    if (request.method !== "GET") {
      await refreshContext(storedContext.tabId);
      storedContext = await requireActiveJiraContextWithPermission({ fresh: true });
    }
    const result =
      request.method === "GET"
        ? await executeWithJiraPageFallback(
            () =>
              jiraRequestHandler.execute(
                requestId,
                request,
                storedContext.context.baseUrl,
              ),
            () =>
              executeJiraPageBridge(requestId, request, storedContext, {
                allowUncertainFallback: true,
              }),
          )
        : await executeJiraPageBridge(requestId, request, storedContext, {
            allowUncertainFallback: false,
          });

    await diagnosticsStore.recordRequest(
      {
        endpoint: diagnosticEndpoint(request.path),
        durationMs: result.durationMs,
        retryCount: result.retryCount,
        completedAt: new Date().toISOString(),
        transport: result.transport,
        httpStatus: result.status,
      },
      { connectionSucceeded: request.path.endsWith("/myself") },
    );
    return result;
  } catch (error) {
    if (error instanceof JiraRequestExecutionError) {
      await diagnosticsStore.recordRequest({
        endpoint: diagnosticEndpoint(request.path),
        durationMs: error.durationMs,
        retryCount: error.retryCount,
        completedAt: new Date().toISOString(),
        transport: error.transport,
        failureStage: error.failureStage,
        ...(error.appError.httpStatus === undefined
          ? {}
          : { httpStatus: error.appError.httpStatus }),
        errorCode: error.appError.code,
      });
    } else if (error instanceof ExtensionOperationError) {
      await diagnosticsStore.recordRequest({
        endpoint: diagnosticEndpoint(request.path),
        durationMs: Date.now() - startedAt,
        retryCount: 0,
        completedAt: new Date().toISOString(),
        transport: "service-worker",
        failureStage: "request",
        ...(error.appError.httpStatus === undefined
          ? {}
          : { httpStatus: error.appError.httpStatus }),
        errorCode: error.appError.code,
      });
    }
    throw error;
  }
}

async function cancelJiraRequest(
  requestId: string,
  sender: MessageSenderContext,
): Promise<void> {
  requireTrustedExtensionSender(sender);
  jiraRequestHandler.cancel(requestId);
  const tabId = bridgeRequestTabs.get(requestId);
  if (tabId !== undefined) {
    await chrome.tabs
      .sendMessage(tabId, {
        type: "JIRA_REQUEST_CANCEL",
        requestId: crypto.randomUUID(),
        targetRequestId: requestId,
      })
      .catch(() => undefined);
  }
}

function recordIssueLoad(
  loadedIssueCount: number,
  cacheStatus: "ready" | "error",
  sender: MessageSenderContext,
): Promise<void> {
  requireTrustedExtensionSender(sender);
  return diagnosticsStore.recordIssueLoad(loadedIssueCount, cacheStatus);
}

function browserVersion(): string {
  const match = /(?:Chrome|Chromium)\/([\d.]+)/.exec(navigator.userAgent);
  return match?.[1] ? `Chromium ${match[1]}` : "Chromium (version unavailable)";
}

async function getDiagnostics(
  sender: MessageSenderContext,
): Promise<DiagnosticsSnapshot> {
  requireTrustedExtensionSender(sender);
  const [storedContext, state] = await Promise.all([
    contextStore.getLatest(),
    diagnosticsStore.getState(),
  ]);
  let contextTabStatus: DiagnosticsSnapshot["contextTabStatus"] = "missing";
  let hostPermissionGranted = false;

  if (storedContext) {
    const originPattern = normalizeHostPermissionPattern(storedContext.context.baseUrl);
    hostPermissionGranted = await chrome.permissions.contains({
      origins: [originPattern],
    });
    try {
      const tab = await chrome.tabs.get(storedContext.tabId);
      const tabOrigin = tab.url ? new URL(tab.url).origin : undefined;
      contextTabStatus =
        tabOrigin === new URL(storedContext.context.baseUrl).origin
          ? "ready"
          : "origin-mismatch";
    } catch {
      contextTabStatus = "closed";
    }
  }

  return {
    extensionVersion: chrome.runtime.getManifest().version,
    browserVersion: browserVersion(),
    cacheStatus: state.cacheStatus ?? "not-configured",
    loadedIssueCount: state.loadedIssueCount ?? 0,
    contextTabStatus,
    hostPermissionGranted,
    ...(storedContext?.context.baseUrl
      ? { jiraBaseUrl: storedContext.context.baseUrl }
      : {}),
    ...(storedContext?.context.deploymentType
      ? { deploymentType: storedContext.context.deploymentType }
      : {}),
    ...state,
  };
}

export const platformOperations: MessageHandlerDependencies = {
  async getLatestContext() {
    return (await contextStore.getLatest())?.context;
  },
  refreshContext(tabId) {
    return refreshContext(tabId);
  },
  storeDetectedContext,
  openPowerView,
  requestHostPermission,
  executeJiraRequest,
  cancelJiraRequest,
  recordIssueLoad,
  getDiagnostics,
};

export function removeContextForTab(tabId: number): Promise<void> {
  return contextStore.removeForTab(tabId);
}
