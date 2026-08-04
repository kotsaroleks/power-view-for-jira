import type {
  JiraBoard,
  JiraSprint,
  ReportChangeEvent,
  ReportingIssueSnapshot,
  ReportWorklog,
} from "@power-view/domain";

export interface JiraBoardConfiguration {
  id: string;
  name: string;
  filterId?: string;
  statusIds: string[];
  storyPointsFieldId?: string;
}

export interface JiraBoardPage {
  values: JiraBoard[];
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
}

export interface JiraSprintPage {
  values: JiraSprint[];
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
}

export interface ReportingIssuePage {
  values: ReportingIssueSnapshot[];
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
  nextCursor?: string | number;
  truncated?: boolean;
}

export interface GetBoardsRequest {
  startAt?: number;
  maxResults?: number;
  projectKeyOrId?: string;
}

export interface GetBoardIssuesRequest {
  boardId: string;
  jql?: string;
  fields?: string[];
  pageSize?: number;
  cursor?: string | number;
  storyPointsFieldId?: string;
}

export interface GetBoardSprintsRequest {
  boardId: string;
  state?: Array<"future" | "active" | "closed">;
  startAt?: number;
  maxResults?: number;
}

export interface GetSprintIssuesRequest extends GetBoardIssuesRequest {
  sprintId: string;
}

export interface GetIssueChangelogsRequest {
  issues: Array<{ id: string; key: string }>;
  storyPointsFieldId?: string;
  sprintId?: string;
  completedStatusIds?: string[];
  completedStatusNames?: string[];
  signal?: AbortSignal;
}

export interface GetIssueWorklogsRequest {
  issues: Array<{ id: string; key: string }>;
  periodStart?: string;
  periodEnd?: string;
  signal?: AbortSignal;
}

export interface ReportingJiraClient {
  getBoards(request?: GetBoardsRequest, signal?: AbortSignal): Promise<JiraBoardPage>;
  getBoard(boardId: string, signal?: AbortSignal): Promise<JiraBoard>;
  getBoardConfiguration(
    boardId: string,
    signal?: AbortSignal,
  ): Promise<JiraBoardConfiguration>;
  getBoardIssues(
    request: GetBoardIssuesRequest,
    signal?: AbortSignal,
  ): Promise<ReportingIssuePage>;
  getBoardSprints(
    request: GetBoardSprintsRequest,
    signal?: AbortSignal,
  ): Promise<JiraSprintPage>;
  getSprint(sprintId: string, signal?: AbortSignal): Promise<JiraSprint>;
  getSprintIssues(
    request: GetSprintIssuesRequest,
    signal?: AbortSignal,
  ): Promise<ReportingIssuePage>;
  getIssueChangelogs(request: GetIssueChangelogsRequest): Promise<ReportChangeEvent[]>;
  getIssueWorklogs(request: GetIssueWorklogsRequest): Promise<ReportWorklog[]>;
}
