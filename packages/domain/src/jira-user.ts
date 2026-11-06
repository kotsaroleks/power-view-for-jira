export interface JiraUser {
  accountId?: string;
  username?: string;
  /** Stable Jira Server/Data Center user key. */
  key?: string;
  displayName: string;
  timeZone?: string;
  emailAddress?: string;
  avatarUrl?: string;
}
