import type {
  FieldMapping,
  IssueSearchResult,
  JiraDeploymentType,
  JiraFieldSchema,
  JiraField,
  JiraProject,
  JiraServerInfo,
  JiraUser,
  PaginatedResult,
  ProjectSearchOptions,
  SearchIssuesRequest,
} from "@power-view/domain";

import { JiraCloudClient } from "./JiraCloudClient";
import { JiraDataCenterClient } from "./JiraDataCenterClient";
import type { JiraTransport } from "./JiraTransport";
import type { ReportingJiraClient } from "./reporting-api";

export interface JiraIssueEditField {
  id: string;
  name: string;
  required: boolean;
  operations: string[];
  schema?: JiraFieldSchema;
}

export interface JiraIssueEditMetadata {
  fields: Record<string, JiraIssueEditField>;
}

export interface JiraIssueLinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
}

export interface JiraStatus {
  id: string;
  name: string;
}

export interface UpdateIssueDatesRequest {
  fieldMapping?: FieldMapping;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface CreateIssueLinkRequest {
  typeName: string;
  inwardIssueKey: string;
  outwardIssueKey: string;
}

export interface JiraClient extends ReportingJiraClient {
  getCurrentUser(signal?: AbortSignal): Promise<JiraUser>;
  getServerInfo(signal?: AbortSignal): Promise<JiraServerInfo>;
  getProjects(
    options?: ProjectSearchOptions,
    signal?: AbortSignal,
  ): Promise<PaginatedResult<JiraProject>>;
  getFields(signal?: AbortSignal): Promise<JiraField[]>;
  getProjectStatuses(projectKeyOrId: string, signal?: AbortSignal): Promise<JiraStatus[]>;
  getStatuses(signal?: AbortSignal): Promise<JiraStatus[]>;
  searchIssues(
    request: SearchIssuesRequest,
    signal?: AbortSignal,
  ): Promise<IssueSearchResult>;
  getIssueEditMetadata(
    issueKey: string,
    signal?: AbortSignal,
  ): Promise<JiraIssueEditMetadata>;
  findAssignableUsers(
    issueKey: string,
    query?: string,
    signal?: AbortSignal,
  ): Promise<JiraUser[]>;
  assignIssue(
    issueKey: string,
    assignee: JiraUser | null,
    signal?: AbortSignal,
  ): Promise<void>;
  updateIssueDates(
    issueKey: string,
    request: UpdateIssueDatesRequest,
    signal?: AbortSignal,
  ): Promise<void>;
  getIssueLinkTypes(signal?: AbortSignal): Promise<JiraIssueLinkType[]>;
  createIssueLink(request: CreateIssueLinkRequest, signal?: AbortSignal): Promise<void>;
  deleteIssueLink(linkId: string, signal?: AbortSignal): Promise<void>;
  clearIssueCache(): void;
}

export interface JiraClientConfiguration {
  baseUrl: string;
  deploymentType: JiraDeploymentType;
}

export function createJiraClient(
  transport: JiraTransport,
  configuration: JiraClientConfiguration,
): JiraClient {
  return configuration.deploymentType === "cloud"
    ? new JiraCloudClient(transport, configuration.baseUrl)
    : new JiraDataCenterClient(
        transport,
        configuration.baseUrl,
        configuration.deploymentType,
      );
}
