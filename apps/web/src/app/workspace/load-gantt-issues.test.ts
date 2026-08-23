import {
  buildGanttScheduleModel,
  type FieldMapping,
  type NormalizedIssue,
} from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import { describe, expect, it, vi } from "vitest";

import { loadGanttIssues } from "./load-gantt-issues";

function issue(
  key: string,
  options: {
    issueTypeName?: string;
    parentKey?: string;
  } = {},
): NormalizedIssue {
  return {
    id: key,
    key,
    browseUrl: `https://example.atlassian.net/browse/${key}`,
    summary: key,
    issueType: {
      id: options.issueTypeName === "Epic" ? "10000" : "10001",
      name: options.issueTypeName ?? "Story",
      subtask: false,
      hierarchyLevel: options.issueTypeName === "Epic" ? 1 : 0,
    },
    status: { id: "1", name: "To Do", category: "to-do" },
    project: { id: "10000", key: "POWER", name: "Power View" },
    ...(options.parentKey
      ? {
          parentKey: options.parentKey,
          parentReference: {
            id: `id-${options.parentKey}`,
            key: options.parentKey,
            summary: options.parentKey,
            issueType: {
              id: "10000",
              name: "Epic",
              subtask: false,
              hierarchyLevel: 1,
            },
          },
        }
      : {}),
    labels: [],
    components: [],
    fixVersions: [],
    issueLinks: [],
    rawFieldPresence: {
      hasStartDate: false,
      hasDueDate: false,
      hasParent: Boolean(options.parentKey),
      hasEpic: false,
    },
  };
}

describe("loadGanttIssues", () => {
  it("hydrates referenced epics and marks only epics outside the current board", async () => {
    const boardIssues = [
      issue("POWER-1", { parentKey: "POWER-101" }),
      issue("POWER-2", { parentKey: "POWER-202" }),
    ];
    const hydratedEpics = [
      issue("POWER-101", { issueTypeName: "Epic" }),
      issue("POWER-202", { issueTypeName: "Epic" }),
    ];
    const getBoardEpics = vi
      .fn()
      .mockResolvedValue([
        { id: "101", key: "POWER-101", name: "Current-board epic", done: false },
      ]);
    const searchIssues = vi.fn().mockResolvedValue({
      values: hydratedEpics,
      startAt: 0,
      maxResults: 2,
      total: 2,
      isLast: true,
      truncated: false,
      fromCache: false,
    });
    const fieldMapping: FieldMapping = {
      startDateFieldId: "customfield_10010",
    };
    const client = { getBoardEpics, searchIssues } as unknown as JiraClient;

    const result = await loadGanttIssues({
      client,
      boardId: "2487",
      boardIssues,
      fieldMapping,
    });

    expect(getBoardEpics).toHaveBeenCalledWith("2487", undefined);
    expect(searchIssues).toHaveBeenCalledWith(
      {
        jql: 'key in ("POWER-101", "POWER-202")',
        fieldMapping,
        maxIssues: 2,
        pageSize: 100,
      },
      undefined,
    );
    expect(result.map((value) => value.key)).toEqual([
      "POWER-1",
      "POWER-2",
      "POWER-101",
      "POWER-202",
    ]);
    expect(result.find((value) => value.key === "POWER-101")).not.toHaveProperty(
      "isExternalBoardEpic",
    );
    expect(result.find((value) => value.key === "POWER-202")).toMatchObject({
      isExternalBoardEpic: true,
    });

    const model = buildGanttScheduleModel(result, { today: "2026-08-23" });
    const currentBoardEpic = model.tasks.find((task) => task.issueKey === "POWER-101");
    expect(currentBoardEpic).not.toHaveProperty("isHierarchyPlaceholder");
    expect(currentBoardEpic).not.toHaveProperty("isExternalBoardEpic");
    const externalBoardEpic = model.tasks.find((task) => task.issueKey === "POWER-202");
    expect(externalBoardEpic).not.toHaveProperty("isHierarchyPlaceholder");
    expect(externalBoardEpic).toMatchObject({ isExternalBoardEpic: true });
  });

  it("does not make Jira enrichment requests when every parent is already loaded", async () => {
    const loadedEpic = issue("POWER-101", { issueTypeName: "Epic" });
    const getBoardEpics = vi.fn();
    const searchIssues = vi.fn();
    const client = { getBoardEpics, searchIssues } as unknown as JiraClient;

    await expect(
      loadGanttIssues({
        client,
        boardId: "2487",
        boardIssues: [loadedEpic, issue("POWER-1", { parentKey: loadedEpic.key })],
        fieldMapping: {},
      }),
    ).resolves.toHaveLength(2);
    expect(getBoardEpics).not.toHaveBeenCalled();
    expect(searchIssues).not.toHaveBeenCalled();
  });

  it("does not mark a hydrated non-epic parent as an external-board epic", async () => {
    const child = issue("POWER-1", { parentKey: "POWER-303" });
    const parentStory = issue("POWER-303");
    const client = {
      getBoardEpics: vi.fn().mockResolvedValue([]),
      searchIssues: vi.fn().mockResolvedValue({
        values: [parentStory],
        total: 1,
        truncated: false,
        fromCache: false,
      }),
    } as unknown as JiraClient;

    const result = await loadGanttIssues({
      client,
      boardId: "2487",
      boardIssues: [child],
      fieldMapping: {},
    });

    expect(result.find((value) => value.key === "POWER-303")).not.toHaveProperty(
      "isExternalBoardEpic",
    );
  });
});
