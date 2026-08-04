import type { SerializableAppError } from "@power-view/domain";
import type { JiraTransportRequest } from "@power-view/extension-messaging";

import {
  sanitizedJiraRequestHeaders,
  validatedJiraRequestUrl,
} from "../jira-request-policy";
import { jiraStatusError } from "../jira-response-policy";

const DEFAULT_TIMEOUT_MS = 30_000;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface JiraPageRequestResult {
  status: number;
  data: unknown;
  durationMs: number;
  retryCount: 0;
}

export class JiraPageRequestError extends Error {
  constructor(
    readonly appError: SerializableAppError,
    readonly durationMs: number,
  ) {
    super(appError.message);
    this.name = "JiraPageRequestError";
  }
}

export interface JiraPageRequestHandlerOptions {
  fetch?: FetchImplementation;
  now?: () => number;
  timeoutMs?: number;
  allowLocalhost?: boolean;
}

export class JiraPageRequestHandler {
  private readonly fetchImplementation: FetchImplementation;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly allowLocalhost: boolean;
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(options: JiraPageRequestHandlerOptions = {}) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.allowLocalhost = options.allowLocalhost ?? import.meta.env.DEV;
  }

  async execute(
    requestId: string,
    request: JiraTransportRequest,
    activeBaseUrl: string,
  ): Promise<JiraPageRequestResult> {
    const startedAt = this.now();
    let url: URL;

    try {
      url = validatedJiraRequestUrl(request, activeBaseUrl, this.allowLocalhost);
    } catch {
      throw new JiraPageRequestError(
        {
          code: "PERMISSION_DENIED",
          message: "The Jira page bridge rejected an unsafe request.",
          retryable: false,
        },
        this.now() - startedAt,
      );
    }

    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);
    const timeout = setTimeout(() => controller.abort("timeout"), this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImplementation(url, {
          method: request.method,
          credentials: "include",
          redirect: "manual",
          headers: sanitizedJiraRequestHeaders(request),
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          signal: controller.signal,
        });
      } catch {
        const timedOut = controller.signal.reason === "timeout";
        throw new JiraPageRequestError(
          {
            code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
            message: timedOut
              ? "The Jira page request timed out."
              : "The Jira page could not complete the REST request.",
            details: timedOut
              ? "Jira did not respond within the 30-second request window."
              : "Reload Jira, confirm that you are signed in, then retry.",
            retryable: true,
          },
          this.now() - startedAt,
        );
      }

      if (!response.ok) {
        const isRetryableStatus = response.status === 429 || response.status >= 500;
        throw new JiraPageRequestError(
          jiraStatusError(response.status, isRetryableStatus, request.path),
          this.now() - startedAt,
        );
      }

      let data: unknown;
      try {
        const responseText = await response.text();
        data = responseText.trim() ? JSON.parse(responseText) : null;
      } catch {
        throw new JiraPageRequestError(
          {
            code: "INVALID_RESPONSE",
            message: "Jira returned malformed JSON.",
            details: "The endpoint response could not be validated.",
            retryable: true,
            httpStatus: response.status,
          },
          this.now() - startedAt,
        );
      }

      return {
        status: response.status,
        data,
        durationMs: this.now() - startedAt,
        retryCount: 0,
      };
    } finally {
      clearTimeout(timeout);
      this.activeRequests.delete(requestId);
    }
  }

  cancel(requestId: string): boolean {
    const request = this.activeRequests.get(requestId);
    request?.abort("cancelled");
    return request !== undefined;
  }
}
