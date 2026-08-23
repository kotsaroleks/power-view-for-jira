import type {
  FieldMapping,
  GanttScheduleModel,
  JiraBoard,
  NormalizedIssue,
} from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";

/**
 * The only data contract Settings gives to Reports and Gantt.
 *
 * It intentionally contains no SettingsStore, setters, or selection callbacks:
 * downstream services consume a fixed board workspace and cannot change it.
 */
export interface WorkspaceContext {
  readonly scope: Readonly<{ kind: "board"; boardId: string }>;
  readonly model: GanttScheduleModel;
  readonly nonWorkingDays: readonly number[];
  readonly issues: readonly NormalizedIssue[];
  readonly queryKey: string;
  readonly jiraBaseUrl: string;
  readonly projectKey: string;
  readonly projectName: string;
  readonly board: Omit<JiraBoard, "projectKeys"> & {
    readonly projectKeys: readonly string[];
  };
  readonly reporting: Readonly<{
    completedStatusIds: readonly string[];
    completedStatusNames: readonly string[];
  }>;
  readonly jql: string;
  readonly loadedAt: string;
  readonly truncated: boolean;
  readonly sprintDataAvailable: boolean;
  readonly storyPointsDataAvailable: boolean;
  readonly editing: Readonly<{
    client: JiraClient;
    fieldMapping: FieldMapping;
    refresh: () => Promise<void>;
  }>;
}

export type WorkspaceContextInput = Omit<WorkspaceContext, "scope">;

export function createWorkspaceContext(input: WorkspaceContextInput): WorkspaceContext {
  const board = Object.freeze({
    ...input.board,
    projectKeys: Object.freeze([...input.board.projectKeys]),
  });
  const scope = Object.freeze({ kind: "board" as const, boardId: board.id });

  return Object.freeze({
    ...input,
    scope,
    board,
    issues: Object.freeze([...input.issues]),
    nonWorkingDays: Object.freeze([...input.nonWorkingDays]),
    reporting: Object.freeze({
      completedStatusIds: Object.freeze([...input.reporting.completedStatusIds]),
      completedStatusNames: Object.freeze([...input.reporting.completedStatusNames]),
    }),
    editing: Object.freeze({
      ...input.editing,
      fieldMapping: Object.freeze({ ...input.editing.fieldMapping }),
    }),
  });
}
