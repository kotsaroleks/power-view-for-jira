import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  TimeReportPanel,
  type TimeReportTeamsApi,
  type MyTimeReportTeam,
} from "./TimeReportPanel";
import { testApi, testLog } from "../timesheet/test-fixtures";
const discovered = { id: "team", name: "Delivery", organizationId: "org" };
const team = {
  id: "team",
  name: "Delivery",
  members: [{ accountId: "me", displayName: "Alex" }],
};
function setup(list = [discovered]) {
  const api = testApi();
  api.getWorklogs.mockResolvedValue([testLog("1", "2026-10-26T10:00:00Z", 7200)]);
  const teamsApi = {
    listMyTeams: vi.fn<TimeReportTeamsApi["listMyTeams"]>().mockResolvedValue(list),
    loadTeam: vi.fn<TimeReportTeamsApi["loadTeam"]>().mockResolvedValue(team),
  };
  const props = {
    api,
    teamsApi,
    accountId: "me",
    baseUrl: "https://example.atlassian.net",
  };
  const view = render(<TimeReportPanel {...props} />);
  fireEvent.change(screen.getByLabelText("Week containing"), {
    target: { value: "2026-10-26" },
  });
  fireEvent.change(screen.getByLabelText("Report time zone"), {
    target: { value: "UTC" },
  });
  return { api, teamsApi, props, ...view };
}
const ready = () =>
  waitFor(() =>
    expect(screen.getByRole("button", { name: "Load Time Report" })).toBeEnabled(),
  );
const load = () =>
  fireEvent.click(screen.getByRole("button", { name: "Load Time Report" }));
