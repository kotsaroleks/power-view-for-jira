import type { JiraPageContext } from "@power-view/domain";
import type { ExtensionRuntime } from "@power-view/extension-messaging";
import type { SettingsStore } from "@power-view/storage";

import { SetupPanel } from "../SetupPanel";
import type { WorkspaceContext } from "./WorkspaceContext";

/** Settings feature boundary. It is the sole owner of workspace selection and setup. */
export interface WorkspaceSettingsServiceProps {
  context: JiraPageContext;
  runtime: ExtensionRuntime;
  settingsStore?: SettingsStore;
  autoContinue: boolean;
  onDiagnosticsChanged?: () => void;
  onWorkspaceReady: (workspace: WorkspaceContext | undefined) => void;
  onSetupComplete: (workspace: WorkspaceContext) => void;
  onQuickStart: (workspace: WorkspaceContext) => void;
}

export function WorkspaceSettingsService({
  onWorkspaceReady,
  ...props
}: WorkspaceSettingsServiceProps) {
  return <SetupPanel {...props} onScheduleReady={onWorkspaceReady} />;
}
