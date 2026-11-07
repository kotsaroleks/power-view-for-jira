import {
  buildDescriptionChangeReport,
  descriptionCandidateJql,
  descriptionReportPeriod,
  type DescriptionChangeReport,
  type ReportingIssueSnapshot,
} from "@power-view/domain";
import type { JiraClient } from "./JiraClient";

export type DescriptionReportClient = Pick<
  JiraClient,
  | "getBoard"
  | "getBoardIssues"
  | "getIssueChangelogs"
  | "getReportIssue"
  | "getCurrentUser"
>;

/** Fully read-only. Incomplete history or ancestry never becomes an empty/success report. */
export async function collectDescriptionChangeReport(input: {
  client: DescriptionReportClient;
  jiraBaseUrl: string;
  boardId: string;
  date: string;
  now?: Date;
  expectedUserId?: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<DescriptionChangeReport> {
  const { client, signal } = input;
  const now = input.now ?? new Date();
  const period = descriptionReportPeriod(input.date);
  if (Date.parse(period.end) > now.getTime())
    throw new Error("This report period has not ended at 21:00 Kyiv yet.");
  if (!/^\d+$/.test(input.boardId)) throw new Error("Select a Jira board.");
  const check = () => signal?.throwIfAborted();
  check();
  const user = await client.getCurrentUser(signal);
  if (input.expectedUserId && user.accountId !== input.expectedUserId)
    throw new Error("The Jira account changed. Report generation was stopped.");
  const board = await client.getBoard(input.boardId, signal);
  const issues = new Map<string, ReportingIssueSnapshot>();
  const cursors = new Set<string>();
  let cursor: string | number | undefined;
  for (;;) {
    check();
    input.onProgress?.("Reading updated issues…");
    const page = await client.getBoardIssues(
      {
        boardId: input.boardId,
        jql: descriptionCandidateJql(period),
        fieldsOverride: ["summary", "parent", "issuetype", "updated"],
        pageSize: 100,
        ...(cursor === undefined ? {} : { cursor }),
      },
      signal,
    );
    if (page.truncated || page.total > 5000)
      throw new Error(
        "The board exceeds the report's 5,000-issue read limit. Narrow its saved filter.",
      );
    const before = issues.size;
    for (const issue of page.values) issues.set(issue.id, issue);
    if (issues.size > 5000) throw new Error("The report issue limit was exceeded.");
    if (page.isLast) {
      if (issues.size < page.total)
        throw new Error("Jira returned an incomplete issue list. Retry the report.");
      break;
    }
    if (
      page.nextCursor === undefined ||
      cursors.has(String(page.nextCursor)) ||
      before === issues.size
    )
      throw new Error("Jira issue pagination did not complete. Retry the report.");
    cursor = page.nextCursor;
    cursors.add(String(cursor));
  }
  check();
  input.onProgress?.("Reading description history…");
  const changes = (
    await client.getIssueChangelogs({
      issues: [...issues.values()].map(({ id, key }) => ({ id, key })),
      requireComplete: true,
      ...(signal ? { signal } : {}),
      onProgress: (done, total) =>
        input.onProgress?.(`Reading issue history: ${done}/${total}`),
    })
  ).filter((event) => event.type === "description-changed");
  const changed = new Set(
    changes
      .filter((event) => {
        const time = Date.parse(event.occurredAt);
        if (!Number.isFinite(time))
          throw new Error("Jira returned an invalid change time.");
        return time >= Date.parse(period.start) && time < Date.parse(period.end);
      })
      .map((event) => event.issueId),
  );
  const pending = [...changed]
    .map((id) => issues.get(id))
    .filter((issue): issue is ReportingIssueSnapshot => issue !== undefined);
  const checked = new Set<string>();
  while (pending.length) {
    check();
    const issue = pending.shift()!;
    if (checked.has(issue.id)) continue;
    checked.add(issue.id);
    if (checked.size > 5500) throw new Error("The report hierarchy limit was exceeded.");
    const reference = issue.parentKey ?? issue.parentId;
    if (!reference) continue;
    let parent = [...issues.values()].find(
      (candidate) => candidate.id === issue.parentId || candidate.key === issue.parentKey,
    );
    if (!parent) {
      input.onProgress?.("Reading parent tasks…");
      parent = await client.getReportIssue(reference, signal);
      if (
        (issue.parentId && parent.id !== issue.parentId) ||
        (issue.parentKey && parent.key !== issue.parentKey)
      )
        throw new Error("Jira returned an unexpected parent task.");
      issues.set(parent.id, parent);
    }
    pending.push(parent);
  }
  check();
  const current = await client.getCurrentUser(signal);
  if (current.accountId !== user.accountId)
    throw new Error("The Jira account changed. Report generation was stopped.");
  check();
  return buildDescriptionChangeReport({
    jiraBaseUrl: input.jiraBaseUrl,
    boardId: board.id,
    boardName: board.name,
    period,
    generatedAt: now.toISOString(),
    issues: [...issues.values()],
    events: changes,
  });
}
