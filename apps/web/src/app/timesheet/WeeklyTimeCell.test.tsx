import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnknownWorklogOutcomeError } from "@power-view/jira-client";
import { WeeklyTimeCell } from "./WeeklyTimeCell";
import { testApi, testIssue, testLog } from "./test-fixtures";
const day = "2026-11-02";
function fixture(logs: ReturnType<typeof testLog>[] = []) {
  const api = testApi();
  api.getWorklogs.mockResolvedValue(logs);
  const onSaved = vi.fn().mockResolvedValue(undefined);
  const onReload = vi.fn();
  const onIdentityError = vi.fn();
  const cell = (accountId = "me") => (
    <WeeklyTimeCell
      api={api}
      issue={testIssue}
      day={day}
      zone="Europe/Kyiv"
      accountId={accountId}
      logs={logs}
      disabled={false}
      onSaved={onSaved}
      onDetails={vi.fn()}
      onActivity={vi.fn()}
      onIdentityError={onIdentityError}
      onReload={onReload}
    />
  );
  const view = render(cell());
  return {
    api,
    onSaved,
    onReload,
    onIdentityError,
    view,
    cell,
    input: screen.getByRole("textbox"),
  };
}
function enter(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}
describe("Weekly direct hour entry", () => {
  it("creates decimal hours at 09:00 local time, once, without a comment", async () => {
    const { api, input, onSaved } = fixture();
    enter(input, "1,5");
    fireEvent.blur(input);
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(api.saveWorklog).toHaveBeenCalledExactlyOnceWith(
      testIssue,
      { started: "2026-11-02T07:00:00.000Z", timeSpentSeconds: 5400 },
      "me",
      undefined,
    );
  });
  it("updates a single entry preserving its timestamp and full comment", async () => {
    const log = {
      ...testLog("10", `${day}T14:03:27+0200`),
      comment: { type: "doc", version: 1, content: [] },
    };
    const { api, input } = fixture([log]);
    enter(input, "2:15");
    await waitFor(() => expect(api.saveWorklog).toHaveBeenCalledOnce());
    expect(api.saveWorklog).toHaveBeenCalledWith(
      testIssue,
      { started: log.started, timeSpentSeconds: 8100, comment: log.comment },
      "me",
      log,
    );
  });
  it("rejects stale empty cells when a worklog appeared in Jira", async () => {
    const { api, input } = fixture();
    api.getWorklogs.mockResolvedValue([testLog("10", `${day}T09:00:00+0200`)]);
    enter(input, "2");
    await screen.findByText(/This cell changed in Jira/);
    expect(api.saveWorklog).not.toHaveBeenCalled();
    expect(input).toHaveValue("2");
  });
  it("blocks unknown-outcome retries and offers an explicit reread", async () => {
    const { api, input, onReload } = fixture();
    api.saveWorklog.mockRejectedValue(new UnknownWorklogOutcomeError());
    enter(input, "2");
    await screen.findByText(/operation result is unknown/);
    fireEvent.blur(input);
    expect(api.saveWorklog).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh records" }));
    expect(onReload).toHaveBeenCalledOnce();
  });
  it("keeps an unknown POST locked and its draft after refresh remount, until explicit acknowledgement", async () => {
    const { api, input, view, cell } = fixture();
    api.saveWorklog.mockRejectedValue(new UnknownWorklogOutcomeError());
    enter(input, "2");
    await screen.findByText(/operation result is unknown/);
    view.unmount();
    render(cell()); // Refresh returned no records; absence is not proof of failed POST.
    const refreshed = screen.getByRole("textbox");
    expect(refreshed).toHaveValue("2");
    expect(refreshed).toBeDisabled();
    fireEvent.blur(refreshed);
    expect(api.saveWorklog).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "I checked Jira; allow another attempt" }),
    );
    expect(refreshed).not.toBeDisabled();
    expect(api.saveWorklog).toHaveBeenCalledTimes(1);
    fireEvent.blur(refreshed);
    await waitFor(() => expect(api.saveWorklog).toHaveBeenCalledTimes(2));
  });
  it("does not expose an unresolved draft to another account", async () => {
    const { api, input, view, cell } = fixture();
    api.saveWorklog.mockRejectedValue(new UnknownWorklogOutcomeError());
    enter(input, "2");
    await screen.findByText(/operation result is unknown/);
    view.unmount();
    render(cell("other"));
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("textbox")).not.toBeDisabled();
    expect(screen.queryByText(/operation result is unknown/)).not.toBeInTheDocument();
  });
  it("keeps a confirmed write locked if rereading fails and refresh finds no record", async () => {
    const { api, input, view, cell, onSaved } = fixture();
    onSaved.mockRejectedValue(new Error("Reread failed"));
    enter(input, "2");
    await screen.findByText(/Reread failed/);
    view.unmount();
    render(cell());
    const refreshed = screen.getByRole("textbox");
    expect(refreshed).toBeDisabled();
    expect(refreshed).toHaveValue("2");
    fireEvent.blur(refreshed);
    expect(api.saveWorklog).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: /I checked Jira/ }),
    ).not.toBeInTheDocument();
  });
  it("does not write an unchanged duration, cleared cell, or zero", async () => {
    const { api, input } = fixture();
    fireEvent.blur(input);
    enter(input, "0");
    await screen.findByText(/Use details to delete/);
    expect(api.saveWorklog).not.toHaveBeenCalled();
    enter(input, "");
    expect(input).toHaveValue("");
  });
  it("checks identity before reading or writing private worklogs", async () => {
    const { api, input, onIdentityError } = fixture();
    api.getUser.mockResolvedValue({ accountId: "other", displayName: "Other" });
    enter(input, "2");
    await waitFor(() => expect(onIdentityError).toHaveBeenCalledOnce());
    expect(api.getWorklogs).not.toHaveBeenCalled();
    expect(api.saveWorklog).not.toHaveBeenCalled();
  });
});
