import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeReportDayOff } from "@power-view/domain";
import type { DayOffStore } from "../day-off/DayOffStore";
import { Timesheet } from "../timesheet/Timesheet";
import { testApi, testLog } from "../timesheet/test-fixtures";
import { TimeReportPanel, type TimeReportTeamsApi } from "./TimeReportPanel";

const baseUrl = "https://example.atlassian.net";
function sharedStore(initial: TimeReportDayOff[] = [], complete = true) {
  let dayOffs = [...initial];
  return {
    connect: vi.fn<DayOffStore["connect"]>().mockResolvedValue(undefined),
    read: vi.fn<DayOffStore["read"]>().mockImplementation((_site, users, days) =>
      Promise.resolve({
        dayOffs: dayOffs.filter(
          (flag) => users.includes(flag.userId) && days.includes(flag.date),
        ),
        complete,
        warnings: complete ? [] : ["One employee's calendar could not be read."],
      }),
    ),
    set: vi
      .fn<DayOffStore["set"]>()
      .mockImplementation((_site, userId, date, enabled) => {
        dayOffs = dayOffs.filter((flag) => flag.userId !== userId || flag.date !== date);
        if (enabled) dayOffs.push({ userId, date });
        return Promise.resolve();
      }),
  };
}
function reportProps(store: DayOffStore) {
  const api = testApi();
  api.getWorklogs.mockResolvedValue([testLog("1", "2026-10-26T10:00:00Z", 7200)]);
  const teamsApi = {
    listMyTeams: vi
      .fn<TimeReportTeamsApi["listMyTeams"]>()
      .mockResolvedValue([{ id: "team", name: "Delivery", organizationId: "org" }]),
    loadTeam: vi.fn<TimeReportTeamsApi["loadTeam"]>().mockResolvedValue({
      id: "team",
      name: "Delivery",
      members: [{ accountId: "me", displayName: "Alex" }],
    }),
  };
  return { api, teamsApi, baseUrl, accountId: "me", dayOffStore: store };
}
async function loadReport() {
  fireEvent.change(screen.getByLabelText("Week containing"), {
    target: { value: "2026-10-26" },
  });
  fireEvent.change(screen.getByLabelText("Report time zone"), {
    target: { value: "UTC" },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Load Time Report" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Load Time Report" }));
  await screen.findByRole("button", { name: "Alex" });
}
describe("Time Report shared Day Off", () => {
  beforeEach(() => localStorage.clear());
  it("shows shared Day Off and preserves existing two-hour worklogs as a conflict", async () => {
    const store = sharedStore([{ userId: "me", date: "2026-10-26" }]);
    const props = reportProps(store);
    render(<TimeReportPanel {...props} />);
    await loadReport();
    const conflict = await screen.findByText("Day Off · 2h");
    expect(conflict).toHaveClass("time-report-conflict");
    const employeeRow = screen.getByRole("button", { name: "Alex" }).closest("tr")!;
    expect(within(employeeRow).getByText("32h")).toBeVisible();
    expect(store.read).toHaveBeenCalledWith(
      baseUrl,
      ["me"],
      expect.arrayContaining(["2026-10-26"]),
      expect.any(AbortSignal),
    );
    expect(props.api.saveWorklog).not.toHaveBeenCalled();
    expect(props.api.deleteWorklog).not.toHaveBeenCalled();
  });
  it("withholds capacity when the shared calendar is incomplete", async () => {
    const store = sharedStore([], false);
    render(<TimeReportPanel {...reportProps(store)} />);
    await loadReport();
    await waitFor(() =>
      expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("40h")).toBeNull();
    expect(screen.queryByText("5.0%")).toBeNull();
    expect(screen.getAllByText("2h", { selector: "td" })[0]).toBeVisible();
  });
  it("updates an already loaded report after Timesheet marks and clears the shared day", async () => {
    const store = sharedStore();
    const props = reportProps(store);
    const report = render(<TimeReportPanel {...props} />);
    await loadReport();
    localStorage.setItem(
      `power-view:weekly-tasks:v1:${baseUrl}:me`,
      JSON.stringify({ boardId: 1, pins: {} }),
    );
    render(
      <Timesheet
        api={props.api}
        baseUrl={baseUrl}
        accountId="me"
        userName="Alex"
        dayOffStore={store}
      />,
    );
    fireEvent.change(screen.getByLabelText("Go to date"), {
      target: { value: "2026-10-26" },
    });
    const checkbox = await screen.findByRole("checkbox", { name: "Day off 2026-10-27" });
    await waitFor(() => expect(checkbox).toBeEnabled());
    const reportReads = () =>
      props.api.search.mock.calls.filter(([jql]) => jql.startsWith("worklogAuthor in ("))
        .length;
    const readsBefore = reportReads();
    fireEvent.click(checkbox);
    await within(report.container).findByText("Day Off", { selector: "td" });
    const employeeRow = within(report.container)
      .getByRole("button", { name: "Alex" })
      .closest("tr")!;
    expect(within(employeeRow).getByText("32h")).toBeVisible();
    expect(reportReads()).toBe(readsBefore);
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(
        within(report.container).queryByText("Day Off", { selector: "td" }),
      ).toBeNull(),
    );
    expect(within(employeeRow).getByText("40h")).toBeVisible();
    expect(props.api.saveWorklog).not.toHaveBeenCalled();
    expect(props.api.deleteWorklog).not.toHaveBeenCalled();
  });
});
