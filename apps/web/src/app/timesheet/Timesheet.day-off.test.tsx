import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeReportDayOff } from "@power-view/domain";
import type { DayOffStore } from "../day-off/DayOffStore";
import { Timesheet } from "./Timesheet";
import { dayInZone, periodDays } from "./timesheet-model";
import { testApi } from "./test-fixtures";

const baseUrl = "https://jira.test";
const props = { baseUrl, accountId: "me", userName: "Alex" };
function sharedStore(initial: TimeReportDayOff[] = []) {
  let dayOffs = [...initial];
  return {
    connect: vi.fn<DayOffStore["connect"]>().mockResolvedValue(undefined),
    read: vi.fn<DayOffStore["read"]>().mockImplementation((_site, users, days) =>
      Promise.resolve({
        dayOffs: dayOffs.filter(
          (flag) => users.includes(flag.userId) && days.includes(flag.date),
        ),
        complete: true,
        warnings: [],
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
function rememberBoard() {
  localStorage.setItem(
    `power-view:weekly-tasks:v1:${baseUrl}:me`,
    JSON.stringify({ boardId: 1, pins: {} }),
  );
}
const today = dayInZone(new Date(), "Europe/Kyiv");
const emptyDay = periodDays(today, "week").find((day) => day !== today)!;
describe("Timesheet shared Day Off", () => {
  it("refreshes shared storage without participant sign-in or disconnect", async () => {
    const store = sharedStore();
    render(<Timesheet {...props} api={testApi()} dayOffStore={store} />);
    const button = await screen.findByRole("button", { name: "Refresh Day Off" });
    await waitFor(() => expect(button).toBeEnabled());
    const previous = store.read.mock.calls.length;
    fireEvent.click(button);
    await waitFor(() => expect(store.read.mock.calls.length).toBeGreaterThan(previous));
    expect(store.set).not.toHaveBeenCalled();
    expect(store.connect).not.toHaveBeenCalled();
    expect(screen.queryByText("Connect Google")).toBeNull();
  });
  beforeEach(() => {
    localStorage.clear();
    rememberBoard();
  });
  it("persists a marked day across remounts, blocks logging, and allows cancellation without Jira mutations", async () => {
    const api = testApi();
    api.search.mockResolvedValue({ issues: [], isLast: true });
    api.getWorklogs.mockResolvedValue([]);
    const store = sharedStore();
    const view = render(<Timesheet {...props} api={api} dayOffStore={store} />);
    const checkbox = await screen.findByRole("checkbox", { name: `Day off ${emptyDay}` });
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(store.set).toHaveBeenCalledWith(
        baseUrl,
        "me",
        emptyDay,
        true,
        expect.any(AbortSignal),
        expect.any(Function),
      ),
    );
    await waitFor(() => expect(checkbox).toBeChecked());
    const cell = await screen.findByRole("textbox", { name: `PV-1, ${emptyDay}, hours` });
    expect(cell).toBeDisabled();
    expect(api.saveWorklog).not.toHaveBeenCalled();
    expect(api.deleteWorklog).not.toHaveBeenCalled();
    view.unmount();
    render(<Timesheet {...props} api={api} dayOffStore={store} />);
    const restored = await screen.findByRole("checkbox", { name: `Day off ${emptyDay}` });
    await waitFor(() => expect(restored).toBeChecked());
    await waitFor(() => expect(restored).toBeEnabled());
    fireEvent.click(restored);
    await waitFor(() =>
      expect(store.set).toHaveBeenLastCalledWith(
        baseUrl,
        "me",
        emptyDay,
        false,
        expect.any(AbortSignal),
        expect.any(Function),
      ),
    );
    await waitFor(() => expect(restored).not.toBeChecked());
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: `PV-1, ${emptyDay}, hours` }),
      ).toBeEnabled(),
    );
    expect(api.saveWorklog).not.toHaveBeenCalled();
    expect(api.deleteWorklog).not.toHaveBeenCalled();
  });
  it("rechecks shared Day Off before saving a draft when the flag changed outside this view", async () => {
    const api = testApi();
    api.search.mockResolvedValue({ issues: [], isLast: true });
    api.getWorklogs.mockResolvedValue([]);
    const store = sharedStore();
    render(<Timesheet {...props} api={api} dayOffStore={store} />);
    const input = await screen.findByRole("textbox", {
      name: `PV-1, ${emptyDay}, hours`,
    });
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "2" } });
    await store.set(baseUrl, "me", emptyDay, true);
    fireEvent.blur(input);
    await screen.findByText(/Uncheck Day off before logging time/);
    expect(api.saveWorklog).not.toHaveBeenCalled();
    expect(input).toHaveValue("2");
  });
  it("prevents marking a day with known own worklogs", async () => {
    const api = testApi();
    const store = sharedStore();
    render(<Timesheet {...props} api={api} dayOffStore={store} />);
    await screen.findByRole("button", { name: /PV-1, .*2 worklogs/ });
    const checkbox = await screen.findByRole("checkbox", { name: `Day off ${today}` });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(store.set).not.toHaveBeenCalled();
    expect(api.saveWorklog).not.toHaveBeenCalled();
  });
  it("allows clearing a preexisting day-off conflict while preserving existing worklogs", async () => {
    const api = testApi();
    const store = sharedStore([{ userId: "me", date: today }]);
    render(<Timesheet {...props} api={api} dayOffStore={store} />);
    const checkbox = await screen.findByRole("checkbox", { name: `Day off ${today}` });
    await waitFor(() => expect(checkbox).toBeChecked());
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(store.set).toHaveBeenCalledWith(
        baseUrl,
        "me",
        today,
        false,
        expect.any(AbortSignal),
        expect.any(Function),
      ),
    );
    await screen.findByRole("button", { name: /PV-1, .*1h 15m, 2 worklogs/ });
    expect(api.saveWorklog).not.toHaveBeenCalled();
    expect(api.deleteWorklog).not.toHaveBeenCalled();
  });
});
