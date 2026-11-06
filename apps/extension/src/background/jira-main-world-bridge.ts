export type JiraMainWorldFetchResult =
  | {
      kind: "success";
      status: number;
      data: unknown;
      durationMs: number;
    }
  | {
      kind: "http-error";
      rejectedFields?: string[];
      status: number;
      durationMs: number;
    }
  | {
      kind: "failure";
      reason: "network" | "timeout" | "invalid-response" | "redirect";
      durationMs: number;
      status?: number;
    };

export async function fetchJiraInMainWorld(
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  headers: Record<string, string>,
  body: string | null,
  timeoutMs: number,
): Promise<JiraMainWorldFetchResult> {
  // Chrome serializes this function into MAIN world, so the reader must be local.
  async function readBoundedJiraResponse(
    response: Response,
    limit = 20 * 1024 * 1024,
  ): Promise<string> {
    const declared = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel();
      throw new Error("Jira response exceeds the allowed size.");
    }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new Error("Jira response exceeds the allowed size.");
        }
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
      return parts.join("");
    } finally {
      reader.releaseLock();
    }
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        credentials: "include",
        redirect: "manual",
        headers,
        ...(body === null ? {} : { body }),
        signal: controller.signal,
      });
    } catch {
      return {
        kind: "failure",
        reason: controller.signal.reason === "timeout" ? "timeout" : "network",
        durationMs: Date.now() - startedAt,
      };
    }

    if (response.type === "opaqueredirect" || response.status === 0) {
      return {
        kind: "failure",
        reason: "redirect",
        durationMs: Date.now() - startedAt,
      };
    }
    if (!response.ok) {
      // Keep only known validation field names, never raw error bodies, cookies,
      // echoed input, or server-provided messages in diagnostics.
      let rejectedFields: string[] = [];
      if (
        response.status === 400 &&
        /\/rest\/api\/3\/issue\/[^/]+\/worklog(?:\/\d+)?$/.test(new URL(url).pathname)
      ) {
        try {
          const data: unknown = JSON.parse(
            await readBoundedJiraResponse(response, 64 * 1024),
          );
          if (
            data &&
            typeof data === "object" &&
            "errors" in data &&
            data.errors &&
            typeof data.errors === "object"
          )
            rejectedFields = Object.keys(data.errors).filter((key) =>
              ["started", "timeSpent", "timeSpentSeconds", "comment"].includes(key),
            );
        } catch {
          /* Retain the known HTTP status even if the error body is invalid. */
        }
      }
      return {
        kind: "http-error",
        ...(rejectedFields.length ? { rejectedFields } : {}),
        status: response.status,
        durationMs: Date.now() - startedAt,
      };
    }

    try {
      const responseText = await readBoundedJiraResponse(response);
      return {
        kind: "success",
        status: response.status,
        data: responseText.trim() ? JSON.parse(responseText) : null,
        durationMs: Date.now() - startedAt,
      };
    } catch {
      return {
        kind: "failure",
        reason: "invalid-response",
        durationMs: Date.now() - startedAt,
        status: response.status,
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isStatus(value: unknown): value is number {
  return isDuration(value) && value <= 599;
}

export function parseJiraMainWorldFetchResult(
  value: unknown,
): JiraMainWorldFetchResult | undefined {
  if (!isRecord(value) || !isDuration(value.durationMs)) {
    return undefined;
  }
  if (
    value.kind === "success" &&
    isStatus(value.status) &&
    "data" in value &&
    hasOnlyKeys(value, ["kind", "status", "data", "durationMs"])
  ) {
    return {
      kind: "success",
      status: value.status,
      data: value.data,
      durationMs: value.durationMs,
    };
  }
  if (
    value.kind === "http-error" &&
    isStatus(value.status) &&
    (value.rejectedFields === undefined ||
      (Array.isArray(value.rejectedFields) &&
        value.rejectedFields.length <= 4 &&
        value.rejectedFields.every(
          (field) =>
            typeof field === "string" &&
            ["started", "timeSpent", "timeSpentSeconds", "comment"].includes(field),
        ))) &&
    hasOnlyKeys(value, ["kind", "status", "durationMs", "rejectedFields"])
  ) {
    return {
      kind: "http-error",
      ...(value.rejectedFields === undefined
        ? {}
        : { rejectedFields: value.rejectedFields as string[] }),
      status: value.status,
      durationMs: value.durationMs,
    };
  }
  if (
    value.kind === "failure" &&
    ["network", "timeout", "invalid-response", "redirect"].includes(
      String(value.reason),
    ) &&
    (value.status === undefined || isStatus(value.status)) &&
    hasOnlyKeys(value, ["kind", "reason", "durationMs", "status"])
  ) {
    return {
      kind: "failure",
      reason: value.reason as Extract<
        JiraMainWorldFetchResult,
        { kind: "failure" }
      >["reason"],
      durationMs: value.durationMs,
      ...(value.status === undefined ? {} : { status: value.status }),
    };
  }
  return undefined;
}
