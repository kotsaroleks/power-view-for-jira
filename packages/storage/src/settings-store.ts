import {
  DEFAULT_GANTT_FILTERS,
  type GanttFilters,
  type SetupConfiguration,
} from "@power-view/domain";
import { z } from "zod";

import type { StorageArea } from "./context-store";

const LEGACY_SETTINGS_KEY = "settings:v1";
const SETTINGS_KEY = "settings:v2";
const MAX_RECENT_JQL = 10;

export interface GanttViewPreferences {
  zoom: "day" | "week" | "month";
}

const jiraProjectSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    name: z.string().min(1).max(512),
    avatarUrl: z.url().optional(),
    projectTypeKey: z.string().max(128).optional(),
    simplified: z.boolean().optional(),
  })
  .strict();

const fieldMappingSchema = z
  .object({
    startDateFieldId: z.string().min(1).max(512).optional(),
    endDateFieldId: z.string().min(1).max(512).optional(),
    hierarchyFieldId: z.string().min(1).max(512).optional(),
    storyPointsFieldId: z.string().min(1).max(512).optional(),
    sprintFieldId: z.string().min(1).max(512).optional(),
  })
  .strict();

const defaultDurationsSchema = z
  .object({
    subtask: z.number().int().min(1).max(365),
    task: z.number().int().min(1).max(365),
    bug: z.number().int().min(1).max(365),
    story: z.number().int().min(1).max(365),
    epic: z.number().int().min(1).max(365),
    unknown: z.number().int().min(1).max(365),
  })
  .strict();

const jiraBoardSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(512),
    type: z.enum(["scrum", "kanban", "simple", "unknown"]),
    projectKeys: z.array(z.string().min(1).max(255)).max(100),
  })
  .strict();

const reportingConfigurationSchema = z
  .object({
    completedStatusIds: z.array(z.string().min(1).max(512)).max(100),
    completedStatusNames: z.array(z.string().min(1).max(512)).max(100),
  })
  .strict();

const ganttDateFilterSchema = z.enum([
  "explicit",
  "partial",
  "inferred",
  "corrected",
  "overdue",
]);

const legacyMultiValueGanttFiltersSchema = z
  .object({
    search: z.string().max(512),
    statuses: z.array(z.string().min(1).max(512)).max(100),
    statusCategories: z.array(z.enum(["to-do", "in-progress", "done", "unknown"])).max(4),
    assignees: z.array(z.string().min(1).max(512)).max(500),
    issueTypes: z.array(z.string().min(1).max(512)).max(100),
    dateFilters: z.array(ganttDateFilterSchema).max(5),
    logic: z.enum(["and", "or"]),
    includeDescendants: z.boolean(),
  })
  .strict();

const multiValueGanttFiltersSchema = legacyMultiValueGanttFiltersSchema
  .extend({
    priorities: z.array(z.string().min(1).max(512)).max(100),
    labels: z.array(z.string().min(1).max(512)).max(500),
    riskFilters: z.array(z.enum(["blocked", "unresolved"])).max(2),
  })
  .strict();

const legacyGanttFiltersSchema = z
  .object({
    search: z.string().max(512),
    status: z.string().max(512),
    statusCategory: z.enum(["", "to-do", "in-progress", "done", "unknown"]),
    assignee: z.string().max(512),
    issueType: z.string().max(512),
    dateFilter: z.enum([
      "all",
      "explicit",
      "partial",
      "inferred",
      "corrected",
      "overdue",
    ]),
    includeDescendants: z.boolean(),
  })
  .strict();

const legacyStoredGanttFiltersSchema = z
  .union([legacyMultiValueGanttFiltersSchema, legacyGanttFiltersSchema])
  .transform((filters): GanttFilters => {
    if ("statuses" in filters) {
      return {
        ...DEFAULT_GANTT_FILTERS,
        search: filters.search,
        statuses: [...filters.statuses],
        statusCategories: [...filters.statusCategories],
        assignees: [...filters.assignees],
        issueTypes: [...filters.issueTypes],
        dateFilters: [...filters.dateFilters],
        logic: filters.logic,
        includeDescendants: filters.includeDescendants,
      };
    }

    return {
      ...DEFAULT_GANTT_FILTERS,
      search: filters.search,
      statuses: filters.status ? [filters.status] : [],
      statusCategories: filters.statusCategory ? [filters.statusCategory] : [],
      assignees: filters.assignee ? [filters.assignee] : [],
      issueTypes: filters.issueType ? [filters.issueType] : [],
      dateFilters: filters.dateFilter === "all" ? [] : [filters.dateFilter],
      includeDescendants: filters.includeDescendants,
    };
  });

