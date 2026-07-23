import type { JiraDeploymentType } from "./jira-context";

export interface JiraServerInfo {
  baseUrl: string;
  deploymentType: JiraDeploymentType;
  version?: string;
  versionNumbers: number[];
  buildNumber?: number;
  serverTitle?: string;
  serverTime?: string;
}
