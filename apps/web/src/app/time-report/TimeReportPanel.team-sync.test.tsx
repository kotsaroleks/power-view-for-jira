import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DayOffStore } from "../day-off/DayOffStore";
import { testApi } from "../timesheet/test-fixtures";
import { TimeReportPanel, type TimeReportTeamsApi } from "./TimeReportPanel";

const team = {
  id: "team",
  name: "Delivery",
  members: [
    { accountId: "me", displayName: "Alex", jiraEmail: "alex@example.com" },
    { accountId: "other", displayName: "Robin" },
  ],
};
function setup(multiple = false) {
  const api = testApi();
  const teamsApi = {
    listMyTeams: vi
      .fn<TimeReportTeamsApi["listMyTeams"]>()
      .mockResolvedValue([
        { id: "team", name: "Delivery", organizationId: "org" },
        ...(multiple ? [{ id: "next", name: "Platform", organizationId: "org" }] : []),
      ]),
    loadTeam: vi.fn<TimeReportTeamsApi["loadTeam"]>().mockResolvedValue(team),
  };
  const store = {
    connect: vi.fn<DayOffStore["connect"]>().mockResolvedValue(undefined),
    read: vi
      .fn<DayOffStore["read"]>()
      .mockResolvedValue({ dayOffs: [], complete: true, warnings: [] }),
    set: vi.fn<DayOffStore["set"]>().mockResolvedValue(undefined),
    syncTeam: vi
      .fn<NonNullable<DayOffStore["syncTeam"]>>()
      .mockResolvedValue({ synced: 2, unmapped: 1, inactive: 3 }),
  };
  const props = {
    api,
    teamsApi,
    dayOffStore: store,
    baseUrl: "https://jira.test",
    accountId: "me",
  };
  const view = render(<TimeReportPanel {...props} />);
  return { api, teamsApi, store, props, view };
}
async function ready() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Sync Jira team" })).toBeEnabled(),
  );
}
describe("Explicit Jira team sync", () => {
  it("syncs the live roster only after clicking, reports counts, and does not read or change Jira worklogs", async () => {
    const { api, teamsApi, store } = setup();
    await ready();
    expect(teamsApi.loadTeam).not.toHaveBeenCalled();
    expect(store.syncTeam).not.toHaveBeenCalled();
    const identitiesBefore = api.getUser.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Sync Jira team" }));
    fireEvent.click(screen.getByRole("button", { name: "Sync Jira team" }));
    await screen.findByText("2 Jira members synced");
    expect(teamsApi.loadTeam).toHaveBeenCalledWith(
      "org",
      "team",
      expect.any(AbortSignal),
    );
    expect(store.syncTeam).toHaveBeenCalledExactlyOnceWith(
      "https://jira.test",
      team,
      expect.any(AbortSignal),
    );
    expect(api.getUser.mock.calls.length).toBe(identitiesBefore + 2);
    expect(api.search).not.toHaveBeenCalled();
    expect(api.getWorklogs).not.toHaveBeenCalled();
    expect(api.saveWorklog).not.toHaveBeenCalled();
    expect(api.deleteWorklog).not.toHaveBeenCalled();
  });
  it("does not sync automatically when the report is loaded", async () => {
    const { store } = setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Load Time Report" }));
    await screen.findByRole("button", { name: "Alex" });
    expect(store.syncTeam).not.toHaveBeenCalled();
  });
  it("requires GitHub sync capability instead of claiming success", async () => {
    const { props, store, view } = setup();
    const withoutSync: DayOffStore = {
      connect: store.connect,
      read: store.read,
      set: store.set,
    };
    view.rerender(<TimeReportPanel {...props} dayOffStore={withoutSync} />);
    await screen.findByRole("option", { name: "Delivery" });
    expect(screen.getByRole("button", { name: "Sync Jira team" })).toBeDisabled();
    expect(
      screen.getByText("Team sync requires GitHub access in the Chrome extension."),
    ).toBeVisible();
    expect(store.syncTeam).not.toHaveBeenCalled();
  });
  it("checks identity again after loading the roster and refuses a changed account", async () => {
    const { api, store } = setup();
    await ready();
    api.getUser
      .mockResolvedValueOnce({ accountId: "me", displayName: "Alex" })
      .mockResolvedValueOnce({ accountId: "other", displayName: "Robin" });
    fireEvent.click(screen.getByRole("button", { name: "Sync Jira team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Jira account changed");
    expect(store.syncTeam).not.toHaveBeenCalled();
    expect(api.search).not.toHaveBeenCalled();
  });
  it("aborts a previous team and ignores its late roster response", async () => {
    const { teamsApi, store } = setup(true);
    await screen.findByRole("option", { name: "Platform" });
    fireEvent.change(screen.getByLabelText("My teams"), {
      target: { value: JSON.stringify(["org", "team"]) },
    });
    await ready();
    let resolve!: (value: typeof team) => void;
    teamsApi.loadTeam.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync Jira team" }));
    await waitFor(() => expect(teamsApi.loadTeam).toHaveBeenCalledOnce());
    const oldSignal = teamsApi.loadTeam.mock.calls[0]![2];
    fireEvent.change(screen.getByLabelText("My teams"), {
      target: { value: JSON.stringify(["org", "next"]) },
    });
    expect(oldSignal.aborted).toBe(true);
    resolve(team);
    await ready();
    expect(store.syncTeam).not.toHaveBeenCalled();
    expect(screen.queryByText(/synced ·/)).toBeNull();
  });
  it("ignores a late storage result after the Jira instance changes", async () => {
    const { props, store, view } = setup();
    await ready();
    let resolve!: (value: { synced: number; unmapped: number; inactive: number }) => void;
    store.syncTeam.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync Jira team" }));
    await waitFor(() => expect(store.syncTeam).toHaveBeenCalledOnce());
    const oldSignal = store.syncTeam.mock.calls[0]![2]!;
    view.rerender(<TimeReportPanel {...props} baseUrl="https://another.atlassian.net" />);
    expect(oldSignal.aborted).toBe(true);
    resolve({ synced: 999, unmapped: 0, inactive: 0 });
    await ready();
    expect(screen.queryByText(/999 synced/)).toBeNull();
  });
  it("reports a storage failure without inventing synced counts", async () => {
    const { store } = setup();
    await ready();
    store.syncTeam.mockRejectedValueOnce(
      new Error("GitHub application access is unavailable."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync Jira team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GitHub application access is unavailable.",
    );
    expect(screen.queryByText(/synced ·/)).toBeNull();
  });
});
