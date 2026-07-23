export { ContextStore, type StorageArea, type StoredJiraContext } from "./context-store";
export { DiagnosticsStore, type DiagnosticsState } from "./diagnostics-store";
export { SettingsStore, type GanttViewPreferences } from "./settings-store";

export const CURRENT_STORAGE_SCHEMA_VERSION = 2;
export type StorageSchemaVersion = typeof CURRENT_STORAGE_SCHEMA_VERSION;