describe("TimeReportPanel", () => {
  it("switches to a full calendar month and searches only that period", async () => {
    const { api } = setup();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(screen.getByLabelText("Month", { exact: true }), {
      target: { value: "2028-02" },
    });
    api.getWorklogs.mockResolvedValue([
      testLog("leap", "2028-02-29T12:00:00Z", 10800),
      testLog("next", "2028-03-01T00:00:00Z", 3600),
    ]);
    load();
    await screen.findByRole("button", { name: "Alex" });
    expect(api.search).toHaveBeenCalledWith(
      expect.stringContaining(
        'worklogDate >= "2028-01-30" AND worklogDate < "2028-03-03"',
      ),
      undefined,
      expect.any(AbortSignal),
    );
    expect(screen.getByText("2028-02-01 – 2028-02-29")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(33);
    expect(screen.getByRole("button", { name: "Next month" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByLabelText("Month", { exact: true })).toHaveValue("2028-03");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
    expect(screen.getByLabelText("Week containing")).toHaveValue("2028-03-01");
  });
  it("aborts the old period and ignores its late results when switching modes", async () => {
    const { api } = setup();
    await ready();
    let resolve!: (value: Awaited<ReturnType<typeof api.search>>) => void;
    api.search.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    load();
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1));
    const oldSignal = api.search.mock.calls[0]![2]!;
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(oldSignal.aborted).toBe(true);
    resolve({ issues: [], isLast: true });
    await waitFor(() => expect(screen.queryByRole("table")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Month", { exact: true })).toBeInTheDocument();
  });
  it("automatically finds My teams but reads worklogs only after explicit Load", async () => {
    const { api, teamsApi } = setup();
    await ready();
    expect(teamsApi.listMyTeams).toHaveBeenCalledWith("me", expect.any(AbortSignal));
    expect(api.getUser).toHaveBeenCalledTimes(2);
    expect(api.search).not.toHaveBeenCalled();
    expect(teamsApi.loadTeam).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Atlassian team link")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Organization ID")).not.toBeInTheDocument();
    load();
    await screen.findByRole("button", { name: "Alex" });
    expect(teamsApi.loadTeam).toHaveBeenCalledWith(
      "org",
      "team",
      expect.any(AbortSignal),
    );
    expect(api.search).toHaveBeenCalledWith(
      expect.stringMatching(/^worklogAuthor in \(.*worklogDate >=.*worklogDate </),
      undefined,
      expect.any(AbortSignal),
    );
    expect(screen.queryByText("40h")).not.toBeInTheDocument();
    expect(screen.queryByText("5.0%")).not.toBeInTheDocument();
  });
  it("requires a choice among multiple teams and uses both organization and team ID", async () => {
    const { teamsApi } = setup([
      discovered,
      { id: "team", name: "Platform", organizationId: "other-org" },
    ]);
    await screen.findByRole("option", { name: "Platform" });
    expect(screen.getByLabelText("My teams")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Load Time Report" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("My teams"), {
      target: { value: JSON.stringify(["other-org", "team"]) },
    });
    load();
    await screen.findByRole("button", { name: "Alex" });
    expect(teamsApi.loadTeam).toHaveBeenCalledWith(
      "other-org",
      "team",
      expect.any(AbortSignal),
    );
  });
  it("keeps the first request after automatic selection and immediate team changes alive", async () => {
    const { api, teamsApi } = setup();
    await ready();
    load();
    await screen.findByRole("button", { name: "Alex" });
    expect(teamsApi.loadTeam.mock.calls[0]![2].aborted).toBe(false);
    teamsApi.listMyTeams.mockResolvedValue([
      discovered,
      { id: "next", name: "Next team", organizationId: "org" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh teams" }));
    await screen.findByRole("option", { name: "Next team" });
    fireEvent.change(screen.getByLabelText("My teams"), {
      target: { value: JSON.stringify(["org", "next"]) },
    });
    load();
    await screen.findByRole("button", { name: "Alex" });
    expect(teamsApi.loadTeam.mock.calls[1]![2].aborted).toBe(false);
    expect(api.search).toHaveBeenCalledTimes(2);
  });
  it("shows empty membership without fabricating a roster", async () => {
    const { api } = setup([]);
    await screen.findByText(/No teams were found/);
    expect(screen.getByRole("button", { name: "Load Time Report" })).toBeDisabled();
    expect(api.search).not.toHaveBeenCalled();
  });
  it("retries discovery errors and refresh invalidates previously loaded report", async () => {
    const { teamsApi } = setup();
    await ready();
    load();
    await screen.findByRole("button", { name: "Alex" });
    teamsApi.listMyTeams.mockRejectedValueOnce(new Error("Teams unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh teams" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await screen.findByText("Teams unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry teams" }));
    await ready();
    expect(teamsApi.listMyTeams).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("ignores a late old-account discovery even when the API ignores abort", async () => {
    const { api, teamsApi, props, rerender } = setup();
    await ready();
    let resolve!: (teams: MyTimeReportTeam[]) => void;
    teamsApi.listMyTeams.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh teams" }));
    await waitFor(() => expect(teamsApi.listMyTeams).toHaveBeenCalledTimes(2));
    api.getUser.mockResolvedValue({ accountId: "other", displayName: "Other" });
    teamsApi.listMyTeams.mockResolvedValue([
      { id: "new", organizationId: "new-org", name: "New account team" },
    ]);
    rerender(<TimeReportPanel {...props} accountId="other" />);
    await screen.findByRole("option", { name: "New account team" });
    resolve([{ ...discovered, name: "Old account team" }]);
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "Old account team" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText("My teams")).toHaveValue(
      JSON.stringify(["new-org", "new"]),
    );
  });
  it("checks identity again after discovery and withholds mismatched lists", async () => {
    const { api } = setup();
    api.getUser.mockResolvedValue({ accountId: "other", displayName: "Other" });
    await screen.findByText(/Jira account changed/);
    expect(screen.queryByRole("option", { name: "Delivery" })).not.toBeInTheDocument();
    expect(api.search).not.toHaveBeenCalled();
  });
  it("preserves membership warnings and withholds a partial worklog report", async () => {
    const { api, teamsApi } = setup();
    await ready();
    teamsApi.loadTeam.mockResolvedValue({
      ...team,
      warnings: ["One profile is unavailable."],
    });
    api.getWorklogs.mockRejectedValue(new Error("Forbidden issue"));
    load();
    await screen.findByText(/Incomplete report:/);
    expect(screen.getByText("One profile is unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("cancels report roster reads and ignores their late resolution", async () => {
    const { api, teamsApi } = setup();
    await ready();
    let resolve!: (value: typeof team) => void;
    teamsApi.loadTeam.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    load();
    await waitFor(() => expect(teamsApi.loadTeam).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel loading" }));
    resolve(team);
    await screen.findByText(/Loading cancelled/);
    expect(api.search).not.toHaveBeenCalled();
  });
  it("invalidates completed results after a different week is selected", async () => {
    setup();
    await ready();
    load();
    await screen.findByRole("button", { name: "Alex" });
    fireEvent.change(screen.getByLabelText("Week containing"), {
      target: { value: "2026-11-02" },
    });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
