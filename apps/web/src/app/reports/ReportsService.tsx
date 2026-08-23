import type { JiraPageContext } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";

import { ReportsView } from "../reporting/ReportsView";
import { BoardHealthReportView } from "./BoardHealthReport";
import type { WorkspaceContext } from "../workspace/WorkspaceContext";

/** Reports feature boundary. It consumes, but never selects or changes, a workspace. */
export interface ReportsServiceProps {
  workspace: WorkspaceContext;
  pageContext: JiraPageContext;
  client: JiraClient;
}

export function ReportsService({ workspace, pageContext, client }: ReportsServiceProps) {
  const board = {
    ...workspace.board,
    projectKeys: [...workspace.board.projectKeys],
  };

  return (
    <>
      <BoardHealthReportView
        issues={[...workspace.issues]}
        model={workspace.model}
        projectKey={workspace.projectKey}
        projectName={workspace.projectName}
        jql={workspace.jql}
        loadedAt={workspace.loadedAt}
        truncated={workspace.truncated}
        sprintDataAvailable={workspace.sprintDataAvailable}
        storyPointsDataAvailable={workspace.storyPointsDataAvailable}
        completedStatusIds={[...workspace.reporting.completedStatusIds]}
        completedStatusNames={[...workspace.reporting.completedStatusNames]}
        preferredBoardId={workspace.scope.boardId}
        {...(pageContext.boardId === workspace.scope.boardId && pageContext.sprintId
          ? { preferredSprintId: pageContext.sprintId }
          : {})}
      />
      <ReportsView
        client={client}
        baseUrl={workspace.jiraBaseUrl}
        deploymentType={pageContext.deploymentType}
        board={board}
        issues={[...workspace.issues]}
        jql={workspace.jql}
        statusMapping={{
          schemaVersion: 1,
          jiraBaseUrl: workspace.jiraBaseUrl,
          boardId: workspace.scope.boardId,
          completedStatusIds: [...workspace.reporting.completedStatusIds],
          completedStatusNames: [...workspace.reporting.completedStatusNames],
          ...(workspace.editing.fieldMapping.storyPointsFieldId
            ? { storyPointsFieldId: workspace.editing.fieldMapping.storyPointsFieldId }
            : {}),
          ...(workspace.editing.fieldMapping.sprintFieldId
            ? { sprintFieldId: workspace.editing.fieldMapping.sprintFieldId }
            : {}),
          updatedAt: workspace.loadedAt,
        }}
      />
    </>
  );
}
