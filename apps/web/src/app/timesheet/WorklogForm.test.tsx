import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnknownWorklogOutcomeError } from "@power-view/jira-client";
import { WorklogForm } from "./WorklogForm";
import { testApi, testIssue, testLog } from "./test-fixtures";
const props = {
  baseUrl: "https://jira.test",
  accountId: "me",
  timeZone: "Europe/Kyiv",
  initialDay: "2026-10-29",
  issue: testIssue,
};
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
describe("Worklog forms", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());
  it("saves once with exact local time conversion and retains the form while pending", async () => {
    const api = testApi();
    let resolve!: (value: ReturnType<typeof testLog>) => void;
    api.saveWorklog.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<WorklogForm api={api} {...props} onSaved={onSaved} onClose={onClose} />);
    expect(screen.getByRole("region", { name: "Log time" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    change("Duration", "1:30");
    fireEvent.submit(
      screen.getByRole("region", { name: "Log time" }).querySelector("form")!,
    );
    fireEvent.submit(
      screen.getByRole("region", { name: "Log time" }).querySelector("form")!,
    );
    await waitFor(() => expect(api.saveWorklog).toHaveBeenCalledTimes(1));
    expect(api.saveWorklog).toHaveBeenCalledWith(
      testIssue,
      { started: "2026-10-29T07:00:00.000Z", timeSpentSeconds: 5400 },
      "me",
      undefined,
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    resolve(testLog("12"));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
  it("preserves historical seconds and original timestamp when only the description changes", async () => {
    const api = testApi();
    const original = testLog("10", "2026-10-29T09:00:32.000+0200", 1801);
    render(
      <WorklogForm
        api={api}
        {...props}
        original={original}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("region", { name: "Edit worklog" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    change("Work description (optional)", "New description");
    fireEvent.click(screen.getByRole("button", { name: "Save worklog" }));
    await waitFor(() =>
      expect(api.saveWorklog).toHaveBeenCalledWith(
        testIssue,
        expect.objectContaining({ started: original.started, timeSpentSeconds: 1801 }),
        "me",
        original,
      ),
    );
  });
  it("requires disambiguation for repeated local times and rejects nonexistent DST times", () => {
    const api = testApi();
    render(
      <WorklogForm
        api={api}
        {...props}
        initialDay="2026-10-25"
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );
    change("Duration", "30m");
    change("Start time", "03:30");
    fireEvent.click(screen.getByRole("button", { name: "Save worklog" }));
    expect(screen.getByRole("alert")).toHaveTextContent("UTC offset");
    expect(api.saveWorklog).not.toHaveBeenCalled();
    change("Date", "2026-03-29");
    fireEvent.click(screen.getByRole("button", { name: "Save worklog" }));
    expect(screen.getByRole("alert")).toHaveTextContent("do not exist");
    expect(api.saveWorklog).not.toHaveBeenCalled();
  });
  it("rereads after an unknown outcome and blocks another attempt until explicit verification", async () => {
    const api = testApi();
    api.saveWorklog.mockRejectedValue(new UnknownWorklogOutcomeError());
    render(
      <WorklogForm
        api={api}
        {...props}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );
    change("Duration", "90m");
    fireEvent.click(screen.getByRole("button", { name: "Save worklog" }));
    await screen.findByText(/Available own records after rereading/);
    expect(api.getWorklogs).toHaveBeenCalledWith(testIssue);
    expect(screen.getByRole("button", { name: "Save worklog" })).toBeDisabled();
    expect(api.saveWorklog).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked Jira/ }));
    expect(screen.getByRole("button", { name: "Save worklog" })).toBeEnabled();
  });
  it("deletes the explicitly confirmed record and protects unsaved input on cancellation", async () => {
    const api = testApi();
    const original = testLog();
    const close = vi.fn();
    const view = render(
      <WorklogForm
        api={api}
        {...props}
        original={original}
        deleting
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={close}
      />,
    );
    expect(screen.getByRole("region", { name: "Delete worklog" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.deleteWorklog).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() =>
      expect(api.deleteWorklog).toHaveBeenCalledWith(testIssue, original, "me"),
    );
    view.unmount();
    close.mockClear();
    render(
      <WorklogForm
        api={api}
        {...props}
        onSaved={vi.fn().mockResolvedValue(undefined)}
        onClose={close}
      />,
    );
    change("Duration", "30m");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Duration")).toHaveValue("30m");
  });
});
