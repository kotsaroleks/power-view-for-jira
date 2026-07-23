import { describe, expect, it, vi } from "vitest";

import { JiraRequestHandler } from "./jira-request-handler";

const baseRequest = {
  baseUrl: "https://example.atlassian.net",
  method: "GET" as const,
  path: "/rest/api/3/myself",
};

function jsonResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("JiraRequestHandler", () => {
  it("uses the browser session and strips unsafe request headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ displayName: "Alex" }));
    const handler = new JiraRequestHandler({ fetch: fetchMock, allowLocalhost: false });

    const result = await handler.execute(
      "request-1",
      {
        ...baseRequest,
        headers: {
          Accept: "application/json",
          Authorization: "Bearer must-not-pass",
          Cookie: "must-not-pass",
        },
      },
      baseRequest.baseUrl,
    );

    expect(result).toMatchObject({ status: 200, data: { displayName: "Alex" } });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://example.atlassian.net/rest/api/3/myself"),
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        redirect: "manual",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it.each([
    ["AUTH_REQUIRED", 401],
    ["PERMISSION_DENIED", 403],
    ["UNSUPPORTED_DEPLOYMENT", 404],
  ] as const)("maps %s separately from HTTP %i", async (code, status) => {
    const handler = new JiraRequestHandler({
      fetch: vi.fn().mockResolvedValue(jsonResponse({}, status)),
      allowLocalhost: false,
    });

    await expect(
      handler.execute("request-2", baseRequest, baseRequest.baseUrl),
    ).rejects.toMatchObject({
      appError: { code, httpStatus: status },
    });
  });

  it("rejects cross-instance and non-allowlisted requests before fetch", async () => {
    const fetchMock = vi.fn();
    const handler = new JiraRequestHandler({ fetch: fetchMock, allowLocalhost: false });

    await expect(
      handler.execute("request-3", baseRequest, "https://other.atlassian.net"),
    ).rejects.toMatchObject({ appError: { code: "PERMISSION_DENIED" } });
    await expect(
      handler.execute(
        "request-4",
        { ...baseRequest, path: "/rest/api/3/search" },
        baseRequest.baseUrl,
      ),
    ).rejects.toMatchObject({ appError: { code: "PERMISSION_DENIED" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows only the documented project-search query parameters", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ values: [], startAt: 0, maxResults: 25, total: 0 }),
      );
    const handler = new JiraRequestHandler({ fetch: fetchMock, allowLocalhost: false });

    await handler.execute(
      "request-projects",
      {
        ...baseRequest,
        path: "/rest/api/3/project/search",
        query: { query: "power", startAt: 0, maxResults: 25, orderBy: "name" },
      },
      baseRequest.baseUrl,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "https://example.atlassian.net/rest/api/3/project/search?query=power&startAt=0&maxResults=25&orderBy=name",
      ),
      expect.any(Object),
    );

    await expect(
      handler.execute(
        "request-projects-invalid",
        {
          ...baseRequest,
          path: "/rest/api/3/project/search",
          query: { expand: "description" },
        },
        baseRequest.baseUrl,
      ),
    ).rejects.toMatchObject({ appError: { code: "PERMISSION_DENIED" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows issue-search pagination parameters and maps invalid JQL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 400));
    const handler = new JiraRequestHandler({ fetch: fetchMock, allowLocalhost: false });

    await expect(
      handler.execute(
        "request-issues",
        {
          ...baseRequest,
          path: "/rest/api/3/search/jql",
          query: {
            jql: 'project = "POWER"',
            maxResults: 100,
            nextPageToken: "next-token",
            fields: "summary,status",
            fieldsByKeys: false,
            failFast: true,
          },
        },
        baseRequest.baseUrl,
      ),
    ).rejects.toMatchObject({
      appError: { code: "INVALID_JQL", httpStatus: 400 },
    });

    await expect(
      handler.execute(
        "request-issues-invalid",
        {
          ...baseRequest,
          path: "/rest/api/3/search/jql",
          query: { jql: "project = POWER", expand: "changelog" },
        },
        baseRequest.baseUrl,
      ),
    ).rejects.toMatchObject({ appError: { code: "PERMISSION_DENIED" } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("respects Retry-After and retries a 429 response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(jsonResponse({ displayName: "Alex" }));
    const handler = new JiraRequestHandler({
      fetch: fetchMock,
      allowLocalhost: false,
      random: () => 0.5,
    });

    const result = await handler.execute("request-5", baseRequest, baseRequest.baseUrl);

    expect(result.retryCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts an active Jira request", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const handler = new JiraRequestHandler({ fetch: fetchMock, allowLocalhost: false });
    const request = handler.execute("request-6", baseRequest, baseRequest.baseUrl);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(handler.cancel("request-6")).toBe(true);

    await expect(request).rejects.toMatchObject({
      appError: { code: "NETWORK_ERROR", message: "The Jira request was cancelled." },
    });
  });

  it("maps the request deadline to a typed timeout", async () => {
    const handler = new JiraRequestHandler({
      fetch: vi.fn().mockImplementation(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          }),
      ),
      allowLocalhost: false,
      timeoutMs: 1,
    });

    await expect(
      handler.execute("request-timeout", baseRequest, baseRequest.baseUrl),
    ).rejects.toMatchObject({ appError: { code: "TIMEOUT", retryable: true } });
  });

  it("never runs more than four Jira requests concurrently", async () => {
    const completions: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const handler = new JiraRequestHandler({
      fetch: vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            completions.push(() => {
              active -= 1;
              resolve(jsonResponse({ displayName: "Alex" }));
            });
          }),
      ),
      allowLocalhost: false,
    });

    const requests = Array.from({ length: 5 }, (_, index) =>
      handler.execute(`concurrent-${index}`, baseRequest, baseRequest.baseUrl),
    );
    await vi.waitFor(() => expect(completions).toHaveLength(4));
    completions.shift()?.();
    await vi.waitFor(() => expect(completions).toHaveLength(4));
    completions.splice(0).forEach((complete) => complete());

    await expect(Promise.all(requests)).resolves.toHaveLength(5);
    expect(maximumActive).toBe(4);
  });

  it("rejects successful responses containing malformed JSON", async () => {
    const handler = new JiraRequestHandler({
      fetch: vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
      allowLocalhost: false,
    });

    await expect(
      handler.execute("request-7", baseRequest, baseRequest.baseUrl),
    ).rejects.toMatchObject({ appError: { code: "INVALID_RESPONSE" } });
  });

  it("sends approved mutation JSON and accepts an empty Jira response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const handler = new JiraRequestHandler({ fetch: fetchMock, allowLocalhost: false });

    await expect(
      handler.execute(
        "request-write",
        {
          ...baseRequest,
          method: "PUT",
          path: "/rest/api/3/issue/POWER-42/assignee",
          body: { accountId: "account-1" },
        },
        baseRequest.baseUrl,
      ),
    ).resolves.toMatchObject({ status: 204, data: null, retryCount: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://example.atlassian.net/rest/api/3/issue/POWER-42/assignee"),
      expect.objectContaining({
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accountId: "account-1" }),
      }),
    );
  });

  it("does not automatically retry a mutation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const handler = new JiraRequestHandler({ fetch: fetchMock, allowLocalhost: false });

    await expect(
      handler.execute(
        "request-write-failure",
        {
          ...baseRequest,
          method: "DELETE",
          path: "/rest/api/3/issueLink/10001",
        },
        baseRequest.baseUrl,
      ),
    ).rejects.toMatchObject({ appError: { code: "NETWORK_ERROR" } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
