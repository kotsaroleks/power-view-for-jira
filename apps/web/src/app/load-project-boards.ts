import type { JiraBoard } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";

export async function loadProjectBoards(
  client: JiraClient,
  projectKeyOrId?: string,
  detectedBoardId?: string,
  signal?: AbortSignal,
): Promise<JiraBoard[]> {
  const boards = new Map<string, JiraBoard>();
  let startAt = 0;
  let hasMore = true;

  while (hasMore) {
    const request = {
      startAt,
      maxResults: 50,
      ...(projectKeyOrId ? { projectKeyOrId } : {}),
    };
    const page = signal
      ? await client.getBoards(request, signal)
      : await client.getBoards(request);
    page.values.forEach((board) => boards.set(board.id, board));

    const nextStartAt = page.startAt + page.values.length;
    hasMore = !page.isLast && page.values.length > 0 && nextStartAt > startAt;
    if (hasMore) startAt = nextStartAt;
  }

  if (detectedBoardId && !boards.has(detectedBoardId)) {
    try {
      const detectedBoard = signal
        ? await client.getBoard(detectedBoardId, signal)
        : await client.getBoard(detectedBoardId);
      boards.set(detectedBoard.id, detectedBoard);
    } catch {
      // The selected project boards remain usable when the detected board is inaccessible.
    }
  }

  return [...boards.values()].sort((left, right) => left.name.localeCompare(right.name));
}
