import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timesheet } from "./Timesheet";
import { testApi, testLog } from "./test-fixtures";
import { dayInZone } from "./timesheet-model";

beforeEach(() => localStorage.clear());
function setup() {
  const api = testApi();
  api.getWorklogs.mockResolvedValue([testLog()]);
  render(
    <Timesheet api={api} baseUrl="https://jira.test" accountId="me" userName="Alex" />,
  );
  return api;
}

describe("Worklog details popup", () => {
  it("explains the ellipsis on hover and opens a modal without changing records", async () => {
    const api = setup();
    const trigger = await screen.findByRole("button", { name: /PV-1, .*1 worklogs/ });
    fireEvent.mouseEnter(trigger);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Worklog details");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
    fireEvent.click(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "Worklog details" });
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("region", { name: "Worklog details" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Edit worklog 10" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(trigger).toHaveFocus();
    expect(api.saveWorklog).not.toHaveBeenCalled();
    expect(api.deleteWorklog).not.toHaveBeenCalled();
  });

  it("opens details with Alt+Down and returns focus to the hours field", async () => {
    const api = setup();
    const day = dayInZone(testLog().started, "Europe/Kyiv");
    const input = await screen.findByRole("textbox", {
      name: `PV-1, ${day}, hours`,
    });
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown", altKey: true });
    const dialog = screen.getByRole("dialog", { name: "Worklog details" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close details" }));
    expect(input).toHaveFocus();
    expect(api.saveWorklog).not.toHaveBeenCalled();
  });

  it("keeps editing inside the popup and prevents accidental dismissal of a draft", async () => {
    const api = setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      fireEvent.click(await screen.findByRole("button", { name: /PV-1, .*1 worklogs/ }));
      fireEvent.click(screen.getByRole("button", { name: "Edit worklog 10" }));
      const dialog = screen.getByRole("dialog", { name: "Edit worklog" });
      expect(within(dialog).getByRole("region", { name: "Edit worklog" })).toBeVisible();
      fireEvent.change(within(dialog).getByLabelText("Duration"), {
        target: { value: "2h" },
      });
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      expect(confirm).toHaveBeenCalledWith("Discard the unsaved worklog form?");
      expect(dialog).toBeVisible();
      expect(within(dialog).getByLabelText("Duration")).toHaveValue("2h");
      expect(api.saveWorklog).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /PV-1, .*1 worklogs/ })).toHaveFocus(),
      );
    } finally {
      confirm.mockRestore();
    }
  });
});
