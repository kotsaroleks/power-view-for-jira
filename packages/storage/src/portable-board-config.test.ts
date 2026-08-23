import type { SetupConfiguration } from "@power-view/domain";
import { DEFAULT_DURATION_DAYS, DEFAULT_GANTT_FILTERS } from "@power-view/domain";
import { describe, expect, it } from "vitest";

import type { StorageArea } from "./context-store";
import { SettingsStore } from "./settings-store";

class MemoryStorage implements StorageArea {
  private readonly values = new Map<string, unknown>();

  get(keys: string | string[]): Promise<Record<string, unknown>> {
    const selected = Array.isArray(keys) ? keys : [keys];
    return Promise.resolve(
      Object.fromEntries(selected.map((key) => [key, this.values.get(key)])),
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.entries(items).forEach(([key, value]) => this.values.set(key, value));
    return Promise.resolve();
  }

  remove(keys: string | string[]): Promise<void> {
    const selected = Array.isArray(keys) ? keys : [keys];
    selected.forEach((key) => this.values.delete(key));
    return Promise.resolve();
  }
}

function setup(boardId = "7", jql = 'project = "POWER"'): SetupConfiguration {
  return {
    jiraBaseUrl: "https://example.atlassian.net",
    project: { id: "10000", key: "POWER", name: "Power View" },
    board: {
      id: boardId,
      name: `Delivery ${boardId}`,
      type: "scrum",
      projectKeys: ["POWER"],
    },
    jql,
    fieldMapping: {
      startDateFieldId: "customfield_10010",
      endDateFieldId: "duedate",
    },
    defaultDurations: DEFAULT_DURATION_DAYS,
    nonWorkingDays: [0, 6],
    updatedAt: "2026-08-22T09:00:00.000Z",
  };
}

const scope = {
  jiraBaseUrl: "https://example.atlassian.net",
  projectKey: "POWER",
  boardId: "7",
} as const;

describe("portable board configuration", () => {
  it("exports only the requested board with dependencies and reconciliation dates", async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.saveSetup(setup("7"));
    await store.saveSetup(setup("8", 'project = "POWER" AND labels = secondary'));
    await store.saveGanttFilters(scope.jiraBaseUrl, "POWER:7", {
      ...DEFAULT_GANTT_FILTERS,
      search: "release",
    });
    await store.saveGanttViewPreferences(scope.jiraBaseUrl, "POWER:7", {
      zoom: "week",
      sortBy: "startDate",
      sortDirection: "asc",
    });
    await store.saveGanttBoardState(scope.jiraBaseUrl, "POWER:7", {
      dependencies: [
        {
          id: "POWER-1:POWER-2:FS",
          predecessorIssueKey: "POWER-1",
          successorIssueKey: "POWER-2",
          type: "FS",
          lagWorkingDays: 0,
        },
      ],
      reconciledDates: {
        "POWER-1": { startDate: "2026-08-17", dueDate: "2026-08-21" },
      },
    });

    const exported = await store.exportBoardConfiguration(scope, {
      exportedAt: "2026-08-22T10:00:00.000Z",
    });

    expect(exported).toMatchObject({
      kind: "power-view-board-configuration",
      version: 1,
      exportedAt: "2026-08-22T10:00:00.000Z",
      board: {
        jiraBaseUrl: "https://example.atlassian.net",
        projectKey: "POWER",
        boardId: "7",
        boardName: "Delivery 7",
      },
      configuration: {
        setup: { board: { id: "7" } },
        ganttFilters: { search: "release" },
        ganttViewPreferences: { zoom: "week", sortBy: "startDate" },
        ganttBoardState: {
          dependencies: [{ type: "FS" }],
          reconciledDates: { "POWER-1": { dueDate: "2026-08-21" } },
        },
      },
    });
    expect(JSON.stringify(exported)).not.toMatch(/cookie|token|credential/i);
    expect(JSON.stringify(exported)).not.toContain("Delivery 8");
  });

  it("fully replaces matching-board configuration and keeps a recoverable backup", async () => {
    const source = new SettingsStore(new MemoryStorage());
    await source.saveSetup(setup("7", 'project = "POWER" AND status != Done'));
    await source.saveGanttBoardState(scope.jiraBaseUrl, "POWER:7", {
      dependencies: [
        {
          id: "new-dependency",
          predecessorIssueKey: "POWER-3",
          successorIssueKey: "POWER-4",
          type: "SS",
          lagWorkingDays: 2,
        },
      ],
      reconciledDates: {},
    });
    const file = await source.exportBoardConfiguration(scope, {
      exportedAt: "2026-08-22T10:00:00.000Z",
    });

    const target = new SettingsStore(new MemoryStorage());
    await target.saveSetup(setup("7", 'project = "POWER"'));
    await target.saveGanttBoardState(scope.jiraBaseUrl, "POWER:7", {
      dependencies: [
        {
          id: "old-dependency",
          predecessorIssueKey: "POWER-1",
          successorIssueKey: "POWER-2",
          type: "FS",
          lagWorkingDays: 0,
        },
      ],
      reconciledDates: {},
    });

    await target.importBoardConfiguration(scope, file, {
      importedAt: "2026-08-22T11:00:00.000Z",
    });

    await expect(target.getSetup(scope.jiraBaseUrl, "POWER", "7")).resolves.toMatchObject(
      { jql: 'project = "POWER" AND status != Done' },
    );
    await expect(
      target.getGanttBoardState(scope.jiraBaseUrl, "POWER:7"),
    ).resolves.toMatchObject({ dependencies: [{ id: "new-dependency", type: "SS" }] });
    await expect(target.getLatestBoardConfigurationBackup(scope)).resolves.toMatchObject({
      importedAt: "2026-08-22T11:00:00.000Z",
      configuration: {
        setup: { jql: 'project = "POWER"' },
        ganttBoardState: { dependencies: [{ id: "old-dependency" }] },
      },
    });
  });

  it("rejects malformed and different-board files without changing current state", async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.saveSetup(setup("7"));
    const before = await store.exportBoardConfiguration(scope, {
      exportedAt: "2026-08-22T10:00:00.000Z",
    });

    await expect(
      store.importBoardConfiguration(scope, { ...before, version: 999 }),
    ).rejects.toThrow(/format|version/i);
    await expect(
      store.importBoardConfiguration(scope, {
        ...before,
        board: { ...before.board, boardId: "8" },
      }),
    ).rejects.toThrow(/board/i);

    await expect(store.getSetup(scope.jiraBaseUrl, "POWER", "7")).resolves.toMatchObject({
      jql: 'project = "POWER"',
    });
    await expect(store.getLatestBoardConfigurationBackup(scope)).resolves.toBeUndefined();
  });

