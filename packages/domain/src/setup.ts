import type { FieldMapping } from "./jira-field";
import type { JiraProject } from "./jira-project";
import type { DefaultDurationDays } from "./schedule";

const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export interface SetupConfiguration {
  jiraBaseUrl: string;
  project: JiraProject;
  boardId?: string;
  jql: string;
  fieldMapping: FieldMapping;
  defaultDurations?: DefaultDurationDays;
  updatedAt: string;
}

export function buildDefaultProjectJql(projectKey: string): string {
  if (!PROJECT_KEY_PATTERN.test(projectKey)) {
    throw new Error("A valid Jira project key is required to build default JQL.");
  }
  return `project = "${projectKey}" ORDER BY Rank ASC`;
}

export function buildDefaultBoardJql(filterId: string): string {
  if (!/^\d+$/.test(filterId)) {
    throw new Error("A valid Jira filter ID is required to build board JQL.");
  }
  return `filter = ${filterId} ORDER BY Rank ASC`;
}

export function validateJqlInput(jql: string): string[] {
  const trimmed = jql.trim();
  const errors: string[] = [];

  if (!trimmed) {
    errors.push("Enter a JQL query before saving setup.");
  }
  if (jql.length > 10_000) {
    errors.push("JQL must be 10,000 characters or fewer.");
  }
  if (/[^\P{Cc}\t\n\r]/u.test(jql)) {
    errors.push("JQL contains unsupported control characters.");
  }

  return errors;
}
