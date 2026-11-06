import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Timesheet } from "./Timesheet";
import { testApi } from "./test-fixtures";

describe("Weekly cell refresh draft preservation", () => {
  beforeEach(() => localStorage.clear());

  it("protects an unsaved cell against keyboard period changes and row filtering", async () => {
    localStorage.setItem(
      "power-view:weekly-tasks:v1:https://jira.test:me",
      JSON.stringify({ boardId: 1, pins: {} }),
    );
    const api = testApi();
    api.search.mockResolvedValue({ issues: [], isLast: true });
    api.getWorklogs.mockResolvedValue([]);
    render(
      <Timesheet api={api} baseUrl="https://jira.test" accountId="me" userName="Alex" />,
    );
    const input = (await screen.findAllByRole("textbox", { name: /PV-1, .*hours/ }))[0]!;
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "1.5" } });
    const period = screen.getByRole("combobox", { name: /^Period$/ });
    expect(period).toBeDisabled();
    fireEvent.change(period, { target: { value: "month" } });
    expect(period).toHaveValue("week");
    const filter = screen.getByRole("searchbox", { name: "Find issue" });
    expect(filter).toBeDisabled();
    fireEvent.change(filter, { target: { value: "not this task" } });
    expect(input).toHaveValue("1.5");
    expect(input).toBeInTheDocument();
    expect(screen.getByText(/Finish saving or resolve the edited cell/)).toBeVisible();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(period).toBeEnabled();
    expect(filter).toBeEnabled();
    expect(api.saveWorklog).not.toHaveBeenCalled();
  });

  it("retains both failed drafts when one cell refreshes Jira records", async () => {
    localStorage.setItem(
      "power-view:weekly-tasks:v1:https://jira.test:me",
      JSON.stringify({ boardId: 1, pins: {} }),
    );
    const api = testApi();
    api.search.mockResolvedValue({ issues: [], isLast: true });
    api.getWorklogs.mockResolvedValue([]);
    api.saveWorklog.mockRejectedValue(new Error("Jira rejected this write"));
    render(
      <Timesheet api={api} baseUrl="https://jira.test" accountId="me" userName="Alex" />,
    );
    const inputs = await screen.findAllByRole("textbox", { name: /PV-1, .*hours/ });
    const first = inputs[0]!;
    const neighbor = inputs[1]!;
    await waitFor(() => expect(first).not.toBeDisabled());

    fireEvent.change(first, { target: { value: "1.5" } });
    fireEvent.blur(first);
    await within(first.closest("td")!).findByText(/Jira rejected this write/);
    fireEvent.change(neighbor, { target: { value: "2:15" } });
    fireEvent.blur(neighbor);
    await within(neighbor.closest("td")!).findByText(/Jira rejected this write/);
    expect(api.saveWorklog).toHaveBeenCalledTimes(2);

    const readsBeforeRefresh = api.getWorklogs.mock.calls.length;
    fireEvent.click(
      within(first.closest("td")!).getByRole("button", { name: "Refresh records" }),
    );
    await waitFor(() =>
      expect(api.getWorklogs.mock.calls.length).toBeGreaterThan(readsBeforeRefresh),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("textbox", { name: /PV-1, .*hours/ })[0],
      ).not.toBeDisabled(),
    );
    const refreshed = screen.getAllByRole("textbox", { name: /PV-1, .*hours/ });
    expect(refreshed[0]).toHaveValue("1.5");
    expect(refreshed[1]).toHaveValue("2:15");
    expect(api.saveWorklog).toHaveBeenCalledTimes(2);
  });
});
