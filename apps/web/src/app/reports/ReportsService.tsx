import type { JiraPageContext } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import { useState, type ReactNode } from "react";

import "../time-report/time-report.css";

import { ReportsView } from "../reporting/ReportsView";
import { BoardHealthReportView } from "./BoardHealthReport";
import type { WorkspaceContext } from "../workspace/WorkspaceContext";

/** Reports feature boundary. It consumes, but never selects or changes, a workspace. */
export interface ReportsServiceProps {
  workspace: WorkspaceContext;
  pageContext: JiraPageContext;
  client: JiraClient;
  timeReport?: ReactNode;
}

export function ReportsService({
  workspace,
  pageContext,
  client,
  timeReport,
}: ReportsServiceProps) {
  const [tab, setTab] = useState<"existing" | "time">("existing");
  const board = {
    ...workspace.board,
    projectKeys: [...workspace.board.projectKeys],
  };

  return (
    <>
      <div className="reports-service-tabs" role="tablist" aria-label="Reports">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "existing"}
          aria-controls="existing-reports-panel"
          id="existing-reports-tab"
          onClick={() => setTab("existing")}
        >
          Existing Reports
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "time"}
          aria-controls="time-report-panel"
          id="time-report-tab"
          onClick={() => setTab("time")}
        >
          Time Report
        </button>
      </div>
      <div
        role="tabpanel"
        id="existing-reports-panel"
        aria-labelledby="existing-reports-tab"
        hidden={tab !== "existing"}
      >
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
      </div>
      {tab === "time" ? (
        <div role="tabpanel" id="time-report-panel" aria-labelledby="time-report-tab">
          {timeReport ?? <p>Time Report requires a Jira Cloud connection.</p>}
        </div>
      ) : null}
    </>
  );
}
