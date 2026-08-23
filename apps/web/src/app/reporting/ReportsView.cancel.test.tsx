import type { BoardReportConfiguration, JiraBoard } from "@power-view/domain";
import type { JiraClient } from "@power-view/jira-client";
import { MemoryReportHistoryStore } from "@power-view/storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReportsView } from "./ReportsView";

const board: JiraBoard = {
  id: "7",
  name: "Power Delivery Board",
  type: "scrum",
  projectKeys: ["POWER"],
};

const statusMapping: BoardReportConfiguration = {
  schemaVersion: 1,
  jiraBaseUrl: "https://example.atlassian.net",
  boardId: "7",
  completedStatusIds: ["3"],
  completedStatusNames: ["Done"],
  updatedAt: "2026-08-04T12:00:00.000Z",
};

function hangingClient(): { client: JiraClient; abortSignals: AbortSignal[] } {
  const abortSignals: AbortSignal[] = [];
  const client = {
    getBoards: vi.fn(),
    getBoard: vi.fn().mockResolvedValue(board),
    getBoardConfiguration: vi.fn().mockResolvedValue(statusMapping),
    getBoardIssues: vi.fn(
      (_request: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal) {
            abortSignals.push(signal);
            signal.addEventListener("abort", () => {
              reject(new DOMException("The Jira request was aborted.", "AbortError"));
            });
          }
        }),
    ),
    getBoardSprints: vi.fn().mockResolvedValue({
      values: [],
      startAt: 0,
      maxResults: 50,
      total: 0,
      isLast: true,
    }),
  } as unknown as JiraClient;
  return { client, abortSignals };
}

describe("ReportsView cancellation", () => {
  it("aborts the in-flight request when Cancel is clicked, and reports a status not an error", async () => {
    const { client, abortSignals } = hangingClient();

    render(
      <ReportsView
        client={client}
        baseUrl="https://example.atlassian.net"
        deploymentType="cloud"
        board={board}
        issues={[]}
        jql="filter = 9001 ORDER BY Rank ASC"
        statusMapping={statusMapping}
        historyStore={new MemoryReportHistoryStore()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Generate report/ }));

    const cancelButton = await screen.findByRole("button", { name: "Cancel" });
    await waitFor(() => expect(abortSignals.length).toBeGreaterThan(0));

    fireEvent.click(cancelButton);

    expect(await screen.findByText("Report generation cancelled.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("aborts the in-flight request on unmount", async () => {
    const { client, abortSignals } = hangingClient();

    const { unmount } = render(
      <ReportsView
        client={client}
        baseUrl="https://example.atlassian.net"
        deploymentType="cloud"
        board={board}
        issues={[]}
        jql="filter = 9001 ORDER BY Rank ASC"
        statusMapping={statusMapping}
        historyStore={new MemoryReportHistoryStore()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Generate report/ }));
    await waitFor(() => expect(abortSignals.length).toBeGreaterThan(0));

    unmount();

    expect(abortSignals[0]?.aborted).toBe(true);
  });
});
