export type JiraDeploymentType = "cloud" | "data-center" | "server" | "unknown";

export type ContextDetectionSource = "url" | "meta" | "dom" | "page-state" | "user-input";

export interface JiraPageContext {
  baseUrl: string;
  pageUrl: string;
  detectedAt: string;

  deploymentType: JiraDeploymentType;

  projectKey?: string;
  projectId?: string;
  issueKey?: string;
  boardId?: string;
  sprintId?: string;
  filterId?: string;
  jql?: string;

  detectionSources: ContextDetectionSource[];
}
