import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { readBoundedJiraResponse, MAX_JIRA_RESPONSE_BYTES } from "./jira-response-reader";
import { fetchJiraInMainWorld } from "./background/jira-main-world-bridge";
import { JiraRequestHandler } from "./background/jira-request-handler";
import { JiraPageRequestHandler } from "./content/jira-page-request-handler";

function oversizedResponse(headers?: HeadersInit) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_JIRA_RESPONSE_BYTES));
      controller.enqueue(new Uint8Array(1));
    },
    cancel,
  });
  return { response: new Response(body, headers ? { headers } : {}), cancel };
}

describe("bounded Jira responses", () => {
  it.each([undefined, { "Content-Length": "1" }])(
    "counts stream bytes with headers %j and cancels oversized bodies",
    async (headers) => {
      const { response, cancel } = oversizedResponse(headers);
      await expect(readBoundedJiraResponse(response)).rejects.toThrow("20 MiB");
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("rejects a declared oversized body without reading it", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { "Content-Length": String(MAX_JIRA_RESPONSE_BYTES + 1) },
    });
    await expect(readBoundedJiraResponse(response)).rejects.toThrow("20 MiB");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("decodes UTF-8 split across chunks and accepts empty responses", async () => {
    const encoded = new TextEncoder().encode('"Привіт"');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 2));
        controller.enqueue(encoded.slice(2));
        controller.close();
      },
    });
    expect(await readBoundedJiraResponse(new Response(body))).toBe('"Привіт"');
    expect(await readBoundedJiraResponse(new Response(null, { status: 204 }))).toBe("");
  });

  it.each(["worker", "page", "main"])(
    "enforces the limit in the %s transport",
    async (transport) => {
      const { response, cancel } = oversizedResponse();
      const fetchMock = vi.fn().mockResolvedValue(response);
      const request = {
        baseUrl: "https://example.atlassian.net",
        method: "GET" as const,
        path: "/rest/api/3/myself",
      };
      if (transport === "main") {
        vi.stubGlobal("fetch", fetchMock);
        try {
          // Chrome injects a serialized function with no module closure.
          const injected = runInNewContext(`(${fetchJiraInMainWorld.toString()})`, {
            fetch: fetchMock,
            AbortController,
            Date,
            setTimeout,
            clearTimeout,
            TextDecoder,
          }) as typeof fetchJiraInMainWorld;
          await expect(
            injected(`${request.baseUrl}${request.path}`, "GET", {}, null, 1000),
          ).resolves.toMatchObject({ kind: "failure", reason: "invalid-response" });
        } finally {
          vi.unstubAllGlobals();
        }
      } else {
        const handler =
          transport === "worker"
            ? new JiraRequestHandler({ fetch: fetchMock, allowLocalhost: false })
            : new JiraPageRequestHandler({ fetch: fetchMock, allowLocalhost: false });
        await expect(
          handler.execute("oversized", request, request.baseUrl),
        ).rejects.toMatchObject({ appError: { code: "INVALID_RESPONSE" } });
      }
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
});
