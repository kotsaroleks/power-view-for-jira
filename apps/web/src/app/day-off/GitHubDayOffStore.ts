import type { DayOffReadResult, DayOffStore } from "./DayOffStore";
import { UnknownDayOffOutcomeError } from "./DayOffStore";
import type { JiraRosterTeam } from "./DayOffStore";

export interface GitHubDayOffConfig {
  owner: string;
  repo: string;
  branch: string;
  root: string;
  token: string;
}
interface Options extends GitHubDayOffConfig {
  fetch?: typeof fetch;
  ensureAccess?: () => Promise<void>;
}
interface Month {
  schemaVersion: 1;
  jiraBaseUrl: string;
  jiraAccountId: string;
  month: string;
  dates: string[];
  updatedAt: string;
}
export class GitHubDayOffError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GitHubDayOffError";
  }
}
export function normalizeJiraInstance(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new GitHubDayOffError("invalid", "Invalid Jira instance.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}
export const storageKey = (value: string) => {
  if (!value || value.length > 2048)
    throw new GitHubDayOffError("invalid", "Invalid storage identity.");
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};
function monthOf(date: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number(date.slice(0, 4)) < 1900 ||
    !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw new GitHubDayOffError("invalid", "Invalid Day Off date.");
  return date.slice(0, 7);
}
const encode = (value: unknown) =>
  btoa(
    Array.from(new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n"), (b) =>
      String.fromCharCode(b),
    ).join(""),
  );
const decode = (value: string): unknown =>
  JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(value.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
    ),
  );

export class GitHubDayOffStore implements DayOffStore {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly cache = new Map<
    string,
    { etag?: string | undefined; sha: string; data: unknown }
  >();
  constructor(private readonly options: Options) {
    if (
      !/^[A-Za-z0-9_-]+$/.test(options.owner) ||
      !/^[A-Za-z0-9_.-]+$/.test(options.repo) ||
      [".", ".."].includes(options.repo) ||
      !options.branch.trim() ||
      !options.token.trim() ||
      !options.root.split("/").every((part) => /^[A-Za-z0-9_-]+$/.test(part))
    )
      throw new GitHubDayOffError("configuration", "Сховище Day Off не налаштоване.");
    this.endpoint = `https://api.github.com/repos/${options.owner}/${options.repo}`;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  async connect() {
    await this.options.ensureAccess?.();
  }
  private async request(path: string, init: RequestInit = {}) {
    await this.options.ensureAccess?.();
    try {
      return await this.fetcher(this.endpoint + path, {
        ...init,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.options.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...init.headers,
        },
      });
    } catch {
      if (init.signal?.aborted) init.signal.throwIfAborted();
      throw new GitHubDayOffError("network", "GitHub Day Off: network unavailable.");
    }
  }
  private failure(response: Response): never {
    const rate =
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          response.headers.has("retry-after")));
    throw new GitHubDayOffError(
      rate
        ? "rate-limit"
        : response.status === 401 || response.status === 403
          ? "access"
          : response.status === 404
            ? "destination"
            : "service",
      rate
        ? "GitHub Day Off rate limit reached. Refresh later."
        : response.status === 401 || response.status === 403
          ? "Day Off application access is unavailable. The owner must check the shared token and permissions."
          : response.status === 404
            ? "Day Off repository or branch is unavailable; calendar state is unknown."
            : `GitHub Day Off request failed (${response.status}).`,
    );
  }
  private path(base: string, account: string, month: string) {
    return `day-off/${storageKey(base)}/${storageKey(account)}/${month}.json`;
  }
  private async snapshot(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ sha?: string; data?: unknown }> {
    const cached = this.cache.get(path);
    const response = await this.request(
      `/contents/${this.options.root}/${path}?ref=${encodeURIComponent(this.options.branch)}`,
      {
        signal: signal ?? null,
        headers: cached?.etag ? { "If-None-Match": cached.etag } : {},
      },
    );
    if (response.status === 304 && cached) return cached;
    if (response.status === 404) {
      // A file 404 alone also means inaccessible repository or missing branch.
      const branch = await this.request(
        `/branches/${encodeURIComponent(this.options.branch)}`,
        { signal: signal ?? null },
      );
      if (!branch.ok) this.failure(branch);
      const metadata = (await branch.json()) as {
        name?: string;
        commit?: { sha?: string };
      };
      if (metadata.name !== this.options.branch || !metadata.commit?.sha)
        throw new GitHubDayOffError("invalid", "Invalid GitHub branch response.");
      this.cache.delete(path);
      return {};
    }
    if (!response.ok) this.failure(response);
    try {
      const file = (await response.json()) as {
        type?: string;
        sha?: string;
        encoding?: string;
        content?: string;
      };
      if (
        file.type !== "file" ||
        !file.sha ||
        file.encoding !== "base64" ||
        typeof file.content !== "string"
      )
        throw new Error();
      const result = {
        sha: file.sha,
        data: decode(file.content),
        etag: response.headers.get("etag") ?? undefined,
      };
      this.cache.set(path, result);
      return result;
    } catch {
      throw new GitHubDayOffError(
        "invalid",
        "Invalid Day Off JSON file. Nothing was overwritten.",
      );
    }
  }
  private month(data: unknown, base: string, account: string, month: string): Month {
    if (data === undefined)
      return {
        schemaVersion: 1,
        jiraBaseUrl: base,
        jiraAccountId: account,
        month,
        dates: [],
        updatedAt: new Date().toISOString(),
      };
    const item = data as Month;
    if (
      !item ||
      item.schemaVersion !== 1 ||
      item.jiraBaseUrl !== base ||
      item.jiraAccountId !== account ||
      item.month !== month ||
      typeof item.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(item.updatedAt)) ||
      !Array.isArray(item.dates) ||
      item.dates.some((date) => typeof date !== "string" || monthOf(date) !== month) ||
      new Set(item.dates).size !== item.dates.length
    )
      throw new GitHubDayOffError(
        "invalid",
        "Invalid Day Off month or Jira identity. Nothing was overwritten.",
      );
    return item;
  }
  async read(
    baseUrl: string,
    accounts: string[],
    days: string[],
    signal?: AbortSignal,
  ): Promise<DayOffReadResult> {
    const base = normalizeJiraInstance(baseUrl);
    const months = [...new Set(days.map(monthOf))];
    const result: DayOffReadResult = { dayOffs: [], complete: true, warnings: [] };
    // Bound concurrency rather than issuing one request for every team member at once.
    for (const account of new Set(accounts))
      for (const month of months) {
        try {
          const file = await this.snapshot(this.path(base, account, month), signal);
          const record = this.month(file.data, base, account, month);
          result.dayOffs.push(
            ...record.dates
              .filter((date) => days.includes(date))
              .map((date) => ({ userId: account, date })),
          );
        } catch (error) {
          signal?.throwIfAborted();
          result.complete = false;
          result.warnings.push(
            error instanceof Error ? error.message : "Day Off unavailable.",
          );
        }
      }
    result.warnings = [...new Set(result.warnings)];
    return result;
  }
  private async put(path: string, data: unknown, sha?: string, signal?: AbortSignal) {
    return this.request(`/contents/${this.options.root}/${path}`, {
      method: "PUT",
      signal: signal ?? null,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Update PowerView calendar data",
        branch: this.options.branch,
        content: encode(data),
        ...(sha ? { sha } : {}),
      }),
    });
  }
  async set(
    baseUrl: string,
    account: string,
    date: string,
    enabled: boolean,
    signal?: AbortSignal,
    verifyIdentity?: () => Promise<void>,
  ) {
    const base = normalizeJiraInstance(baseUrl),
      month = monthOf(date),
      path = this.path(base, account, month);
    let file = await this.snapshot(path, signal);
    const initial = this.month(file.data, base, account, month).dates.includes(date);
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = this.month(file.data, base, account, month);
      const state = current.dates.includes(date);
      if (state === enabled) return;
      if (state !== initial)
        throw new GitHubDayOffError(
          "conflict",
          "Day Off changed concurrently. Refresh before changing it again.",
        );
      const dates = new Set(current.dates);
      if (enabled) dates.add(date);
      else dates.delete(date);
      await verifyIdentity?.();
      signal?.throwIfAborted();
      let response: Response;
      try {
        response = await this.put(
          path,
          { ...current, dates: [...dates].sort(), updatedAt: new Date().toISOString() },
          file.sha,
          signal,
        );
      } catch {
        return this.reconcile(path, base, account, month, date, enabled);
      }
      this.cache.delete(path);
      if (response.ok) return;
      if (response.status >= 500 || response.status === 408)
        return this.reconcile(path, base, account, month, date, enabled);
      if (response.status !== 409 && response.status !== 422) this.failure(response);
      file = await this.snapshot(path, signal);
    }
    throw new GitHubDayOffError(
      "conflict",
      "Day Off changed concurrently. Refresh before changing it again.",
    );
  }
  private async reconcile(
    path: string,
    base: string,
    account: string,
    month: string,
    date: string,
    enabled: boolean,
  ) {
    this.cache.delete(path);
    try {
      const file = await this.snapshot(path);
      if (this.month(file.data, base, account, month).dates.includes(date) === enabled)
        return;
    } catch {
      /* Unknown writes are never replayed. */
    }
    throw new UnknownDayOffOutcomeError();
  }
  private async reconcileRoster(path: string, expected: unknown, count: number) {
    this.cache.delete(path);
    try {
      if (JSON.stringify((await this.snapshot(path)).data) === JSON.stringify(expected))
        return { synced: count, unmapped: 0, inactive: 0 };
    } catch {
      /* Never replay a roster write with an unknown result. */
    }
    throw new GitHubDayOffError(
      "unknown",
      "Team roster sync result is unknown. Read the shared roster before syncing again.",
    );
  }
  async syncTeam(baseUrl: string, team: JiraRosterTeam, signal?: AbortSignal) {
    const base = normalizeJiraInstance(baseUrl);
    if (
      !team.id ||
      !team.name ||
      team.members.some((m) => !m.accountId || !m.displayName) ||
      new Set(team.members.map((m) => m.accountId)).size !== team.members.length
    )
      throw new GitHubDayOffError(
        "invalid",
        "Complete Jira team membership is required.",
      );
    const path = `teams/${storageKey(base)}/${storageKey(team.id)}.json`;
    const file = await this.snapshot(path, signal);
    const data = {
      schemaVersion: 1,
      jiraBaseUrl: base,
      teamId: team.id,
      teamName: team.name,
      members: team.members.map(({ accountId, displayName }) => ({
        accountId,
        displayName,
      })),
      updatedAt: new Date().toISOString(),
    };
    let response: Response;
    try {
      response = await this.put(path, data, file.sha, signal);
    } catch {
      return this.reconcileRoster(path, data, team.members.length);
    }
    this.cache.delete(path);
    if (response.status >= 500 || response.status === 408)
      return this.reconcileRoster(path, data, team.members.length);
    if (response.status === 409 || response.status === 422)
      throw new GitHubDayOffError(
        "conflict",
        "Team roster changed concurrently. Read Jira membership and sync again.",
      );
    if (!response.ok) this.failure(response);
    return { synced: team.members.length, unmapped: 0, inactive: 0 };
  }
}
