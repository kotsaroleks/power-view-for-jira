import type { WorklogPickerIssue } from "@power-view/jira-client";

export function isFavoriteParent(issue: WorklogPickerIssue) {
  return issue.hierarchyLevel === 1 || issue.typeName.toLowerCase() === "story";
}
export function pickerGroups(
  issues: WorklogPickerIssue[],
  accountId: string,
  parentKey: string,
) {
  const assigned = issues.filter((issue) => issue.assigneeId === accountId);
  const parent = issues.find((issue) => issue.key === parentKey);
  const children = issues.filter(
    (issue) => issue.parentKey === parentKey && !issue.subtask,
  );
  const others = issues.filter((issue) => issue.assigneeId !== accountId);
  if (!parent)
    return [
      { label: "Assigned to me", issues: assigned },
      { label: "Other issues", issues: others },
    ];
  const groups =
    parent.hierarchyLevel === 1
      ? children.map((child) => ({
          label: `Other issues · ${child.key} ${child.summary}`,
          issues: others.filter(
            (issue) => issue.subtask && issue.parentKey === child.key,
          ),
        }))
      : [
          {
            label: `Other issues · ${parent.key} ${parent.summary}`,
            issues: others.filter(
              (issue) => issue.subtask && issue.parentKey === parent.key,
            ),
          },
        ];
  return [{ label: "Assigned to me", issues: assigned }, ...groups];
}
