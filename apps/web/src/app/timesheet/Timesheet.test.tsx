import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Timesheet } from "./Timesheet";
import { testApi, testLog } from "./test-fixtures";
const props = {
  baseUrl: "https://jira.test",
  accountId: "me",
  userName: "Alex",
  setupJql: "project = LBR",
};
describe("Personal Timesheet", () => {
  beforeEach(() => localStorage.clear());
  it("starts with the weekly table even after a saved month preference and has no generic popup logging entry", async () => {
    localStorage.setItem(
      "power-view:timesheet:v2:https://jira.test:me",
      JSON.stringify({
        zone: "Europe/Kyiv",
        mode: "month",
        projectIds: [],
        explicitJql: "",
      }),
    );
    render(<Timesheet api={testApi()} {...props} />);
    await screen.findByRole("table");
    expect(screen.getByRole("combobox", { name: "Period" })).toHaveValue("week");
    expect(screen.getAllByRole("columnheader")).toHaveLength(9);
    expect(screen.queryByRole("button", { name: "Log time" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows cells and records, returns focus, distinguishes visible totals, and has no automatic Setup scope", async () => {
    const api = testApi();
    render(<Timesheet api={api} {...props} />);
    const cell = await screen.findByRole("button", {
      name: /PV-1, .*1h 15m, 2 worklogs/,
    });
    expect(api.search.mock.calls[0]?.[0]).not.toContain("project = LBR");
    expect(screen.getByText(/Jira search may omit part/)).toBeVisible();
    fireEvent.click(cell);
    const details = screen.getByRole("region", { name: "Worklog details" });
    expect(within(details).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Close details" })).toHaveFocus();
    fireEvent(
      screen.getByRole("dialog", { name: "Worklog details" }),
      new Event("cancel", { cancelable: true }),
    );
    expect(cell).toHaveFocus();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find issue" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No matching issues")).toBeVisible();
    expect(
      screen.getByText("Visible rows: 0m. Full loaded selection: 1h 15m."),
    ).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find issue" }), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));
    await screen.findByText("Choose a board to see your tasks");
  });
  it("routes an empty monthly cell to the weekly inline input without a popup", async () => {
    render(<Timesheet api={testApi()} {...props} />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("combobox", { name: "Period" }), {
      target: { value: "month" },
    });
    const monthlyCells = await screen.findAllByRole("button", {
      name: /PV-1, .*add worklog/,
    });
    const cellLabel = monthlyCells[0]!.getAttribute("aria-label")!;
    const day = cellLabel.split(", ")[1]!;
    fireEvent.click(monthlyCells[0]!);
    expect(screen.getByRole("combobox", { name: "Period" })).toHaveValue("week");
    const input = await screen.findByRole("textbox", { name: `PV-1, ${day}, hours` });
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("region", { name: "Log time" })).toBeNull();
  });
  it("retains same-query stale data but never labels it as the next period", async () => {
    const api = testApi();
    render(<Timesheet api={api} {...props} />);
    await screen.findByRole("table");
    api.getUser.mockRejectedValue(new Error("Session expired"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Displayed data is stale");
    expect(screen.getByRole("table")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));
    await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
    expect(await screen.findByRole("alert")).toHaveTextContent("No totals are available");
  });
  it("shows partial reading and clears private data after an account change", async () => {
    const api = testApi();
    api.getWorklogs.mockRejectedValue(new Error("Forbidden"));
    render(<Timesheet api={api} {...props} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Incomplete reading");
    expect(screen.getByText("No matching records loaded")).toBeVisible();
    api.getUser.mockResolvedValue({ accountId: "other", displayName: "Other" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("account changed"),
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Log time" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Log time" })).toBeNull();
  });
  it("only applies Setup after an explicit action and persists it per account", async () => {
    const api = testApi();
    const view = render(<Timesheet api={api} {...props} />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByText(/Filters & time zone/));
    fireEvent.click(screen.getByRole("button", { name: "Use current Setup context" }));
    await waitFor(() =>
      expect(api.search.mock.calls.at(-1)?.[0]).toContain("project = LBR"),
    );
    view.unmount();
    render(<Timesheet api={testApi()} {...props} accountId="another" />);
    expect(screen.queryByText(/Filter copied from Setup/)).toBeNull();
  });
  it("adds another record inside the details popup without reopening task selection", async () => {
    render(<Timesheet api={testApi()} {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: /PV-1, .*2 worklogs/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add another worklog" }));
    const form = screen.getByRole("region", { name: "Log time" });
    expect(form).toHaveTextContent("PV-1");
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Log time" })).toBeVisible();
    expect(within(form).queryByRole("region", { name: "Choose Jira issue" })).toBeNull();
    expect(within(form).queryByRole("button", { name: "Change issue" })).toBeNull();
  });
  it("rereads the edited issue and updates exact totals after confirmation", async () => {
    const api = testApi();
    render(<Timesheet api={api} {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /PV-1, .*1h 15m, 2 worklogs/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit worklog 10" }));
    expect(screen.getByRole("region", { name: "Edit worklog" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Edit worklog" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "90m" } });
    api.getWorklogs.mockResolvedValue([
      testLog("10", undefined, 5400),
      testLog("11", undefined, 2700),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Save worklog" }));
    await screen.findByRole("button", { name: /PV-1, .*2h 15m, 2 worklogs/ });
    expect(api.saveWorklog).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Edit worklog" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps confirmed success distinct from a failed post-save reread", async () => {
    const api = testApi();
    render(<Timesheet api={api} {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /PV-1, .*1h 15m, 2 worklogs/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit worklog 10" }));
    expect(screen.getByRole("region", { name: "Edit worklog" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Edit worklog" })).toBeVisible();
    api.getWorklogs.mockRejectedValue(new Error("Network error"));
    fireEvent.click(screen.getByRole("button", { name: "Save worklog" }));
    await screen.findByText(/Saved in Jira, but the timesheet could not be refreshed/);
    expect(api.saveWorklog).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Edit worklog" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
