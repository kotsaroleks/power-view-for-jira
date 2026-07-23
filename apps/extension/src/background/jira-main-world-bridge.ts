export type JiraMainWorldFetchResult =
  | {
      kind: "success";
      status: number;
      data: unknown;
      durationMs: number;
    }
  | {
      kind: "http-error";
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
      return {
        kind: "http-error",
        status: response.status,
        durationMs: Date.now() - startedAt,
      };
    }

    try {
      const responseText = await response.text();
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
    hasOnlyKeys(value, ["kind", "status", "durationMs"])
  ) {
    return {
      kind: "http-error",
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
