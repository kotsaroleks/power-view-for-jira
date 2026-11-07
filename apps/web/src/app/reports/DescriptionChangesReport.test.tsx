import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JiraClient } from "@power-view/jira-client";
import type * as jiraModule from "@power-view/jira-client";
import { collectDescriptionChangeReport } from "@power-view/jira-client";
import { descriptionFixture } from "../../../../../packages/domain/src/description-report.test-fixtures";
import { DescriptionChangesReport } from "./DescriptionChangesReport";
vi.mock("@power-view/jira-client", async (original) => ({
  ...(await original<typeof jiraModule>()),
  collectDescriptionChangeReport: vi.fn(),
}));
describe("Description report preview", () => {
  const client = {} as JiraClient;
  it("requires an explicit preview and renders context and authors", async () => {
    vi.mocked(collectDescriptionChangeReport).mockResolvedValue(descriptionFixture());
    render(
      <DescriptionChangesReport
        client={client}
        baseUrl="https://fixture.atlassian.net"
        boardId="7"
      />,
    );
    expect(collectDescriptionChangeReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview description changes" }));
    expect(await screen.findByRole("link", { name: "TEST-2" })).toBeVisible();
    expect(screen.getByText("— (context)")).toBeVisible();
    expect(screen.getByText("a")).toBeVisible();
  });
  it("never represents a failed read as no changes", async () => {
    vi.mocked(collectDescriptionChangeReport).mockRejectedValue(
      new Error("Jira unavailable"),
    );
    render(
      <DescriptionChangesReport
        client={client}
        baseUrl="https://fixture.atlassian.net"
        boardId="7"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview description changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Jira unavailable");
    expect(
      screen.queryByText("No issue descriptions changed during this period."),
    ).not.toBeInTheDocument();
  });
  it("ignores a late report after the account/workspace changes", async () => {
    let finish: ((value: ReturnType<typeof descriptionFixture>) => void) | undefined;
    vi.mocked(collectDescriptionChangeReport).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <DescriptionChangesReport
        client={client}
        baseUrl="https://fixture.atlassian.net"
        boardId="7"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Preview description changes" }));
    view.rerender(
      <DescriptionChangesReport
        client={{} as JiraClient}
        baseUrl="https://other.atlassian.net"
        boardId="8"
      />,
    );
    finish!(descriptionFixture());
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "TEST-2" })).not.toBeInTheDocument(),
    );
  });
});
