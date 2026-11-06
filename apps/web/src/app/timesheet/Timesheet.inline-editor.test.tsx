import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timesheet } from "./Timesheet";
import { testApi, testIssue, testLog } from "./test-fixtures";

const secondIssue = { ...testIssue, id: "2", key: "PV-2", summary: "Second task" };

async function openFirstDraft() {
  const api = testApi();
  api.search.mockResolvedValue({ issues: [testIssue, secondIssue], isLast: true });
  api.getWorklogs.mockImplementation((issue) =>
    Promise.resolve(
      ["a", "b"].map((suffix) => ({
        ...testLog(`${issue.id}-${suffix}`),
        issueId: issue.id,
        issueKey: issue.key,
      })),
    ),
  );
  api.saveWorklog.mockResolvedValue({
    ...testLog("new-second"),
    issueId: secondIssue.id,
    issueKey: secondIssue.key,
  });
  render(
    <Timesheet api={api} baseUrl="https://jira.test" accountId="me" userName="Alex" />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /PV-1, .*2 worklogs/ }));
  fireEvent.click(screen.getByRole("button", { name: "Add another worklog" }));
  fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "1h" } });
  fireEvent.change(screen.getByLabelText("Work description (optional)"), {
    target: { value: "Draft for the first issue" },
  });
  return api;
}

describe("Worklog popup draft protection", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("clears the previous draft and saves to the newly selected issue after discard", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = await openFirstDraft();
    fireEvent.click(screen.getByRole("button", { name: "Close worklog form" }));
    expect(confirm).toHaveBeenCalledWith("Discard the unsaved worklog form?");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /PV-2, .*2 worklogs/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add another worklog" }));
    const editor = screen.getByRole("region", { name: "Log time" });
    expect(editor).toHaveTextContent("PV-2");
    expect(editor).not.toHaveTextContent("PV-1");
    expect(within(editor).getByLabelText("Duration")).toHaveValue("");
    expect(within(editor).getByLabelText("Work description (optional)")).toHaveValue("");
    expect(screen.getByRole("dialog", { name: "Log time" })).toBeVisible();

    fireEvent.change(within(editor).getByLabelText("Duration"), {
      target: { value: "2h" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "Save worklog" }));
    await waitFor(() => expect(api.saveWorklog).toHaveBeenCalledOnce());
    expect(api.saveWorklog).toHaveBeenCalledWith(
      secondIssue,
      expect.objectContaining({ timeSpentSeconds: 7200 }),
      "me",
      undefined,
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Log time" })).toBeNull(),
    );
  });

  it("keeps the original target and draft when discarding is declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const api = await openFirstDraft();
    fireEvent.click(screen.getByRole("button", { name: "Close worklog form" }));
    expect(confirm).toHaveBeenCalledWith("Discard the unsaved worklog form?");
    const editor = screen.getByRole("region", { name: "Log time" });
    expect(editor).toHaveTextContent("PV-1");
    expect(editor).not.toHaveTextContent("PV-2");
    expect(within(editor).getByLabelText("Duration")).toHaveValue("1h");
    expect(within(editor).getByLabelText("Work description (optional)")).toHaveValue(
      "Draft for the first issue",
    );
    expect(api.saveWorklog).not.toHaveBeenCalled();
  });
});
