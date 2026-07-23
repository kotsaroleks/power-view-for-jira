import type { SerializableAppError } from "@power-view/domain";
import {
  createJiraRequest,
  createJiraRequestCancellation,
  createRequestId,
  sendExtensionRequest,
  type ExtensionRuntime,
  type JiraTransportRequest,
} from "@power-view/extension-messaging";
import type { z } from "zod";

import { JiraClientError } from "./errors";
import type { JiraTransport } from "./JiraTransport";

export interface RuntimeJiraTransportOptions {
  runtime: ExtensionRuntime;
}

function cancelledError(): DOMException {
  return new DOMException("The Jira request was cancelled.", "AbortError");
}

export class RuntimeJiraTransport implements JiraTransport {
  private readonly runtime: ExtensionRuntime;

  constructor(options: RuntimeJiraTransportOptions) {
    this.runtime = options.runtime;
  }

  async request<TResponse>(
    request: JiraTransportRequest,
    schema: z.ZodType<TResponse>,
    signal?: AbortSignal,
  ): Promise<TResponse> {
    if (signal?.aborted) {
      throw cancelledError();
    }

    const requestId = createRequestId();
    let removeAbortListener: () => void = () => undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      if (!signal) {
        return;
      }

      const handleAbort = () => {
        void sendExtensionRequest(
          this.runtime,
          createJiraRequestCancellation(requestId),
        ).then(
          (response) => {
            if (response.type === "ERROR") {
              console.warn("Power View could not confirm Jira request cancellation.");
            }
          },
          () => {
            console.warn("Power View could not send Jira request cancellation.");
          },
        );
        reject(cancelledError());
      };

      signal.addEventListener("abort", handleAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener("abort", handleAbort);
    });

    try {
      const response = await Promise.race([
        sendExtensionRequest(this.runtime, createJiraRequest(request, requestId)),
        cancellation,
      ]);

      if (response.type === "ERROR") {
        throw new JiraClientError(response.error);
      }
      if (response.type !== "JIRA_RESPONSE") {
        throw new JiraClientError({
          code: "INVALID_RESPONSE",
          message: "The extension returned an unexpected Jira response.",
          retryable: true,
          correlationId: requestId,
        });
      }

      const parsedResponse = schema.safeParse(response.data);
      if (!parsedResponse.success) {
        const appError: SerializableAppError = {
          code: "INVALID_RESPONSE",
          message: "Jira returned data in an unsupported format.",
          details: "The response did not match the expected endpoint schema.",
          retryable: true,
          correlationId: requestId,
        };
        throw new JiraClientError(appError);
      }

      return parsedResponse.data;
    } finally {
      removeAbortListener();
    }
  }
}
