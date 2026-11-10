import { Buffer } from "node:buffer";
import { z } from "zod";
import type { JiraTransport } from "@power-view/jira-client";
import type { JiraTransportRequest } from "@power-view/extension-messaging";
import type { DescriptionReportState, OutboxPart, ReportStateStore } from "./job";

export const reportBotConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  jiraBaseUrl: z.url(),
  boardId: z.string().regex(/^\d+$/),
  expectedJiraAccountId: z.string().min(1),
  chatSpace: z.string().regex(/^[A-Za-z0-9_-]+$/),
  firstReportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  chatWebhookFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  jiraApiRoot: z.url().optional(),
  morningReports: z
    .strictObject({
      calendar: z.literal("kyiv-workdays-08-v1"),
      firstReportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      sprintFieldId: z
        .string()
        .regex(/^customfield_\d+$/)
        .optional(),
      descriptionCoveredThrough: z.iso.datetime().optional(),
    })
    .optional(),
});
export type ReportBotConfig = z.infer<typeof reportBotConfigSchema>;
export function checkedJiraRoot(config: ReportBotConfig): string {
  const origin = new URL(config.jiraBaseUrl);
  if (
    origin.protocol !== "https:" ||
    !origin.hostname.endsWith(".atlassian.net") ||
    origin.port ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    !["", "/"].includes(origin.pathname)
  )
    throw new Error(
      "Configure an HTTPS Jira Cloud site without credentials or query parameters.",
    );
  const root = new URL(config.jiraApiRoot ?? origin.origin);
  const gateway =
    root.origin === "https://api.atlassian.com" &&
    /^\/ex\/jira\/[a-zA-Z0-9-]+\/?$/.test(root.pathname);
  if (
    (!gateway && root.origin !== origin.origin) ||
    root.username ||
    root.password ||
    root.search ||
    root.hash ||
    (!gateway && !["", "/"].includes(root.pathname))
  )
    throw new Error(
      "The Jira API root must be the selected site or its Atlassian gateway.",
    );
  return root.href.replace(/\/$/, "");
}
class RemoteStatusError extends Error {
  constructor(readonly status: number) {
    super(`Remote service returned HTTP ${status}.`);
  }
}
async function jsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new RemoteStatusError(response.status);
  return jsonBody(response);
}
async function jsonBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The remote response was empty.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 32 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("The remote response exceeded the report read limit.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("The remote service returned invalid JSON.");
  }
}
export class ReadOnlyReportTransport implements JiraTransport {
  constructor(
    private readonly config: ReportBotConfig,
    private readonly email: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    checkedJiraRoot(config);
  }
  async request<T>(
    request: JiraTransportRequest,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const origin = new URL(this.config.jiraBaseUrl).origin;
    if (
      new URL(request.baseUrl).origin !== origin ||
      !/^\/rest\/(?:api\/3|agile\/1\.0)\//.test(request.path) ||
      request.path.includes("..") ||
      request.path.includes("?")
    )
      throw new Error("The report attempted to leave its selected Jira site.");
    if (
      request.method !== "GET" &&
      !(request.method === "POST" && request.path === "/rest/api/3/changelog/bulkfetch")
    )
      throw new Error("The report is read-only and cannot modify Jira.");
    const url = new URL(checkedJiraRoot(this.config) + request.path);
    for (const [key, value] of Object.entries(request.query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value));
    const response = await this.fetcher(url, {
      method: request.method,
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization:
          "Basic " + Buffer.from(this.email + ":" + this.token).toString("base64"),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
    const parsed = schema.safeParse(await jsonResponse(response));
    if (!parsed.success) throw new Error("Jira returned incomplete report data.");
    return parsed.data;
  }
}

const partSchema = z.strictObject({
  requestId: z.uuid(),
  payload: z.union([
    z.strictObject({ text: z.literal("No changes for today") }),
    z.object({
      text: z.string(),
      cardsV2: z.array(z.record(z.string(), z.unknown())).min(1),
    }),
  ]),
  messageName: z.string().optional(),
});
const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scope: z.string().min(1),
  processedThrough: z.string().optional(),
  pending: z
    .strictObject({ date: z.string(), parts: z.array(partSchema).min(1) })
    .optional(),
});
const contentSchema = z.object({
  sha: z.string().min(1),
  content: z.string(),
  encoding: z.literal("base64"),
});
export class GitHubReportStateStore implements ReportStateStore {
  private sha: string | undefined;
  private checked = false;
  constructor(
    private readonly repository: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly statePath = "state/description-report.json",
  ) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
      throw new Error("Select a private automation repository.");
    if (
      !/^state\/(?:description-report|morning-description-report|work-activity-report)\.json$/.test(
        statePath,
      )
    )
      throw new Error("Select a supported private report state file.");
  }
  private async request(path: string, method = "GET", body?: unknown): Promise<Response> {
    return this.fetcher(`https://api.github.com/repos/${this.repository}${path}`, {
      method,
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + this.token,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
  }
  async load(): Promise<DescriptionReportState | undefined> {
    const repo = z
      .object({ private: z.literal(true), default_branch: z.literal("main") })
      .safeParse(await jsonResponse(await this.request("")));
    if (!repo.success)
      throw new Error("Report state must stay in a private repository on main.");
    this.checked = true;
    const response = await this.request("/contents/" + this.statePath + "?ref=main");
    if (response.status === 404) {
      this.sha = undefined;
      return undefined;
    }
    const content = contentSchema.parse(await jsonResponse(response));
    this.sha = content.sha;
    try {
      const state = stateSchema.parse(
        JSON.parse(Buffer.from(content.content, "base64").toString("utf8")),
      );
      return state as DescriptionReportState;
    } catch {
      throw new Error(
        "Saved delivery state is invalid. Delivery was stopped to prevent duplicates.",
      );
    }
  }
  async save(value: DescriptionReportState): Promise<void> {
    if (!this.checked)
      throw new Error("Read and verify private report state before saving it.");
    stateSchema.parse(value);
    const response = await this.request("/contents/" + this.statePath, "PUT", {
      message: "Record description report delivery checkpoint",
      branch: "main",
      content: Buffer.from(JSON.stringify(value)).toString("base64"),
      ...(this.sha ? { sha: this.sha } : {}),
    });
    const parsed = z
      .object({ content: z.object({ sha: z.string().min(1) }) })
      .safeParse(await jsonResponse(response));
    if (!parsed.success) throw new Error("The delivery checkpoint was not confirmed.");
    this.sha = parsed.data.content.sha;
  }
}
export function checkedChatWebhook(value: string, space: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Configure the Google Chat webhook in the protected setting.");
  }
  if (
    url.origin !== "https://chat.googleapis.com" ||
    url.pathname !== `/v1/spaces/${space}/messages` ||
    url.username ||
    url.password ||
    url.hash ||
    !url.searchParams.get("key") ||
    !url.searchParams.get("token") ||
    [...url.searchParams.keys()].some((key) => !["key", "token"].includes(key))
  )
    throw new Error("The webhook must belong to the selected Google Chat space.");
  return url;
}
export async function sendDescriptionChatPart(
  part: OutboxPart,
  webhook: string,
  space: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const url = checkedChatWebhook(webhook, space);
  const messageId = "client-" + part.requestId;
  url.searchParams.set("messageId", messageId);
  const response = await fetcher(url, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(part.payload),
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 409) {
    const duplicate = z
      .object({ error: z.object({ status: z.literal("ALREADY_EXISTS") }) })
      .safeParse(await jsonBody(response).catch(() => undefined));
    if (duplicate.success) return `spaces/${space}/messages/${messageId}`;
    throw new RemoteStatusError(response.status);
  }
  const result = z
    .object({ name: z.string().min(1) })
    .safeParse(await jsonResponse(response));
  if (!result.success || !result.data.name.startsWith(`spaces/${space}/messages/`))
    throw new Error(
      "Google Chat did not confirm delivery. The same saved request will be reconciled on retry.",
    );
  return result.data.name;
}
/** The per-space webhook quota is one request per second. Reuse the persisted
 * request on throttling/service failures; an unknown network outcome stays in the
 * durable outbox for recovery instead of being regenerated. */
export function createDescriptionChatSender(
  webhook: string,
  space: string,
  options: {
    fetcher?: typeof fetch;
    wait?: (milliseconds: number) => Promise<void>;
    now?: () => number;
  } = {},
): (part: OutboxPart) => Promise<string> {
  checkedChatWebhook(webhook, space);
  const wait =
    options.wait ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  return async (part) => {
    for (let attempt = 0; ; attempt++) {
      const delay = Math.max(0, 1100 - (now() - lastAttempt));
      if (delay) await wait(delay);
      lastAttempt = now();
      try {
        return await sendDescriptionChatPart(part, webhook, space, options.fetcher);
      } catch (error) {
        if (
          !(error instanceof RemoteStatusError) ||
          (error.status !== 429 && error.status < 500) ||
          attempt >= 3
        )
          throw error;
        await wait(1500 * 2 ** attempt);
      }
    }
  };
}
