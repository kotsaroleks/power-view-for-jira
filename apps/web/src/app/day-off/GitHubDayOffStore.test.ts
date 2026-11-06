import { describe, expect, it, vi } from "vitest";
import { GitHubDayOffStore, storageKey } from "./GitHubDayOffStore";
const base = "https://example.atlassian.net";
const config = {
  owner: "owner",
  repo: "data",
  branch: "main",
  root: "powerview",
  token: "test-secret",
};
const record = (dates: string[]) => ({
  schemaVersion: 1,
  jiraBaseUrl: base,
  jiraAccountId: "account",
  month: "2026-11",
  dates,
  updatedAt: "2026-11-02T00:00:00Z",
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const file = (dates: string[], sha = "sha") =>
  json({
    type: "file",
    sha,
    encoding: "base64",
    content: btoa(JSON.stringify(record(dates))),
  });
function writeBody(body: BodyInit | null | undefined): { sha?: string; content: string } {
  if (typeof body !== "string") throw new Error("Expected JSON body");
  return JSON.parse(body) as { sha?: string; content: string };
}
function setup(responses: (Response | Error)[]) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => {
    const response = responses.shift();
    if (response instanceof Error) return Promise.reject(response);
    if (!response) return Promise.reject(new Error("Unexpected request"));
    return Promise.resolve(response);
  });
  return { store: new GitHubDayOffStore({ ...config, fetch: fetcher }), fetcher };
}
describe("GitHub Day Off", () => {
  it("only treats a missing file as empty after verifying branch access", async () => {
    const { store, fetcher } = setup([
      json({}, 404),
      json({ name: "main", commit: { sha: "branch" } }),
    ]);
    expect(await store.read(base, ["account"], ["2026-11-02"])).toEqual({
      dayOffs: [],
      complete: true,
      warnings: [],
    });
    expect(fetcher.mock.calls[1]?.[0]).toContain("/branches/main");
  });
  it("does not report an inaccessible destination as an empty calendar", async () => {
    const { store } = setup([json({}, 404), json({}, 404)]);
    const result = await store.read(base, ["account"], ["2026-11-02"]);
    expect(result.complete).toBe(false);
    expect(result.warnings[0]).toContain("repository or branch");
  });
  it("automatically creates the first monthly file without SHA", async () => {
    const { store, fetcher } = setup([
      json({}, 404),
      json({ name: "main", commit: { sha: "branch" } }),
      json({}, 201),
    ]);
    await store.set(base, "account", "2026-11-02", true);
    const body = writeBody(fetcher.mock.calls[2]?.[1]?.body);
    expect(body.sha).toBeUndefined();
    expect((JSON.parse(atob(body.content)) as { dates: string[] }).dates).toEqual([
      "2026-11-02",
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      `/day-off/${storageKey(base)}/${storageKey("account")}/2026-11.json`,
    );
  });
  it("merges another date after SHA conflict", async () => {
    const { store, fetcher } = setup([
      file([]),
      json({}, 409),
      file(["2026-11-03"], "new"),
      json({}),
    ]);
    await store.set(base, "account", "2026-11-02", true);
    const body = writeBody(fetcher.mock.calls[3]?.[1]?.body);
    expect(body.sha).toBe("new");
    expect((JSON.parse(atob(body.content)) as { dates: string[] }).dates).toEqual([
      "2026-11-02",
      "2026-11-03",
    ]);
  });
  it("handles concurrent first creation and avoids a redundant commit", async () => {
    const { store, fetcher } = setup([
      json({}, 404),
      json({ name: "main", commit: { sha: "branch" } }),
      json({}, 422),
      file(["2026-11-02"]),
    ]);
    await store.set(base, "account", "2026-11-02", true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(
      1,
    );
  });
  it("rereads after a lost write response without replay", async () => {
    const { store, fetcher } = setup([
      file([]),
      new Error("network"),
      file(["2026-11-02"]),
    ]);
    await store.set(base, "account", "2026-11-02", true);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(
      1,
    );
  });
  it("keeps an unknown write unresolved when reread cannot prove success", async () => {
    const { store, fetcher } = setup([file([]), json({}, 503), file([])]);
    await expect(store.set(base, "account", "2026-11-02", true)).rejects.toHaveProperty(
      "name",
      "UnknownDayOffOutcomeError",
    );
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(
      1,
    );
  });
  it("does not write if Jira identity changes during the file read", async () => {
    const { store, fetcher } = setup([file([])]);
    await expect(
      store.set(base, "account", "2026-11-02", true, undefined, () =>
        Promise.reject(new Error("account changed")),
      ),
    ).rejects.toThrow("account changed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects corrupt data and invalid dates", async () => {
    const { store } = setup([
      json({ type: "file", sha: "sha", encoding: "base64", content: "!invalid" }),
    ]);
    expect((await store.read(base, ["account"], ["2026-11-02"])).complete).toBe(false);
    await expect(store.set(base, "account", "2026-02-30", true)).rejects.toThrow(
      "Invalid Day Off date",
    );
  });
  it.each([401, 403, 429])(
    "distinguishes access and rate limits (%s)",
    async (status) => {
      const { store } = setup([json({}, status)]);
      const result = await store.read(base, ["account"], ["2026-11-02"]);
      expect(result.complete).toBe(false);
      expect(result.warnings.join()).toContain(
        status === 429 ? "rate limit" : "application access",
      );
      expect(result.warnings.join()).not.toContain(config.token);
    },
  );
  it("bounds conflict retries", async () => {
    const { store, fetcher } = setup([
      file([]),
      json({}, 409),
      file([]),
      json({}, 409),
      file([]),
      json({}, 409),
      file([]),
    ]);
    await expect(store.set(base, "account", "2026-11-02", true)).rejects.toHaveProperty(
      "code",
      "conflict",
    );
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(
      3,
    );
  });
  it("syncs Jira roster without identity mappings or changing calendars", async () => {
    const { store, fetcher } = setup([
      json({}, 404),
      json({ name: "main", commit: { sha: "branch" } }),
      json({}, 201),
    ]);
    expect(
      await store.syncTeam(base, {
        id: "team",
        name: "Team",
        members: [{ accountId: "new-user", displayName: "User" }],
      }),
    ).toEqual({ synced: 1, unmapped: 0, inactive: 0 });
    expect(fetcher.mock.calls[2]?.[0]).toContain("/teams/");
    expect(
      (
        JSON.parse(atob(writeBody(fetcher.mock.calls[2]?.[1]?.body).content)) as {
          members: unknown[];
        }
      ).members,
    ).toEqual([{ accountId: "new-user", displayName: "User" }]);
  });
});
