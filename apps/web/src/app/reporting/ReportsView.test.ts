import type { JiraBoard } from "@power-view/domain";
import type { JiraClient, JiraBoardPage } from "@power-view/jira-client";
import { describe, expect, it, vi } from "vitest";

import { loadProjectBoards } from "../load-project-boards";

function board(id: string): JiraBoard {
  return { id, name: `Board ${id}`, type: "scrum", projectKeys: ["LBR"] };
}

describe("loadProjectBoards", () => {
  it("loads every page for the detected project", async () => {
    const getBoards = vi
      .fn()
      .mockResolvedValueOnce({
        values: [board("1")],
        startAt: 0,
        maxResults: 50,
        total: 2,
        isLast: false,
      } satisfies JiraBoardPage)
      .mockResolvedValueOnce({
        values: [board("1296")],
        startAt: 1,
        maxResults: 50,
        total: 2,
        isLast: true,
      } satisfies JiraBoardPage);
    const client = { getBoards } as unknown as JiraClient;

    await expect(loadProjectBoards(client, "LBR", "1296")).resolves.toEqual([
      board("1"),
      board("1296"),
    ]);
    expect(getBoards).toHaveBeenNthCalledWith(1, {
      startAt: 0,
      maxResults: 50,
      projectKeyOrId: "LBR",
    });
    expect(getBoards).toHaveBeenNthCalledWith(2, {
      startAt: 1,
      maxResults: 50,
      projectKeyOrId: "LBR",
    });
  });

  it("adds the detected current board when Jira omits it from the project list", async () => {
    const client = {
      getBoards: vi.fn().mockResolvedValue({
        values: [board("1")],
        startAt: 0,
        maxResults: 50,
        total: 1,
        isLast: true,
      } satisfies JiraBoardPage),
      getBoard: vi.fn().mockResolvedValue(board("1296")),
    } as unknown as JiraClient;

    await expect(loadProjectBoards(client, "LBR", "1296")).resolves.toEqual([
      board("1"),
      board("1296"),
    ]);
  });
});