const ganttFiltersSchema = multiValueGanttFiltersSchema.transform(
  (filters): GanttFilters => ({
    search: filters.search,
    statuses: [...filters.statuses],
    statusCategories: [...filters.statusCategories],
    assignees: [...filters.assignees],
    issueTypes: [...filters.issueTypes],
    priorities: [...filters.priorities],
    labels: [...filters.labels],
    dateFilters: [...filters.dateFilters],
    riskFilters: [...filters.riskFilters],
    logic: filters.logic,
    includeDescendants: filters.includeDescendants,
  }),
);

const setupConfigurationSchema = z
  .object({
    jiraBaseUrl: z.url().max(2048),
    project: jiraProjectSchema,
    boardId: z.string().min(1).optional(),
    board: jiraBoardSchema.optional(),
    jql: z.string().min(1).max(10_000),
    fieldMapping: fieldMappingSchema,
    reporting: reportingConfigurationSchema.optional(),
    defaultDurations: defaultDurationsSchema.optional(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .transform((configuration): SetupConfiguration => ({
    jiraBaseUrl: configuration.jiraBaseUrl,
    project: {
      id: configuration.project.id,
      key: configuration.project.key,
      name: configuration.project.name,
      ...(configuration.project.avatarUrl
        ? { avatarUrl: configuration.project.avatarUrl }
        : {}),
      ...(configuration.project.projectTypeKey
        ? { projectTypeKey: configuration.project.projectTypeKey }
        : {}),
      ...(configuration.project.simplified === undefined
        ? {}
        : { simplified: configuration.project.simplified }),
    },
    jql: configuration.jql,
    ...(configuration.board
      ? {
          board: {
            ...configuration.board,
            projectKeys: [...configuration.board.projectKeys],
          },
        }
      : configuration.boardId
        ? {
            board: {
              id: configuration.boardId,
              name: `Board ${configuration.boardId}`,
              type: "unknown" as const,
              projectKeys: [configuration.project.key],
            },
          }
        : {}),
    fieldMapping: {
      ...(configuration.fieldMapping.startDateFieldId
        ? { startDateFieldId: configuration.fieldMapping.startDateFieldId }
        : {}),
      ...(configuration.fieldMapping.endDateFieldId
        ? { endDateFieldId: configuration.fieldMapping.endDateFieldId }
        : {}),
      ...(configuration.fieldMapping.hierarchyFieldId
        ? { hierarchyFieldId: configuration.fieldMapping.hierarchyFieldId }
        : {}),
      ...(configuration.fieldMapping.storyPointsFieldId
        ? { storyPointsFieldId: configuration.fieldMapping.storyPointsFieldId }
        : {}),
      ...(configuration.fieldMapping.sprintFieldId
        ? { sprintFieldId: configuration.fieldMapping.sprintFieldId }
        : {}),
    },
    ...(configuration.reporting
      ? {
          reporting: {
            completedStatusIds: [...configuration.reporting.completedStatusIds],
            completedStatusNames: [...configuration.reporting.completedStatusNames],
          },
        }
      : {}),
    ...(configuration.defaultDurations
      ? { defaultDurations: configuration.defaultDurations }
      : {}),
    updatedAt: configuration.updatedAt,
  }));

const legacySettingsStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    setups: z.record(z.string(), setupConfigurationSchema),
    recentJql: z.record(z.string(), z.array(z.string().min(1).max(10_000)).max(10)),
    ganttFilters: z
      .record(z.string(), legacyStoredGanttFiltersSchema)
      .optional()
      .default({}),
  })
  .strict();

const ganttViewPreferencesSchema = z
  .object({
    zoom: z.enum(["day", "week", "month"]),
  })
  .strict();

const settingsStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    setups: z.record(z.string(), setupConfigurationSchema),
    recentJql: z.record(z.string(), z.array(z.string().min(1).max(10_000)).max(10)),
    ganttFilters: z.record(z.string(), ganttFiltersSchema).optional().default({}),
    ganttViewPreferences: z
      .record(z.string(), ganttViewPreferencesSchema)
      .optional()
      .default({}),
  })
  .strict();

function normalizedBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function configurationKey(
  baseUrl: string,
  projectKey: string,
  boardId?: string,
): string {
  const key = `${encodeURIComponent(normalizedBaseUrl(baseUrl))}:${projectKey}`;
  return typeof boardId === "string" && boardId.length > 0
    ? `${key}:${boardId}`
    : key;
}

