import { describe, expect, it, vi } from "vitest";
import { JiraCloudClient, collectDescriptionChangeReport } from "@power-view/jira-client";
import { runDescriptionReportJob } from "./job";
import {
  GitHubReportStateStore,
  ReadOnlyReportTransport,
  sendDescriptionChatPart,
  type ReportBotConfig,
} from "./runtime";

const config: ReportBotConfig = {
  schemaVersion: 1,
  jiraBaseUrl: "https://fixture.atlassian.net",
  boardId: "7",
  expectedJiraAccountId: "viewer",
  chatSpace: "fixture-space",
  firstReportDate: "2026-11-06",
};
function requestURL(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}
function setup(scenario: string) {
  let saved: string | undefined;
  let stateSHA = 0;
  let unknownResult = scenario === "timeout" || scenario === "empty-timeout";
  const empty = scenario === "empty" || scenario === "empty-timeout";
  const messages = new Map<string, { body: string; name: string }>();
  const fetcher = vi.fn<typeof fetch>((input, init) => {
    const url = new URL(requestURL(input));
    const bodyText = typeof init?.body === "string" ? init.body : "";
    let body: unknown;
    if (url.hostname === "api.github.com") {
      if (!url.pathname.includes("/contents/"))
        body = { private: true, default_branch: "main" };
      else if (init?.method === "PUT") {
        const value = JSON.parse(bodyText) as { content: string; sha?: string };
        if (saved && value.sha !== String(stateSHA))
          return Promise.resolve(new Response("{}", { status: 409 }));
        saved = value.content;
        stateSHA++;
        body = { content: { sha: String(stateSHA) } };
      } else if (!saved) return Promise.resolve(new Response("{}", { status: 404 }));
      else body = { sha: String(stateSHA), encoding: "base64", content: saved };
    } else if (url.hostname === "chat.googleapis.com") {
      expect(url.searchParams.has("requestId")).toBe(false);
      const messageID = url.searchParams.get("messageId")!;
      expect(messageID).toMatch(/^client-[0-9a-f-]{36}$/);
      const prior = messages.get(messageID);
      if (prior) {
        expect(bodyText).toBe(prior.body);
        return Promise.resolve(
          new Response(JSON.stringify({ error: { status: "ALREADY_EXISTS" } }), {
            status: 409,
          }),
        );
      }
      messages.set(messageID, {
        body: bodyText,
        name: "spaces/fixture-space/messages/" + messageID,
      });
      if (unknownResult) {
        unknownResult = false;
        return Promise.reject(
          new Error("Network response lost after Chat accepted the message"),
        );
      }
      body = { name: messages.get(messageID)!.name };
    } else if (url.hostname === "fixture.atlassian.net") {
      if (init?.method !== "GET")
        return Promise.reject(new Error("Jira mutation attempted"));
      if (url.pathname.endsWith("/myself"))
        body = { accountId: "viewer", displayName: "TEST DATA" };
      else if (url.pathname.endsWith("/board/7")) body = { id: 7, name: "TEST DATA" };
      else if (url.pathname.endsWith("/board/7/issue"))
        body = {
          startAt: 0,
          maxResults: 100,
          total: 1,
          issues: [
            {
              id: "2",
              key: "TEST-2",
              fields: {
                summary: "Child",
                issuetype: { id: "sub", name: "Subtask" },
                parent: { id: "1", key: "TEST-1" },
              },
            },
          ],
        };
      else if (url.pathname.endsWith("/TEST-2/changelog")) {
        const offset = Number(url.searchParams.get("startAt"));
        const history = {
          id: String(10 + offset),
          created: "2026-11-06T10:00:00Z",
          author: {
            accountId: offset ? "second" : "first",
            displayName: offset ? "Second editor" : "First editor",
          },
          items: [
            {
              field: "Опис",
              fieldId: "description",
              fromString: "private previous description",
              toString: "private next description",
            },
          ],
        };
        body = {
          startAt: offset,
          maxResults: 1,
          total: empty ? 0 : 2,
          values: empty || (scenario === "partial" && offset === 1) ? [] : [history],
        };
      } else if (url.pathname.endsWith("/issue/TEST-1"))
        body = {
          id: "1",
          key: "TEST-1",
          fields: { summary: "Epic", issuetype: { id: "epic", name: "Epic" } },
        };
      else return Promise.reject(new Error("Unexpected Jira read"));
    } else return Promise.reject(new Error("Unexpected host"));
    return Promise.resolve(new Response(JSON.stringify(body)));
  });
  const client = new JiraCloudClient(
    new ReadOnlyReportTransport(config, "user@example.invalid", "fixture-only", fetcher),
    config.jiraBaseUrl,
  );
  const job = () =>
    runDescriptionReportJob({
      scope: "fixture-scope",
      startDate: config.firstReportDate,
      now: new Date("2026-11-06T19:05:00Z"),
      dryRun: false,
      store: new GitHubReportStateStore(
        "fixture/private-reports",
        "fixture-only",
        fetcher,
      ),
      collect: (date) =>
        collectDescriptionChangeReport({
          client,
          jiraBaseUrl: config.jiraBaseUrl,
          boardId: config.boardId,
          date,
          now: new Date("2026-11-06T19:05:00Z"),
          expectedUserId: config.expectedJiraAccountId,
        }),
      send: (part) =>
        sendDescriptionChatPart(
          part,
          "https://chat.googleapis.com/v1/spaces/fixture-space/messages?key=fixture&token=fixture-only",
          config.chatSpace,
          fetcher,
        ),
    });
  return {
    job,
    messages,
    fetcher,
    state: () => (saved ? (JSON.parse(atob(saved)) as unknown) : undefined),
  };
}
describe("Jira history → private checkpoint → Google Chat delivery", () => {
  it("reads every history page, adds ancestors and authors, and never stores description contents", async () => {
    const { job, messages, state } = setup("complete");
    expect(await job()).toMatchObject({ processed: 1, messages: 1 });
    const message = [...messages.values()][0]!.body;
    for (const text of ["TEST-1", "TEST-2", "First editor", "Second editor"])
      expect(message).toContain(text);
    expect(message).not.toContain("private previous");
    expect(JSON.stringify(state())).not.toContain("private next");
    expect(await job()).toMatchObject({ processed: 0, messages: 0 });
    expect(messages.size).toBe(1);
  });
  it("does not checkpoint or post when a later history page is missing", async () => {
    const { job, messages, state } = setup("partial");
    await expect(job()).rejects.toThrow(/incomplete/);
    expect(state()).toBeUndefined();
    expect(messages.size).toBe(0);
  });
  it("posts the exact empty report text once per period without reading ancestor context", async () => {
    const { job, messages, state, fetcher } = setup("empty");
    expect(await job()).toMatchObject({ processed: 1, messages: 1 });
    expect(messages.size).toBe(1);
    expect(JSON.parse([...messages.values()][0]!.body)).toEqual({
      text: "No changes for today",
    });
    expect(state()).toHaveProperty("processedThrough", "2026-11-06");
    expect(state()).not.toHaveProperty("pending");
    expect(await job()).toMatchObject({ processed: 0, messages: 0 });
    expect(messages.size).toBe(1);
    expect(
      fetcher.mock.calls.filter(([input]) =>
        new URL(requestURL(input)).pathname.endsWith("/issue/TEST-1"),
      ),
    ).toHaveLength(0);
  });
  it("recovers an accepted empty report with the same client ID and body after a lost response", async () => {
    const { job, messages, state, fetcher } = setup("empty-timeout");
    await expect(job()).rejects.toThrow(/response lost/);
    expect(state()).toHaveProperty("pending");
    expect(state()).not.toHaveProperty("processedThrough");
    expect(messages.size).toBe(1);
    expect(JSON.parse([...messages.values()][0]!.body)).toEqual({
      text: "No changes for today",
    });
    const reads = fetcher.mock.calls.filter(([input]) =>
      requestURL(input).includes("fixture.atlassian.net"),
    ).length;
    expect(await job()).toMatchObject({ processed: 1, messages: 1 });
    const chatRequests = fetcher.mock.calls.filter(
      ([input]) => new URL(requestURL(input)).hostname === "chat.googleapis.com",
    );
    expect(chatRequests).toHaveLength(2);
    expect(new URL(requestURL(chatRequests[1]![0])).searchParams.get("messageId")).toBe(
      new URL(requestURL(chatRequests[0]![0])).searchParams.get("messageId"),
    );
    expect(chatRequests[1]![1]?.body).toBe(chatRequests[0]![1]?.body);
    expect(messages.size).toBe(1);
    expect(state()).toHaveProperty("processedThrough", "2026-11-06");
    expect(state()).not.toHaveProperty("pending");
    expect(
      fetcher.mock.calls.filter(([input]) =>
        requestURL(input).includes("fixture.atlassian.net"),
      ),
    ).toHaveLength(reads);
    expect(await job()).toMatchObject({ processed: 0, messages: 0 });
    expect(messages.size).toBe(1);
  });
  it("recovers an unknown Chat outcome through the saved client message ID and duplicate response", async () => {
    const { job, messages, state, fetcher } = setup("timeout");
    await expect(job()).rejects.toThrow(/response lost/);
    expect(state()).toHaveProperty("pending");
    const reads = fetcher.mock.calls.filter(([input]) =>
      requestURL(input).includes("fixture.atlassian.net"),
    ).length;
    await job();
    expect(messages.size).toBe(1);
    const chatRequests = fetcher.mock.calls
      .map(([input]) => new URL(requestURL(input)))
      .filter((url) => url.hostname === "chat.googleapis.com");
    expect(chatRequests).toHaveLength(2);
    expect(chatRequests[1]!.searchParams.get("messageId")).toBe(
      chatRequests[0]!.searchParams.get("messageId"),
    );
    expect(state()).toHaveProperty("processedThrough", "2026-11-06");
    expect(
      fetcher.mock.calls.filter(([input]) =>
        requestURL(input).includes("fixture.atlassian.net"),
      ),
    ).toHaveLength(reads);
  });
});
