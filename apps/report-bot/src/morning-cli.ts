import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { JiraCloudClient, collectWorkActivitySource } from "@power-view/jira-client";
import { runMorningReports, type MorningReportPreview } from "./morning-runner";
import {
  checkedJiraRoot,
  checkedChatWebhook,
  createDescriptionChatSender,
  GitHubReportStateStore,
  ReadOnlyReportTransport,
  reportBotConfigSchema,
} from "./runtime";

let stage = "protected morning configuration";
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing protected setting: " + name);
  return value;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--dry-run", "--preview-only"].includes(arg)))
    throw new Error("Unsupported morning report mode.");
  const dryRun = args.includes("--dry-run") || args.includes("--preview-only");
  const previewOnly = args.includes("--preview-only");
  const config = reportBotConfigSchema.parse(
    JSON.parse(await readFile(process.env.REPORT_CONFIG_PATH ?? "config.json", "utf8")),
  );
  checkedJiraRoot(config);
  const now = new Date();
  const transport = new ReadOnlyReportTransport(
    config,
    required("JIRA_EMAIL"),
    required("JIRA_API_TOKEN"),
  );
  const client = new JiraCloudClient(transport, config.jiraBaseUrl);
  const webhook = dryRun ? undefined : required("GOOGLE_CHAT_WEBHOOK_URL");
  if (webhook) {
    checkedChatWebhook(webhook, config.chatSpace);
    if (
      createHash("sha256").update(webhook).digest("hex") !== config.chatWebhookFingerprint
    )
      throw new Error("The Chat delivery identity changed.");
  }
  const send = webhook
    ? createDescriptionChatSender(webhook, config.chatSpace)
    : () => Promise.reject(new Error("Preview cannot send messages."));
  const previews: MorningReportPreview[] = [];
  const result = await runMorningReports({
    config,
    now,
    dryRun,
    previewOnly,
    collect: (_date, period) => {
      stage = "complete morning Jira history read";
      return collectWorkActivitySource({
        client,
        transport,
        jiraBaseUrl: config.jiraBaseUrl,
        boardId: config.boardId,
        period,
        now,
        expectedUserId: config.expectedJiraAccountId,
        ...(config.morningReports?.sprintFieldId
          ? { sprintFieldId: config.morningReports.sprintFieldId }
          : {}),
      });
    },
    storeFor: (path) => {
      stage = "private report checkpoint setup";
      const store = new GitHubReportStateStore(
        required("REPORT_STATE_REPOSITORY"),
        required("GH_REPORT_TOKEN"),
        fetch,
        path,
      );
      return {
        load: () => {
          stage = "private morning checkpoint read";
          return store.load();
        },
        save: (value) => {
          stage = "private morning checkpoint save";
          return store.save(value);
        },
      };
    },
    send: (part) => {
      stage = "Google Chat delivery";
      return send(part);
    },
    preview: (value) => {
      previews.push(value);
      return Promise.resolve();
    },
  });
  if (dryRun && process.env.REPORT_PREVIEW_PATH)
    await writeFile(process.env.REPORT_PREVIEW_PATH, JSON.stringify(previews, null, 2), {
      mode: 0o600,
    });
  console.log(JSON.stringify(result));
}
void main().catch(() => {
  console.error(
    "Morning reports stopped during " +
      stage +
      ". No credentials or unconfirmed empty result were logged; saved outboxes remain available for recovery.",
  );
  process.exitCode = 1;
});
