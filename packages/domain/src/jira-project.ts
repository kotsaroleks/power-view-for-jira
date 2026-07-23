export interface JiraProject {
  id: string;
  key: string;
  name: string;
  avatarUrl?: string;
  projectTypeKey?: string;
  simplified?: boolean;
}

export interface ProjectSearchOptions {
  query?: string;
  startAt?: number;
  maxResults?: number;
}
