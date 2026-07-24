export { ContextStore, type StorageArea, type StoredJiraContext } from "./context-store";
export { DiagnosticsStore, type DiagnosticsState } from "./diagnostics-store";
export { SettingsStore, type GanttViewPreferences } from "./settings-store";
export { UpdateStore } from "./update-store";

export const CURRENT_STORAGE_SCHEMA_VERSION = 3;
export type StorageSchemaVersion = typeof CURRENT_STORAGE_SCHEMA_VERSION;
