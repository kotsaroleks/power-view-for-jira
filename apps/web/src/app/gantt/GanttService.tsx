import type { SettingsStore } from "@power-view/storage";

import type { WorkspaceContext } from "../workspace/WorkspaceContext";
import { GanttView } from "./GanttView";

/** Gantt feature boundary. It edits issues in its supplied board workspace only. */
export interface GanttServiceProps {
  workspace: WorkspaceContext;
  settingsStore?: SettingsStore;
}

export function GanttService({ workspace, settingsStore }: GanttServiceProps) {
  return (
    <GanttView
      key={workspace.queryKey}
      model={workspace.model}
      nonWorkingDays={[...workspace.nonWorkingDays]}
      editing={{
        ...workspace.editing,
        fieldMapping: { ...workspace.editing.fieldMapping },
      }}
      {...(settingsStore
        ? {
            filterPersistence: {
              store: settingsStore,
              jiraBaseUrl: workspace.jiraBaseUrl,
              workspaceKey: `${workspace.projectKey}:${workspace.scope.boardId}`,
            },
          }
        : {})}
    />
  );
}
