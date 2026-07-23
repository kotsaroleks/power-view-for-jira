import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchJiraInMainWorld,
  parseJiraMainWorldFetchResult,
} from "./jira-main-world-bridge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Jira main-world bridge", () => {
  it("performs a credentialed GET and returns sanitized JSON data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ displayName: "Alex" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJiraInMainWorld(
        "https://example.atlassian.net/rest/api/3/myself",
        "GET",
        { Accept: "application/json" },
        null,
        1_000,
      ),
    ).resolves.toMatchObject({
      kind: "success",
      status: 200,
      data: { displayName: "Alex" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/myself",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        redirect: "manual",
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("returns only a typed failure when page fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private reason")));

    await expect(
      fetchJiraInMainWorld(
        "https://example.atlassian.net/rest/api/3/myself",
        "GET",
        { Accept: "application/json" },
        null,
        1_000,
      ),
    ).resolves.toMatchObject({ kind: "failure", reason: "network" });
  });

  it("sends a mutation body and accepts Jira's empty success response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJiraInMainWorld(
        "https://example.atlassian.net/rest/api/3/issue/POWER-42/assignee",
        "PUT",
        {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        JSON.stringify({ accountId: "account-1" }),
        1_000,
      ),
    ).resolves.toMatchObject({ kind: "success", status: 204, data: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/issue/POWER-42/assignee",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ accountId: "account-1" }),
        credentials: "include",
      }),
    );
  });

  it("strictly validates values returned from the page world", () => {
    expect(
      parseJiraMainWorldFetchResult({
        kind: "success",
        status: 200,
        data: { displayName: "Alex" },
        durationMs: 4,
      }),
    ).toEqual({
      kind: "success",
      status: 200,
      data: { displayName: "Alex" },
      durationMs: 4,
    });
    expect(
      parseJiraMainWorldFetchResult({
        kind: "success",
        status: 200,
        data: {},
        durationMs: 4,
        injected: "unexpected",
      }),
    ).toBeUndefined();
  });
});
