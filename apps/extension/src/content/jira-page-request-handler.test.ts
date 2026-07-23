import { describe, expect, it, vi } from "vitest";

import {
  JiraPageRequestError,
  JiraPageRequestHandler,
} from "./jira-page-request-handler";

const request = {
  baseUrl: "https://example.atlassian.net",
  method: "GET" as const,
  path: "/rest/api/3/myself",
  headers: {
    Accept: "application/json",
    Authorization: "Bearer must-not-pass",
  },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("JiraPageRequestHandler", () => {
  it("uses a same-instance browser session request and strips unsafe headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ displayName: "Alex" }));
    const handler = new JiraPageRequestHandler({
      fetch: fetchMock,
      allowLocalhost: false,
    });

    await expect(handler.execute("bridge-1", request, request.baseUrl)).resolves.toEqual(
      expect.objectContaining({
        status: 200,
        data: { displayName: "Alex" },
        retryCount: 0,
      }),
    );
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

  it("maps Jira authentication responses without exposing response data", async () => {
    const handler = new JiraPageRequestHandler({
      fetch: vi.fn().mockResolvedValue(jsonResponse({ private: "body" }, 401)),
      allowLocalhost: false,
    });

    await expect(
      handler.execute("bridge-2", request, request.baseUrl),
    ).rejects.toMatchObject({
      appError: { code: "AUTH_REQUIRED", httpStatus: 401 },
    });
  });

  it("rejects cross-instance requests before fetch", async () => {
    const fetchMock = vi.fn();
    const handler = new JiraPageRequestHandler({
      fetch: fetchMock,
      allowLocalhost: false,
    });

    await expect(
      handler.execute("bridge-3", request, "https://other.atlassian.net"),
    ).rejects.toBeInstanceOf(JiraPageRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels an active bridge request", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const handler = new JiraPageRequestHandler({
      fetch: fetchMock,
      allowLocalhost: false,
    });
    const pending = handler.execute("bridge-4", request, request.baseUrl);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(handler.cancel("bridge-4")).toBe(true);
    await expect(pending).rejects.toMatchObject({
      appError: { code: "NETWORK_ERROR" },
    });
  });
});
