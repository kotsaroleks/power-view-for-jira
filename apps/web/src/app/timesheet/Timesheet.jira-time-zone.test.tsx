import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Timesheet } from "./Timesheet";
import { testApi, testLog } from "./test-fixtures";

const props = {
  baseUrl: "https://jira.test",
  accountId: "me",
  userName: "Author",
  jiraTimeZone: "America/Los_Angeles",
};
const started = "2026-11-02T14:00:00.000-0800";
function fixture(jiraTimeZone = props.jiraTimeZone, loadedZone = jiraTimeZone) {
  const api = testApi();
  api.getUser.mockResolvedValue({
    accountId: "me",
    displayName: "Author",
    timeZone: loadedZone,
  });
  api.getWorklogs.mockResolvedValue([testLog("293030", started, 3600)]);
  const view = render(<Timesheet {...props} jiraTimeZone={jiraTimeZone} api={api} />);
  fireEvent.change(screen.getByLabelText("Go to date"), {
    target: { value: "2026-11-02" },
  });
  return { api, view };
}

describe("Personal calendar matches the Jira profile", () => {
  beforeEach(() => localStorage.clear());

  it("preserves a previous explicit non-default time zone during migration", async () => {
    localStorage.setItem(
      "power-view:timesheet:v2:https://jira.test:me",
      JSON.stringify({ zone: "UTC", mode: "week", projectIds: [], explicitJql: "" }),
    );
    fixture();
    await screen.findByRole("table");
    fireEvent.click(screen.getByText(/Filters & time zone/));
    expect(screen.getByLabelText("Time zone")).toHaveValue("UTC");
  });

  it("migrates the old implicit Kyiv preference and keeps the November 2 worklog on Jira's date", async () => {
    localStorage.setItem(
      "power-view:timesheet:v2:https://jira.test:me",
      JSON.stringify({
        zone: "Europe/Kyiv",
        mode: "week",
        projectIds: [],
        explicitJql: "",
      }),
    );
    const { api } = fixture();
    const monday = await screen.findByRole("textbox", {
      name: "PV-1, 2026-11-02, hours",
    });
    expect(monday).toHaveValue("1");
    expect(screen.getByRole("textbox", { name: "PV-1, 2026-11-03, hours" })).toHaveValue(
      "",
    );
    expect(screen.getByRole("table")).toHaveAccessibleName(
      /America\/Los_Angeles · Jira profile/,
    );
    expect(
      screen.getByRole("status", { name: "Jira time zone warning" }),
    ).toHaveTextContent("America/Los_Angeles (−10h relative to Europe/Kyiv");
    expect(monday).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: /PV-1, 2026-11-02, 1h, 1 worklogs/ }),
    );
    const time = screen.getByRole("dialog").querySelector("time")!;
    expect(time).toHaveAttribute("datetime", started);
    expect(time).toHaveTextContent("02/11/2026, 14:00:00");
    expect(api.saveWorklog).not.toHaveBeenCalled();
    expect(api.deleteWorklog).not.toHaveBeenCalled();
  });

  it("allows an explicit Kyiv view and preserves that deliberate choice on reopening", async () => {
    const { api, view } = fixture();
    await screen.findByRole("textbox", { name: "PV-1, 2026-11-02, hours" });
    fireEvent.click(screen.getByText(/Filters & time zone/));
    fireEvent.change(screen.getByLabelText("Time zone"), {
      target: { value: "Europe/Kyiv" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "PV-1, 2026-11-03, hours" }),
      ).toHaveValue("1"),
    );
    expect(screen.getByRole("textbox", { name: "PV-1, 2026-11-02, hours" })).toHaveValue(
      "",
    );
    const warning = screen.getByRole("status", { name: "Jira time zone warning" });
    expect(warning).toHaveTextContent(
      "America/Los_Angeles (−10h relative to Europe/Kyiv",
    );
    expect(warning).toHaveTextContent("Timesheet view: Europe/Kyiv.");
    view.unmount();
    const reopened = fixture();
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "PV-1, 2026-11-03, hours" }),
      ).toHaveValue("1"),
    );
    expect(reopened.api.saveWorklog).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Jira time zone warning" })).toBeVisible();
    expect(api.saveWorklog).not.toHaveBeenCalled();
  });

  it.each([
    "Europe/Kyiv",
    "Europe/Kiev",
    "Europe/Berlin",
    "Europe/Moscow",
    "",
    "invalid",
  ])("does not warn for a profile within ±1h or unavailable: %s", async (zone) => {
    fixture(zone);
    await screen.findByRole("table");
    expect(screen.queryByRole("status", { name: "Jira time zone warning" })).toBeNull();
  });

  it("uses the latest loaded author profile rather than the viewing zone", async () => {
    const { api } = fixture("Europe/Kyiv", "America/Los_Angeles");
    await screen.findByRole("table");
    const warning = screen.getByRole("status", { name: "Jira time zone warning" });
    expect(warning).toHaveTextContent(
      "America/Los_Angeles (−10h relative to Europe/Kyiv",
    );
    expect(warning).toHaveTextContent("Timesheet view: Europe/Kyiv.");
    expect(api.saveWorklog).not.toHaveBeenCalled();
    expect(api.deleteWorklog).not.toHaveBeenCalled();
  });

  it("updates the warning for the displayed period when Kyiv's offset changes", async () => {
    fixture("Europe/Samara");
    await screen.findByRole("table");
    expect(
      screen.getByRole("status", { name: "Jira time zone warning" }),
    ).toHaveTextContent("+2h relative to Europe/Kyiv");
    fireEvent.change(screen.getByLabelText("Go to date"), {
      target: { value: "2026-07-01" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    expect(screen.queryByRole("status", { name: "Jira time zone warning" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Go to date"), {
      target: { value: "2026-03-29" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Jira time zone warning" }),
      ).toHaveTextContent("+1h to +2h relative to Europe/Kyiv"),
    );
  });
});
