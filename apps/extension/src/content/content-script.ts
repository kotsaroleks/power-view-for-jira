import {
  createRequestId,
  extensionRequestSchema,
  extensionResponseSchema,
  type ExtensionResponse,
} from "@power-view/extension-messaging";

import { detectJiraContext, type JiraPageSnapshot } from "./context-detector";
import {
  JiraPageRequestError,
  JiraPageRequestHandler,
} from "./jira-page-request-handler";

const METADATA_NAMES = [
  "ajs-base-url",
  "ajs-project-key",
  "ajs-project-id",
  "ajs-issue-key",
  "ajs-deployment-type",
  "ajs-version-number",
] as const;

interface ContentScriptState {
  lastPageUrl: string;
  intervalId: number;
}

interface PowerViewContentScope {
  __powerViewContentScriptState?: ContentScriptState;
}

const contentScope = globalThis as typeof globalThis & PowerViewContentScope;

function readSnapshot(): JiraPageSnapshot {
  const metadata: Record<string, string | undefined> = {};

  for (const name of METADATA_NAMES) {
    const content = document.querySelector<HTMLMetaElement>(
      `meta[name="${name}"]`,
    )?.content;
    if (content) {
      metadata[name] = content;
    }
  }

  return { pageUrl: location.href, metadata };
}

function contextError(requestId?: string): ExtensionResponse {
  return {
    type: "ERROR",
    ...(requestId ? { requestId } : {}),
    ok: false,
    error: {
      code: "JIRA_NOT_DETECTED",
      message: "Power View could not detect Jira context on this page.",
      details: "Open a Jira project, board, search, or issue page and try again.",
      retryable: true,
      ...(requestId ? { correlationId: requestId } : {}),
    },
  };
}

function detectResponse(requestId: string): ExtensionResponse {
  const context = detectJiraContext(readSnapshot());
  return context
    ? { type: "CONTEXT_RESULT", requestId, ok: true, context }
    : contextError(requestId);
}

async function publishContext(): Promise<void> {
  const context = detectJiraContext(readSnapshot());
  if (!context) {
    return;
  }

  const requestId = createRequestId();
  const rawResponse: unknown = await chrome.runtime.sendMessage({
    type: "CONTEXT_UPDATE",
    requestId,
    context,
  });
  const response = extensionResponseSchema.safeParse(rawResponse);

  if (!response.success || response.data.type === "ERROR") {
    console.warn("Power View could not store the detected Jira context.");
  }
}

function publishContextSafely(): void {
  void publishContext().catch(() => {
    console.warn("Power View context detection could not reach the extension.");
  });
}

if (!contentScope.__powerViewContentScriptState) {
  const jiraPageRequestHandler = new JiraPageRequestHandler();
  const state: ContentScriptState = {
    lastPageUrl: location.href,
    intervalId: window.setInterval(() => {
      if (state.lastPageUrl !== location.href) {
        state.lastPageUrl = location.href;
        publishContextSafely();
      }
    }, 1000),
  };

  contentScope.__powerViewContentScriptState = state;
  publishContextSafely();

  window.addEventListener("popstate", publishContextSafely);
  window.addEventListener("hashchange", publishContextSafely);
  window.addEventListener(
    "pagehide",
    () => {
      window.clearInterval(state.intervalId);
    },
    { once: true },
  );

  chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
    const parsedMessage = extensionRequestSchema.safeParse(rawMessage);

    if (!parsedMessage.success) {
      sendResponse(contextError());
      return false;
    }

    if (
      parsedMessage.data.type === "CONTEXT_GET" ||
      parsedMessage.data.type === "CONTEXT_REFRESH"
    ) {
      sendResponse(detectResponse(parsedMessage.data.requestId));
      return false;
    }

    if (parsedMessage.data.type === "JIRA_REQUEST_CANCEL") {
      jiraPageRequestHandler.cancel(parsedMessage.data.targetRequestId);
      sendResponse({
        type: "ACK",
        requestId: parsedMessage.data.requestId,
        ok: true,
      } satisfies ExtensionResponse);
      return false;
    }

    if (parsedMessage.data.type === "JIRA_REQUEST") {
      const request = parsedMessage.data;
      const context = detectJiraContext(readSnapshot());

      if (!context) {
        sendResponse(contextError(request.requestId));
        return false;
      }

      void jiraPageRequestHandler
        .execute(request.requestId, request.payload, context.baseUrl)
        .then(
          (result) => {
            sendResponse({
              type: "JIRA_RESPONSE",
              requestId: request.requestId,
              ok: true,
              ...result,
            } satisfies ExtensionResponse);
          },
          (error: unknown) => {
            const appError =
              error instanceof JiraPageRequestError
                ? error.appError
                : {
                    code: "UNKNOWN" as const,
                    message: "The Jira page bridge could not complete the request.",
                    retryable: true,
                  };
            sendResponse({
              type: "ERROR",
              requestId: request.requestId,
              ok: false,
              error: { ...appError, correlationId: request.requestId },
            } satisfies ExtensionResponse);
          },
        );
      return true;
    }

    return false;
  });
}
