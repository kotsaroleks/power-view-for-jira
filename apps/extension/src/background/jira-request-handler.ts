import type { JiraTransportRequest } from "@power-view/extension-messaging";

import {
  sanitizedJiraRequestHeaders,
  validatedJiraRequestUrl,
} from "../jira-request-policy";
import { jiraStatusError } from "../jira-response-policy";
import { ExtensionOperationError } from "./message-handler";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 4;
const DEFAULT_MAX_AUTOMATIC_RETRY_DELAY_MS = 10_000;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface JiraRequestResult {
  status: number;
  data: unknown;
  durationMs: number;
  retryCount: number;
  transport: "service-worker" | "jira-page-bridge" | "jira-main-world";
}

export interface JiraRequestHandlerOptions {
  fetch?: FetchImplementation;
  now?: () => number;
  random?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
  maxConcurrentRequests?: number;
  maxAutomaticRetryDelayMs?: number;
  allowLocalhost?: boolean;
}

export class JiraRequestExecutionError extends ExtensionOperationError {
  constructor(
    appError: ConstructorParameters<typeof ExtensionOperationError>[0],
    readonly durationMs: number,
    readonly retryCount: number,
    readonly transport: JiraRequestResult["transport"] = "service-worker",
    readonly failureStage: "request" | "bridge-unavailable" | "response" = "request",
  ) {
    super(appError);
    this.name = "JiraRequestExecutionError";
  }
}

function retryAfterMs(value: string | null, now: number): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The Jira request was aborted.", "AbortError");
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }

    const abort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}

class RequestSemaphore {
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maximum: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) {
      throw signal.reason;
    }

    if (this.activeCount < this.maximum) {
      this.activeCount += 1;
      return () => this.release();
    }

    await new Promise<void>((resolve, reject) => {
      const enter = () => {
        signal.removeEventListener("abort", abort);
        this.activeCount += 1;
        resolve();
      };
      const abort = () => {
        const index = this.queue.indexOf(enter);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
        reject(abortError(signal));
      };

      this.queue.push(enter);
      signal.addEventListener("abort", abort, { once: true });
    });

    return () => this.release();
  }

  private release(): void {
    this.activeCount -= 1;
    this.queue.shift()?.();
  }
}

export class JiraRequestHandler {
  private readonly fetchImplementation: FetchImplementation;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxAutomaticRetryDelayMs: number;
  private readonly allowLocalhost: boolean;
  private readonly semaphore: RequestSemaphore;
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(options: JiraRequestHandlerOptions = {}) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxAutomaticRetryDelayMs =
      options.maxAutomaticRetryDelayMs ?? DEFAULT_MAX_AUTOMATIC_RETRY_DELAY_MS;
    this.allowLocalhost = options.allowLocalhost ?? import.meta.env.DEV;
    this.semaphore = new RequestSemaphore(
      options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS,
    );
  }

  async execute(
    requestId: string,
    request: JiraTransportRequest,
    activeBaseUrl: string,
  ): Promise<JiraRequestResult> {
    const startedAt = this.now();
    let retryCount = 0;

    let url: URL;
    try {
      url = validatedJiraRequestUrl(request, activeBaseUrl, this.allowLocalhost);
    } catch {
      throw new JiraRequestExecutionError(
        {
          code: "PERMISSION_DENIED",
          message: "The Jira request used an unsafe base URL.",
          retryable: false,
        },
        this.now() - startedAt,
        retryCount,
      );
    }

    const controller = new AbortController();
    this.activeRequests.set(requestId, controller);
    let release: () => void = () => undefined;

    try {
      release = await this.semaphore.acquire(controller.signal);
      const timeout = setTimeout(() => controller.abort("timeout"), this.timeoutMs);

      try {
        while (true) {
          let response: Response;
          try {
            response = await this.fetchImplementation(url, {
              method: request.method,
              credentials: "include",
              redirect: "manual",
              headers: sanitizedJiraRequestHeaders(request),
              ...(request.body === undefined
                ? {}
                : { body: JSON.stringify(request.body) }),
              signal: controller.signal,
            });
          } catch {
            if (controller.signal.aborted) {
              const timedOut = controller.signal.reason === "timeout";
              throw new JiraRequestExecutionError(
                {
                  code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
                  message: timedOut
                    ? "The Jira request timed out."
                    : "The Jira request was cancelled.",
                  details: timedOut
                    ? "Jira did not respond within the 30-second request window."
                    : "Retry the connection test if it is still needed.",
                  retryable: true,
                },
                this.now() - startedAt,
                retryCount,
              );
            }
            throw new JiraRequestExecutionError(
              {
                code: "NETWORK_ERROR",
                message: "Power View could not reach Jira.",
                details:
                  "Check the Jira URL, browser network connection, and host access.",
                retryable: true,
              },
              this.now() - startedAt,
              retryCount,
            );
          }

          if (response.ok) {
            let data: unknown;
            try {
              const responseText = await response.text();
              data = responseText.trim() ? JSON.parse(responseText) : null;
            } catch {
              if (controller.signal.reason === "timeout") {
                throw new JiraRequestExecutionError(
                  {
                    code: "TIMEOUT",
                    message: "The Jira request timed out.",
                    details: "Jira did not respond within the 30-second request window.",
                    retryable: true,
                  },
                  this.now() - startedAt,
                  retryCount,
                );
              }
              throw new JiraRequestExecutionError(
                {
                  code: "INVALID_RESPONSE",
                  message: "Jira returned malformed JSON.",
                  details: "The endpoint response could not be validated.",
                  retryable: true,
                  httpStatus: response.status,
                },
                this.now() - startedAt,
                retryCount,
              );
            }

            return {
              status: response.status,
              data,
              durationMs: this.now() - startedAt,
              retryCount,
              transport: "service-worker",
            };
          }

          const isRetryableStatus = response.status === 429 || response.status >= 500;
          if (isRetryableStatus && retryCount < this.maxRetries) {
            const headerDelay = retryAfterMs(
              response.headers.get("Retry-After"),
              this.now(),
            );
            const exponentialDelay = 500 * 2 ** retryCount;
            const jitteredDelay = Math.round(
              exponentialDelay * (0.8 + this.random() * 0.4),
            );
            const delay = headerDelay ?? jitteredDelay;

            if (request.method === "GET" && delay <= this.maxAutomaticRetryDelayMs) {
              retryCount += 1;
              await wait(delay, controller.signal);
              continue;
            }
          }

          const mapped = jiraStatusError(
            response.status,
            isRetryableStatus,
            request.path,
          );
          throw new JiraRequestExecutionError(mapped, this.now() - startedAt, retryCount);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (error instanceof JiraRequestExecutionError) {
        throw error;
      }
      const timedOut = controller.signal.reason === "timeout";
      throw new JiraRequestExecutionError(
        {
          code: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
          message: timedOut
            ? "The Jira request timed out."
            : "The Jira request was cancelled.",
          retryable: true,
        },
        this.now() - startedAt,
        retryCount,
      );
    } finally {
      release();
      this.activeRequests.delete(requestId);
    }
  }

  cancel(requestId: string): boolean {
    const request = this.activeRequests.get(requestId);
    request?.abort("cancelled");
    return request !== undefined;
  }
}
