import type { JiraBoard } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";

export async function loadReportBoards(
  client: JiraClient,
  projectKeyOrId?: string,
  currentBoardId?: string,
): Promise<JiraBoard[]> {
  const boards = new Map<string, JiraBoard>();
  let startAt = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await client.getBoards({
      startAt,
      maxResults: 50,
      ...(projectKeyOrId ? { projectKeyOrId } : {}),
    });
    for (const board of page.values) boards.set(board.id, board);

    const nextStartAt = page.startAt + page.values.length;
    hasMore = !page.isLast && page.values.length > 0 && nextStartAt > startAt;
    if (hasMore) startAt = nextStartAt;
  }

  if (currentBoardId && !boards.has(currentBoardId)) {
    try {
      const currentBoard = await client.getBoard(currentBoardId);
      boards.set(currentBoard.id, currentBoard);
    } catch {
      // Keep the accessible project boards when the current board cannot be read.
    }
  }

  return [...boards.values()];
}