  it("rejects a cyclic dependency graph before changing current state", async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.saveSetup(setup("7"));
    await store.saveGanttBoardState(scope.jiraBaseUrl, "POWER:7", {
      dependencies: [
        {
          id: "existing-dependency",
          predecessorIssueKey: "POWER-3",
          successorIssueKey: "POWER-4",
          type: "SS",
          lagWorkingDays: 0,
        },
      ],
      reconciledDates: {},
    });
    const before = await store.exportBoardConfiguration(scope, {
      exportedAt: "2026-08-22T10:00:00.000Z",
    });
    const cyclicFile = {
      ...before,
      configuration: {
        ...before.configuration,
        ganttBoardState: {
          dependencies: [
            {
              id: "POWER-1:POWER-2:FS",
              predecessorIssueKey: "POWER-1",
              successorIssueKey: "POWER-2",
              type: "FS" as const,
              lagWorkingDays: 0,
            },
            {
              id: "POWER-2:POWER-1:FS",
              predecessorIssueKey: "POWER-2",
              successorIssueKey: "POWER-1",
              type: "FS" as const,
              lagWorkingDays: 0,
            },
          ],
          reconciledDates: {},
        },
      },
    };

    await expect(store.importBoardConfiguration(scope, cyclicFile)).rejects.toThrow(
      /cycle/i,
    );
    await expect(
      store.getGanttBoardState(scope.jiraBaseUrl, "POWER:7"),
    ).resolves.toMatchObject({ dependencies: [{ id: "existing-dependency" }] });
    await expect(store.getLatestBoardConfigurationBackup(scope)).resolves.toBeUndefined();
  });
});
