import type { NormalizedIssue } from "@power-view/domain";

const STATUS_COLORS = [
  "#0c66e4",
  "#22a06b",
  "#7e57c2",
  "#e56910",
  "#c9372c",
  "#1d7a8c",
  "#8f5c00",
  "#5e6c84",
  "#b65c9a",
  "#6a9a23",
] as const;

export interface StatusDistributionItem {
  key: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
}

function statusKey(issue: NormalizedIssue): string {
  return issue.status.id ?? issue.status.name.trim().toLocaleLowerCase();
}

export function buildStatusDistribution(
  issues: readonly NormalizedIssue[],
): StatusDistributionItem[] {
  const statuses = new Map<string, { label: string; count: number }>();

  for (const issue of issues) {
    const key = statusKey(issue);
    const current = statuses.get(key);
    if (current) {
      current.count += 1;
    } else {
      statuses.set(key, { label: issue.status.name, count: 1 });
    }
  }

  return [...statuses.entries()]
    .sort((left, right) => {
      const countDifference = right[1].count - left[1].count;
      return countDifference || left[1].label.localeCompare(right[1].label);
    })
    .map(([key, status], index) => ({
      key,
      label: status.label,
      count: status.count,
      percentage: issues.length === 0 ? 0 : (status.count / issues.length) * 100,
      color: STATUS_COLORS[index % STATUS_COLORS.length]!,
    }));
}
