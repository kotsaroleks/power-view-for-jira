import type { SerializableAppError } from "./errors";
import type { JiraServerInfo } from "./jira-server-info";
import type { JiraUser } from "./jira-user";

export type ConnectionState =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "authenticated";
      user: JiraUser;
      serverInfo: JiraServerInfo;
      connectedAt: string;
    }
  | { status: "error"; error: SerializableAppError };
