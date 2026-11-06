import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DayOffReadResult, DayOffStore } from "../day-off/DayOffStore";
import { Timesheet } from "./Timesheet";
import { dayInZone } from "./timesheet-model";
import { testApi } from "./test-fixtures";

const baseUrl = "https://jira.test";
const day = dayInZone(new Date(), "Europe/Kyiv");
const incomplete: DayOffReadResult = {
  dayOffs: [],
  complete: false,
  warnings: ["The shared calendar could not be read."],
};
function fixture() {
  const api = testApi();
  api.search.mockResolvedValue({ issues: [], isLast: true });
  api.getWorklogs.mockResolvedValue([]);
  const store = {
    connect: vi.fn<DayOffStore["connect"]>().mockResolvedValue(undefined),
    read: vi.fn<DayOffStore["read"]>().mockResolvedValue({
      dayOffs: [{ userId: "me", date: day }],
      complete: true,
      warnings: [],
    }),
    set: vi.fn<DayOffStore["set"]>().mockResolvedValue(undefined),
  };
  const element = (
    <Timesheet
      api={api}
      dayOffStore={store}
      baseUrl={baseUrl}
      accountId="me"
      userName="Alex"
    />
  );
  return { api, store, element };
}

describe("Established shared Day Off during refresh", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      `power-view:weekly-tasks:v1:${baseUrl}:me`,
      JSON.stringify({ boardId: 1, pins: {} }),
    );
  });

  it.each(["incomplete", "rejected"] as const)(
    "keeps a known day off blocked while refreshing and after a %s reread",
    async (outcome) => {
      const { api, store, element } = fixture();
      render(element);
      const checkbox = await screen.findByRole("checkbox", { name: `Day off ${day}` });
      await waitFor(() => expect(checkbox).toBeChecked());
      const input = await screen.findByRole("textbox", { name: `PV-1, ${day}, hours` });
      expect(input).toBeDisabled();
      let resolveRead!: (value: DayOffReadResult) => void;
      let rejectRead!: (reason: Error) => void;
      store.read.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveRead = resolve;
            rejectRead = reject;
          }),
      );
      await act(async () => {
        window.dispatchEvent(new Event("powerview:shared-day-off-changed"));
        await Promise.resolve();
      });
      await screen.findByText("Loading Day Off…");
      expect(checkbox).toBeChecked();
      expect(input).toBeDisabled();

      await act(async () => {
        if (outcome === "incomplete") resolveRead(incomplete);
        else rejectRead(new Error("The shared calendar could not be read."));
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.queryByText("Loading Day Off…")).toBeNull());
      expect(checkbox).toBeChecked();
      expect(input).toBeDisabled();
      expect(api.saveWorklog).not.toHaveBeenCalled();
    },
  );

  it("still verifies before writing after remount when the shared calendar is incomplete", async () => {
    const { api, store, element } = fixture();
    const view = render(element);
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: `Day off ${day}` })).toBeChecked(),
    );
    view.unmount();
    store.read.mockResolvedValue(incomplete);
    store.read.mockClear();
    render(element);
    const input = await screen.findByRole("textbox", { name: `PV-1, ${day}, hours` });
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input);
    await screen.findByText(/Shared Day Off could not be verified/);
    expect(store.read).toHaveBeenCalledWith(baseUrl, ["me"], [day]);
    expect(api.saveWorklog).not.toHaveBeenCalled();
    expect(input).toHaveValue("2");
  });
});
