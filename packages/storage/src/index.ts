export { ContextStore, type StorageArea, type StoredJiraContext } from "./context-store";
export { DiagnosticsStore, type DiagnosticsState } from "./diagnostics-store";
export { SettingsStore, type GanttViewPreferences } from "./settings-store";
export {
  IndexedDbReportHistoryStore,
  MemoryReportHistoryStore,
  type ReportHistoryFilter,
  type ReportHistoryItem,
  type ReportHistoryStore,
} from "./report-history-store";
export {
  IndexedDbJiraHistoryCache,
  MemoryJiraHistoryCache,
  isFreshCacheRecord,
  jiraHistoryCacheKey,
  MAX_CACHE_RECORD_AGE_MS,
  type ChangelogCacheRecord,
  type JiraHistoryCache,
  type JiraHistoryCacheRecord,
  type JiraHistoryCacheStoreName,
  type WorklogCacheRecord,
} from "./jira-history-cache";
export { UpdateStore } from "./update-store";

export const CURRENT_STORAGE_SCHEMA_VERSION = 3;
export type StorageSchemaVersion = typeof CURRENT_STORAGE_SCHEMA_VERSION;
