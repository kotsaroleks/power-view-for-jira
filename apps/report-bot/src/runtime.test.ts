import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  checkedChatWebhook,
  checkedJiraRoot,
  createDescriptionChatSender,
  GitHubReportStateStore,
  ReadOnlyReportTransport,
  sendDescriptionChatPart,
  type ReportBotConfig,
} from "./runtime";
import { descriptionChatMessages } from "@power-view/domain";
import { descriptionFixture } from "../../../packages/domain/src/description-report.test-fixtures";
const config: ReportBotConfig = {
  schemaVersion: 1,
  jiraBaseUrl: "https://fixture.atlassian.net",
  boardId: "7",
  expectedJiraAccountId: "viewer",
  chatSpace: "fixture-space",
  firstReportDate: "2026-11-06",
};
const webhook =
  "https://chat.googleapis.com/v1/spaces/fixture-space/messages?key=fixture&token=fixture-only";
describe("Protected description report transports", () => {
  it("rejects foreign Jira roots and credentials embedded in URLs", () => {
    expect(() =>
      checkedJiraRoot({ ...config, jiraApiRoot: "https://foreign.example" }),
    ).toThrow();
    expect(() =>
      checkedJiraRoot({
        ...config,
        jiraBaseUrl: "https://user:password@fixture.atlassian.net",
      }),
    ).toThrow();
    expect(
      checkedJiraRoot({
        ...config,
        jiraApiRoot: "https://api.atlassian.com/ex/jira/fixture-cloud",
      }),
    ).toContain("api.atlassian.com");
  });
  it("cannot send a Jira mutation or forward authorization to another site", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const transport = new ReadOnlyReportTransport(
      config,
      "user@example.com",
      "fixture-only",
      fetcher,
    );
    await expect(
      transport.request(
        { baseUrl: config.jiraBaseUrl, method: "PUT", path: "/rest/api/3/issue/TEST-1" },
        z.unknown(),
      ),
    ).rejects.toThrow(/read-only/);
    await expect(
      transport.request(
        { baseUrl: "https://foreign.example", method: "GET", path: "/rest/api/3/myself" },
        z.unknown(),
      ),
    ).rejects.toThrow(/site/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("applies read-only Jira schemas, refuses redirects, and accepts bulk POST only as a read", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ value: "ok" })));
    const transport = new ReadOnlyReportTransport(
      config,
      "user@example.com",
      "fixture-only",
      fetcher,
    );
    await expect(
      transport.request(
        {
          baseUrl: config.jiraBaseUrl,
          method: "POST",
          path: "/rest/api/3/changelog/bulkfetch",
          body: { issueIdsOrKeys: ["1"] },
        },
        z.object({ value: z.string() }),
      ),
    ).resolves.toEqual({ value: "ok" });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      method: "POST",
    });
  });
  it("rejects a webhook belonging to a different room or a different host", () => {
    expect(() => checkedChatWebhook(webhook, "other-space")).toThrow();
    expect(() =>
      checkedChatWebhook(
        webhook.replace("chat.googleapis.com", "foreign.example"),
        config.chatSpace,
      ),
    ).toThrow();
    expect(() =>
      checkedChatWebhook(webhook + "&unexpected=value", config.chatSpace),
    ).toThrow();
  });
  it("posts the persisted body and requestId and requires a receipt from the selected room", async () => {
    const payload = descriptionChatMessages(descriptionFixture())[0]!;
    const requestId = "12345678-1234-4123-a123-123456789012";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ name: "spaces/fixture-space/messages/one" })),
      );
    await expect(
      sendDescriptionChatPart({ requestId, payload }, webhook, config.chatSpace, fetcher),
    ).resolves.toBe("spaces/fixture-space/messages/one");
    const url = fetcher.mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get("requestId")).toBe(requestId);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(payload));
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ name: "spaces/other/messages/one" })),
    );
    await expect(
      sendDescriptionChatPart({ requestId, payload }, webhook, config.chatSpace, fetcher),
    ).rejects.toThrow(/confirm/);
  });
  it("never puts private report state in a public repository", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ private: false, default_branch: "main" })),
      );
    await expect(
      new GitHubReportStateStore("owner/reports", "fixture-only", fetcher).load(),
    ).rejects.toThrow(/private/);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("paces multi-part reports and retries throttling with the identical persisted request", async () => {
    const payload = descriptionChatMessages(descriptionFixture())[0]!;
    const part = { requestId: "12345678-1234-4123-a123-123456789012", payload };
    let time = 0;
    const delays: number[] = [];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ name: "spaces/fixture-space/messages/one" })),
        ),
      );
    const send = createDescriptionChatSender(webhook, config.chatSpace, {
      fetcher,
      now: () => time,
      wait: (ms) => {
        delays.push(ms);
        time += ms;
        return Promise.resolve();
      },
    });
    await send(part);
    await send({ ...part, requestId: "12345678-1234-4123-a123-123456789013" });
    expect(delays).toEqual([1500, 1100]);
    expect((fetcher.mock.calls[0]?.[0] as URL).href).toBe(
      (fetcher.mock.calls[1]?.[0] as URL).href,
    );
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
  });
  it("stops on permanent Chat rejection without consuming retry attempts", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 403 }));
    const send = createDescriptionChatSender(webhook, config.chatSpace, { fetcher });
    await expect(
      send({
        requestId: "12345678-1234-4123-a123-123456789012",
        payload: descriptionChatMessages(descriptionFixture())[0]!,
      }),
    ).rejects.toThrow("HTTP 403");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("refuses invalid state instead of resetting it and resending messages", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ private: true, default_branch: "main" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ sha: "one", encoding: "base64", content: btoa("not JSON") }),
        ),
      );
    await expect(
      new GitHubReportStateStore("owner/reports", "fixture-only", fetcher).load(),
    ).rejects.toThrow(/state is invalid/);
  });
  it("uses the last observed GitHub content SHA as an optimistic write guard", async () => {
    const state = {
      schemaVersion: 1 as const,
      scope: "scope",
      processedThrough: "2026-11-06",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ private: true, default_branch: "main" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: "known-sha",
            encoding: "base64",
            content: btoa(JSON.stringify(state)),
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: { sha: "next-sha" } })),
      );
    const store = new GitHubReportStateStore("owner/reports", "fixture-only", fetcher);
    await store.load();
    await store.save(state);
    expect(JSON.parse(fetcher.mock.calls[2]?.[1]?.body as string)).toMatchObject({
      sha: "known-sha",
      branch: "main",
    });
  });
});
