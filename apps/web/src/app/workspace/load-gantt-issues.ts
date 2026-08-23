import type { FieldMapping, NormalizedIssue } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";

export interface LoadGanttIssuesOptions {
  client: JiraClient;
  boardId: string;
  boardIssues: readonly NormalizedIssue[];
  fieldMapping: FieldMapping;
  signal?: AbortSignal;
}

function quoteJqlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function referencedParentKeys(issues: readonly NormalizedIssue[]): string[] {
  const loadedKeys = new Set(issues.map((issue) => issue.key));
  const keys = new Set<string>();
  issues.forEach((issue) => {
    const parentKey = issue.parentKey ?? issue.epicKey;
    if (parentKey && !loadedKeys.has(parentKey)) keys.add(parentKey);
  });
  return [...keys];
}

function isEpic(issue: NormalizedIssue): boolean {
  return (
    issue.issueType.hierarchyLevel === 1 ||
    issue.issueType.name.trim().toLocaleLowerCase() === "epic"
  );
}

/**
 * Adds only the exact Jira parents referenced by board issues. Reports continue to use
 * the original boardIssues collection; this enriched collection belongs to Gantt only.
 */
export async function loadGanttIssues({
  client,
  boardId,
  boardIssues,
  fieldMapping,
  signal,
}: LoadGanttIssuesOptions): Promise<NormalizedIssue[]> {
  const parentKeys = referencedParentKeys(boardIssues);
  if (parentKeys.length === 0) return [...boardIssues];

  const [boardEpics, hydratedResult] = await Promise.all([
    client.getBoardEpics(boardId, signal),
    client.searchIssues(
      {
        jql: `key in (${parentKeys.map(quoteJqlString).join(", ")})`,
        fieldMapping,
        maxIssues: parentKeys.length,
        pageSize: 100,
      },
      signal,
    ),
  ]);
  const requestedKeys = new Set(parentKeys);
  const boardEpicKeys = new Set(boardEpics.map((epic) => epic.key));
  const hydratedParents = hydratedResult.values.flatMap((issue) => {
    if (!requestedKeys.has(issue.key)) return [];
    return [
      boardEpicKeys.has(issue.key) || !isEpic(issue)
        ? issue
        : { ...issue, isExternalBoardEpic: true as const },
    ];
  });

  return [...boardIssues, ...hydratedParents];
}