function preferenceKey(baseUrl: string, workspaceKey: string): string {
  return `${encodeURIComponent(normalizedBaseUrl(baseUrl))}:${workspaceKey}`;
}

export class SettingsStore {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly storage: StorageArea) {}

  async getSetup(
    baseUrl: string,
    projectKey: string,
    boardId?: string,
  ): Promise<SetupConfiguration | undefined> {
    await this.writes;
    const state = await this.read();
    return state.setups[configurationKey(baseUrl, projectKey, boardId)];
  }

  saveSetup(configuration: SetupConfiguration): Promise<void> {
    const write = this.writes.then(async () => {
      const state = await this.read();
      const key = configurationKey(
        configuration.jiraBaseUrl,
        configuration.project.key,
        configuration.board?.id,
      );
      const jql = configuration.jql.trim();
      const recent = state.recentJql[key] ?? [];
      const value = settingsStateSchema.parse({
        schemaVersion: 2,
        setups: {
          ...state.setups,
          [key]: { ...configuration, jql },
        },
        recentJql: {
          ...state.recentJql,
          [key]: [jql, ...recent.filter((query) => query !== jql)].slice(
            0,
            MAX_RECENT_JQL,
          ),
        },
        ganttFilters: state.ganttFilters,
        ganttViewPreferences: state.ganttViewPreferences,
      });
      await this.storage.set({ [SETTINGS_KEY]: value });
    });

    this.writes = write.catch(() => undefined);
    return write;
  }

  async getRecentJql(
    baseUrl: string,
    projectKey: string,
    boardId?: string,
  ): Promise<string[]> {
    await this.writes;
    const state = await this.read();
    return [...(state.recentJql[configurationKey(baseUrl, projectKey, boardId)] ?? [])];
  }

  async getGanttFilters(
    baseUrl: string,
    workspaceKey: string,
  ): Promise<GanttFilters | undefined> {
    await this.writes;
    const state = await this.read();
    return state.ganttFilters[preferenceKey(baseUrl, workspaceKey)];
  }

  saveGanttFilters(
    baseUrl: string,
    workspaceKey: string,
    filters: GanttFilters,
  ): Promise<void> {
    const write = this.writes.then(async () => {
      const state = await this.read();
      const key = preferenceKey(baseUrl, workspaceKey);
      const value = settingsStateSchema.parse({
        ...state,
        ganttFilters: {
          ...state.ganttFilters,
          [key]: filters,
        },
      });
      await this.storage.set({ [SETTINGS_KEY]: value });
    });

    this.writes = write.catch(() => undefined);
    return write;
  }

  async getGanttViewPreferences(
    baseUrl: string,
    workspaceKey: string,
  ): Promise<GanttViewPreferences | undefined> {
    await this.writes;
    const state = await this.read();
    return state.ganttViewPreferences[preferenceKey(baseUrl, workspaceKey)];
  }

  saveGanttViewPreferences(
    baseUrl: string,
    workspaceKey: string,
    preferences: GanttViewPreferences,
  ): Promise<void> {
    const write = this.writes.then(async () => {
      const state = await this.read();
      const key = preferenceKey(baseUrl, workspaceKey);
      const value = settingsStateSchema.parse({
        ...state,
        ganttViewPreferences: {
          ...state.ganttViewPreferences,
          [key]: preferences,
        },
      });
      await this.storage.set({ [SETTINGS_KEY]: value });
    });

    this.writes = write.catch(() => undefined);
    return write;
  }

  private async read(): Promise<z.infer<typeof settingsStateSchema>> {
    const result = await this.storage.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
    const parsed = settingsStateSchema.safeParse(result[SETTINGS_KEY]);
    if (parsed.success) {
      return parsed.data;
    }

    const legacy = legacySettingsStateSchema.safeParse(result[LEGACY_SETTINGS_KEY]);
    if (legacy.success) {
      const migrated = settingsStateSchema.parse({
        schemaVersion: 2,
        setups: legacy.data.setups,
        recentJql: legacy.data.recentJql,
        ganttFilters: legacy.data.ganttFilters,
        ganttViewPreferences: {},
      });
      await this.storage.set({ [SETTINGS_KEY]: migrated });
      return migrated;
    }

    return {
      schemaVersion: 2,
      setups: {},
      recentJql: {},
      ganttFilters: {},
      ganttViewPreferences: {},
    };
  }
}
