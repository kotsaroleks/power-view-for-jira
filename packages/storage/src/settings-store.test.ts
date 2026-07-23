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

function configuration(jql: string): SetupConfiguration {
  return {
    jiraBaseUrl: "https://example.atlassian.net",
    project: { id: "10000", key: "POWER", name: "Power View" },
    jql,
    fieldMapping: {
      startDateFieldId: "customfield_10010",
      endDateFieldId: "duedate",
    },
    defaultDurations: DEFAULT_DURATION_DAYS,
    updatedAt: "2026-07-23T01:00:00.000Z",
  };
}

describe("SettingsStore", () => {
  it("persists setup per Jira instance and project", async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.saveSetup(configuration('project = "POWER"'));

    await expect(
      store.getSetup("https://example.atlassian.net/", "POWER"),
    ).resolves.toMatchObject({
      project: { key: "POWER" },
      fieldMapping: { endDateFieldId: "duedate" },
      defaultDurations: DEFAULT_DURATION_DAYS,
    });
    await expect(
      store.getSetup("https://other.atlassian.net", "POWER"),
    ).resolves.toBeUndefined();
  });

  it("deduplicates and orders recent JQL", async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.saveSetup(configuration('project = "POWER"'));
    await store.saveSetup(configuration('project = "POWER" AND status != Done'));
    await store.saveSetup(configuration('project = "POWER"'));

    await expect(
      store.getRecentJql("https://example.atlassian.net", "POWER"),
    ).resolves.toEqual(['project = "POWER"', 'project = "POWER" AND status != Done']);
  });

  it("persists Gantt filters per Jira instance and project", async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.saveGanttFilters("https://example.atlassian.net", "POWER", {
      ...DEFAULT_GANTT_FILTERS,
      search: "timeline",
      statusCategories: ["in-progress"],
      dateFilters: ["partial"],
      logic: "or",
      includeDescendants: true,
    });

    await expect(
      store.getGanttFilters("https://example.atlassian.net/", "POWER"),
    ).resolves.toMatchObject({
      search: "timeline",
      statusCategories: ["in-progress"],
      dateFilters: ["partial"],
      logic: "or",
      includeDescendants: true,
    });
    await expect(
      store.getGanttFilters("https://example.atlassian.net", "OTHER"),
    ).resolves.toBeUndefined();
  });

  it("persists Gantt zoom per Jira instance and project", async () => {
    const store = new SettingsStore(new MemoryStorage());
    await store.saveGanttViewPreferences("https://example.atlassian.net", "POWER", {
      zoom: "month",
    });

    await expect(
      store.getGanttViewPreferences("https://example.atlassian.net/", "POWER"),
    ).resolves.toEqual({ zoom: "month" });
    await expect(
      store.getGanttViewPreferences("https://example.atlassian.net", "OTHER"),
    ).resolves.toBeUndefined();
  });

  it("migrates legacy single-value Gantt filters without losing settings", async () => {
    const storage = new MemoryStorage();
    await storage.set({
      "settings:v1": {
        schemaVersion: 1,
        setups: {},
        recentJql: {},
        ganttFilters: {
          "https%3A%2F%2Fexample.atlassian.net:POWER": {
            search: "",
            status: "In Progress",
            statusCategory: "in-progress",
            assignee: "Alex Rivera",
            issueType: "Story",
            dateFilter: "partial",
            includeDescendants: false,
          },
        },
      },
    });

    await expect(
      new SettingsStore(storage).getGanttFilters(
        "https://example.atlassian.net",
        "POWER",
      ),
    ).resolves.toMatchObject({
      statuses: ["In Progress"],
      statusCategories: ["in-progress"],
      assignees: ["Alex Rivera"],
      issueTypes: ["Story"],
      dateFilters: ["partial"],
      logic: "and",
      priorities: [],
      labels: [],
      riskFilters: [],
    });
  });
});
