import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { collectDescriptionChangeReport, JiraCloudClient } from "@power-view/jira-client";
import {
  latestDescriptionReportDate,
  type DescriptionChangeReport,
} from "@power-view/domain";
import { runDescriptionReportJob, type ReportStateStore } from "./job";
import {
  checkedChatWebhook,
  checkedJiraRoot,
  createDescriptionChatSender,
  GitHubReportStateStore,
  ReadOnlyReportTransport,
  reportBotConfigSchema,
} from "./runtime";

let stage = "protected configuration";
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing protected setting: ${name}.`);
  return value;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--dry-run", "--preview-only"].includes(arg)))
    throw new Error("Supported modes: --dry-run and --preview-only.");
  const dryRun = args.includes("--dry-run") || args.includes("--preview-only");
  const previewOnly = args.includes("--preview-only");
  const config = reportBotConfigSchema.parse(
    JSON.parse(await readFile(process.env.REPORT_CONFIG_PATH ?? "config.json", "utf8")),
  );
  checkedJiraRoot(config);
  const email = required("JIRA_EMAIL");
  const token = required("JIRA_API_TOKEN");
  const webhook = dryRun ? undefined : required("GOOGLE_CHAT_WEBHOOK_URL");
  if (webhook) checkedChatWebhook(webhook, config.chatSpace);
  if (
    webhook &&
    config.chatWebhookFingerprint !== createHash("sha256").update(webhook).digest("hex")
  )
    throw new Error(
      "The Chat delivery identity changed. Reconfigure it before retrying any pending report.",
    );
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        config.jiraBaseUrl,
        config.boardId,
        config.expectedJiraAccountId,
        config.chatSpace,
        config.firstReportDate,
        config.chatWebhookFingerprint,
      ]),
    )
    .digest("hex");
  const transport = new ReadOnlyReportTransport(config, email, token);
  const client = new JiraCloudClient(transport, config.jiraBaseUrl);
  const now = new Date();
  const store: ReportStateStore = previewOnly
    ? {
        load: () => Promise.resolve(undefined),
        save: () => Promise.reject(new Error("Preview cannot save delivery state.")),
      }
    : new GitHubReportStateStore(
        required("REPORT_STATE_REPOSITORY"),
        required("GH_REPORT_TOKEN"),
      );
  const send = webhook
    ? createDescriptionChatSender(webhook, config.chatSpace)
    : undefined;
  const previews: DescriptionChangeReport[] = [];
  const result = await runDescriptionReportJob({
    scope,
    startDate: previewOnly ? latestDescriptionReportDate(now) : config.firstReportDate,
    now,
    dryRun,
    store: {
      load: () => {
        stage = "private delivery checkpoint read";
        return store.load();
      },
      save: (state) => {
        stage = "private delivery checkpoint save";
        return store.save(state);
      },
    },
    collect: (date) => {
      stage = "complete Jira history read";
      return collectDescriptionChangeReport({
        client,
        jiraBaseUrl: config.jiraBaseUrl,
        boardId: config.boardId,
        date,
        now,
        expectedUserId: config.expectedJiraAccountId,
      });
    },
    send: (part) => {
      stage = "Google Chat delivery";
      if (!send) throw new Error("Preview cannot send messages.");
      return send(part);
    },
    preview: (report) => {
      previews.push(report);
      return Promise.resolve();
    },
  });
  if (dryRun && process.env.REPORT_PREVIEW_PATH)
    await writeFile(process.env.REPORT_PREVIEW_PATH, JSON.stringify(previews, null, 2), {
      mode: 0o600,
    });
  // Jira rows, authors, credentials and webhook URLs never enter Actions logs.
  console.log(
    JSON.stringify({
      ...result,
      ...(dryRun
        ? { changedIssues: previews.reduce((sum, r) => sum + r.changedIssueCount, 0) }
        : {}),
    }),
  );
}
void main().catch(() => {
  console.error(
    `Description report stopped during ${stage}. No empty-success result or new untracked delivery was published. Check protected configuration, Jira access and the saved private checkpoint.`,
  );
  process.exitCode = 1;
});
