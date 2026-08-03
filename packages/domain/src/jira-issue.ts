import type { FieldMapping } from "./jira-field";
import type { JiraUser } from "./jira-user";
import type { PaginatedResult } from "./pagination";

export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
  hierarchyLevel?: number;
  iconUrl?: string;
}

export type JiraStatusCategory = "to-do" | "in-progress" | "done" | "unknown";

export type JiraSprintState = "active" | "future" | "closed" | "unknown";

export interface JiraSprint {
  id: string;
  name: string;
  state: JiraSprintState;
  boardId?: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
}

export interface NormalizedIssueLink {
  id?: string;
  typeName: string;
  direction: "inward" | "outward";
  linkedIssueKey: string;
  relationshipText?: string;
  semanticType:
    | "blocks"
    | "is-blocked-by"
    | "relates-to"
    | "duplicates"
    | "is-duplicated-by"
    | "depends-on"
    | "finish-to-finish"
    | "unknown";
}

export interface NormalizedIssue {
  id: string;
  key: string;
  selfUrl?: string;
  browseUrl: string;
  summary: string;
  descriptionText?: string;
  issueType: JiraIssueType;
  status: {
    id?: string;
    name: string;
    category?: JiraStatusCategory;
  };
  priority?: { id?: string; name: string };
  assignee?: JiraUser;
  reporter?: JiraUser;
  project: { id: string; key: string; name?: string };
  parentKey?: string;
  epicKey?: string;
  createdAt?: string;
  updatedAt?: string;
  startDate?: string;
  dueDate?: string;
  resolvedAt?: string;
  storyPoints?: number;
  sprints?: JiraSprint[];
  progress?: {
    completed: number;
    total: number;
    percentage: number;
    source: "jira-progress" | "subtasks" | "status" | "none";
  };
  labels: string[];
  components: string[];
  fixVersions: string[];
  issueLinks: NormalizedIssueLink[];
  rawFieldPresence: {
    hasStartDate: boolean;
    hasDueDate: boolean;
    hasParent: boolean;
    hasEpic: boolean;
  };
}

export interface PageProgress {
  loaded: number;
  total?: number;
  page: number;
}

export interface SearchIssuesRequest {
  jql: string;
  fieldMapping?: FieldMapping;
  maxIssues?: number;
  pageSize?: number;
  forceRefresh?: boolean;
  onProgress?: (progress: PageProgress) => void;
}

export interface IssueSearchResult extends PaginatedResult<NormalizedIssue> {
  truncated: boolean;
  fromCache: boolean;
}

export const DEFAULT_MAX_ISSUES = 1_000;
export const MAX_CONFIGURABLE_ISSUES = 5_000;
