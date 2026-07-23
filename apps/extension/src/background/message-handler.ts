import type {
  DiagnosticsSnapshot,
  JiraPageContext,
  SerializableAppError,
} from "@power-view/domain";
import {
  extensionRequestSchema,
  type ExtensionResponse,
  type JiraTransportRequest,
} from "@power-view/extension-messaging";

export interface MessageSenderContext {
  tabId?: number;
  url?: string;
}

export interface MessageHandlerDependencies {
  getLatestContext: () => Promise<JiraPageContext | undefined>;
  refreshContext: (
    tabId: number | undefined,
    sender: MessageSenderContext,
  ) => Promise<JiraPageContext>;
  storeDetectedContext: (
    context: JiraPageContext,
    sender: MessageSenderContext,
  ) => Promise<void>;
  openPowerView: (
    context: JiraPageContext | undefined,
    sender: MessageSenderContext,
  ) => Promise<number>;
  requestHostPermission: (
    originPattern: string,
    sender: MessageSenderContext,
  ) => Promise<boolean>;
  executeJiraRequest: (
    requestId: string,
    request: JiraTransportRequest,
    sender: MessageSenderContext,
  ) => Promise<{
    status: number;
    data: unknown;
    durationMs: number;
    retryCount: number;
  }>;
  cancelJiraRequest: (
    targetRequestId: string,
    sender: MessageSenderContext,
  ) => Promise<void>;
  recordIssueLoad: (
    loadedIssueCount: number,
    cacheStatus: "ready" | "error",
    sender: MessageSenderContext,
  ) => Promise<void>;
  getDiagnostics: (sender: MessageSenderContext) => Promise<DiagnosticsSnapshot>;
}

export class ExtensionOperationError extends Error {
  constructor(readonly appError: SerializableAppError) {
    super(appError.message);
    this.name = "ExtensionOperationError";
  }
}

function errorResponse(
  error: SerializableAppError,
  requestId?: string,
): ExtensionResponse {
  return {
    type: "ERROR",
    ...(requestId ? { requestId } : {}),
    ok: false,
    error: {
      ...error,
      ...(requestId ? { correlationId: requestId } : {}),
    },
  };
}

export function createExtensionMessageHandler(dependencies: MessageHandlerDependencies) {
  return async (
    rawMessage: unknown,
    sender: MessageSenderContext,
  ): Promise<ExtensionResponse> => {
    const parsedMessage = extensionRequestSchema.safeParse(rawMessage);

    if (!parsedMessage.success) {
      return errorResponse({
        code: "INVALID_RESPONSE",
        message: "The extension rejected a malformed message.",
        details: "The message type or payload did not match the allowed schema.",
        retryable: false,
      });
    }

    const message = parsedMessage.data;

    try {
      switch (message.type) {
        case "CONTEXT_GET": {
          const context = await dependencies.getLatestContext();
          if (!context) {
            throw new ExtensionOperationError({
              code: "JIRA_NOT_DETECTED",
              message: "No Jira context is available yet.",
              details: "Open a Jira page, then use the Power View extension action.",
              retryable: true,
            });
          }
          return {
            type: "CONTEXT_RESULT",
            requestId: message.requestId,
            ok: true,
            context,
          };
        }
        case "CONTEXT_REFRESH": {
          const context = await dependencies.refreshContext(message.tabId, sender);
          return {
            type: "CONTEXT_RESULT",
            requestId: message.requestId,
            ok: true,
            context,
          };
        }
        case "CONTEXT_UPDATE": {
          await dependencies.storeDetectedContext(message.context, sender);
          return { type: "ACK", requestId: message.requestId, ok: true };
        }
        case "POWER_VIEW_OPEN": {
          const tabId = await dependencies.openPowerView(message.context, sender);
          return {
            type: "POWER_VIEW_OPENED",
            requestId: message.requestId,
            ok: true,
            tabId,
          };
        }
        case "HOST_PERMISSION_REQUEST": {
          const granted = await dependencies.requestHostPermission(
            message.originPattern,
            sender,
          );
          return {
            type: "HOST_PERMISSION_RESULT",
            requestId: message.requestId,
            ok: true,
            granted,
            originPattern: message.originPattern,
          };
        }
        case "JIRA_REQUEST": {
          const result = await dependencies.executeJiraRequest(
            message.requestId,
            message.payload,
            sender,
          );
          return {
            type: "JIRA_RESPONSE",
            requestId: message.requestId,
            ok: true,
            status: result.status,
            data: result.data,
            durationMs: result.durationMs,
            retryCount: result.retryCount,
          };
        }
        case "JIRA_REQUEST_CANCEL": {
          await dependencies.cancelJiraRequest(message.targetRequestId, sender);
          return { type: "ACK", requestId: message.requestId, ok: true };
        }
        case "ISSUE_LOAD_REPORT": {
          await dependencies.recordIssueLoad(
            message.loadedIssueCount,
            message.cacheStatus,
            sender,
          );
          return { type: "ACK", requestId: message.requestId, ok: true };
        }
        case "DIAGNOSTICS_GET": {
          const diagnostics = await dependencies.getDiagnostics(sender);
          return {
            type: "DIAGNOSTICS_RESULT",
            requestId: message.requestId,
            ok: true,
            diagnostics,
          };
        }
      }
    } catch (error) {
      if (error instanceof ExtensionOperationError) {
        return errorResponse(error.appError, message.requestId);
      }

      return errorResponse(
        {
          code: "UNKNOWN",
          message: "Power View could not complete the extension operation.",
          details: "Retry the action. Open Diagnostics if the problem continues.",
          retryable: true,
        },
        message.requestId,
      );
    }
  };
}
