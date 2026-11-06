import { browserDayOffStore } from "../day-off/browser-github-day-off";
import { useSharedDayOff } from "../day-off/use-shared-day-off";
import type { DayOffStore } from "../day-off/DayOffStore";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TimesheetApi } from "@power-view/jira-client";
import type { TimeReportInput } from "@power-view/domain";
import { dayInZone, periodDays, type PeriodMode } from "../timesheet/timesheet-model";
import { loadTimeReport, type TimeReportData } from "./time-report-loader";
import { TimeReportView } from "./TimeReportView";

export interface MyTimeReportTeam {
  id: string;
  name: string;
  organizationId: string;
}
export interface TimeReportTeamsApi {
  listMyTeams(accountId: string, signal: AbortSignal): Promise<MyTimeReportTeam[]>;
  loadTeam(
    orgId: string,
    teamId: string,
    signal: AbortSignal,
  ): Promise<{
    id: string;
    name: string;
    members: Array<{ accountId: string; displayName: string; jiraEmail?: string }>;
    warnings?: string[];
  }>;
}
export interface TimeReportPanelProps {
  api: TimesheetApi;
  dayOffStore?: DayOffStore;
  teamsApi: TimeReportTeamsApi;
  baseUrl: string;
  accountId: string;
}
interface Snapshot {
  key: string;
  teamName: string;
  warnings: string[];
  input: TimeReportInput;
  data: TimeReportData;
}
/** Worklog reads run only after an explicit submit; changed selections invalidate results. */
export function TimeReportPanel({
  api,
  dayOffStore = browserDayOffStore(),
  teamsApi,
  baseUrl,
  accountId,
}: TimeReportPanelProps) {
  const [selectedTeam, setSelectedTeam] = useState("");
  const [teamRefresh, setTeamRefresh] = useState(0);
  const [teamList, setTeamList] = useState<{
    key: string;
    teams: MyTimeReportTeam[];
    loading: boolean;
    error: string;
  }>();
  const teamListKey = JSON.stringify([baseUrl, accountId, teamRefresh]);
  const currentTeamListKey = useRef(teamListKey);
  currentTeamListKey.current = teamListKey;
  const availableTeams =
    teamList?.key === teamListKey && !teamList.loading && !teamList.error
      ? teamList.teams
      : [];
  const teamChoice = availableTeams.find(
    (team) => JSON.stringify([team.organizationId, team.id]) === selectedTeam,
  );
  const teamLoading = teamList?.key !== teamListKey || teamList.loading;
  const teamError = teamList?.key === teamListKey ? teamList.error : "";
  useEffect(() => {
    const request = new AbortController();
    const requestKey = teamListKey;
    const active = () =>
      !request.signal.aborted && currentTeamListKey.current === requestKey;
    setSelectedTeam("");
    setTeamList({ key: requestKey, teams: [], loading: true, error: "" });
    void (async () => {
      try {
        if (!accountId) throw new Error("Connect your Jira account to find your teams.");
        const checkIdentity = async () => {
          const user = await api.getUser(request.signal);
          request.signal.throwIfAborted();
          if (user.accountId !== accountId)
            throw new Error("The Jira account changed. Reconnect in Settings.");
        };
        await checkIdentity();
        const result = await teamsApi.listMyTeams(accountId, request.signal);
        request.signal.throwIfAborted();
        await checkIdentity();
        if (!active()) return;
        const unique = new Map<string, MyTimeReportTeam>();
        for (const team of result) {
          if (!team.id || !team.organizationId)
            throw new Error("Team discovery returned an invalid team.");
          unique.set(JSON.stringify([team.organizationId, team.id]), team);
        }
        const teams = [...unique.values()];
        setTeamList({ key: requestKey, teams, loading: false, error: "" });
        setSelectedTeam(teams.length === 1 ? [...unique.keys()][0]! : "");
      } catch (reason) {
        if (active())
          setTeamList({
            key: requestKey,
            teams: [],
            loading: false,
            error:
              reason instanceof Error
                ? reason.message
                : "Your teams could not be loaded.",
          });
      }
    })();
    return () => request.abort();
  }, [teamListKey, accountId, api, teamsApi]);
  const syncKey = JSON.stringify([baseUrl, accountId, teamListKey, selectedTeam]);
  const currentSyncKey = useRef(syncKey);
  currentSyncKey.current = syncKey;
  const syncController = useRef<AbortController | undefined>(undefined);
  const [syncState, setSyncState] = useState<{
    key: string;
    busy: boolean;
    message: string;
    error: string;
  }>();
  const currentSync = syncState?.key === syncKey ? syncState : undefined;
  useLayoutEffect(() => {
    syncController.current?.abort();
    syncController.current = undefined;
    setSyncState(undefined);
    return () => syncController.current?.abort();
  }, [syncKey, api, teamsApi, dayOffStore]);
  const syncTeam = async () => {
    if (!teamChoice || !accountId || syncController.current) return;
    const request = new AbortController();
    syncController.current = request;
    const requestKey = syncKey;
    const active = () =>
      !request.signal.aborted &&
      currentSyncKey.current === requestKey &&
      syncController.current === request;
    setSyncState({
      key: requestKey,
      busy: true,
      message: "Reading live Jira team membership…",
      error: "",
    });
    try {
      if (!dayOffStore?.syncTeam)
        throw new Error("Team sync requires GitHub access in the Chrome extension.");
      const verifyIdentity = async () => {
        const user = await api.getUser(request.signal);
        request.signal.throwIfAborted();
        if (user.accountId !== accountId)
          throw new Error("The Jira account changed. Reconnect in Settings.");
      };
      await verifyIdentity();
      const team = await teamsApi.loadTeam(
        teamChoice.organizationId,
        teamChoice.id,
        request.signal,
      );
      request.signal.throwIfAborted();
      if (team.id !== teamChoice.id || team.members.some((member) => !member.accountId))
        throw new Error(
          "Jira returned invalid team membership. Refresh teams before syncing.",
        );
      await verifyIdentity();
      if (!active()) return;
      setSyncState({
        key: requestKey,
        busy: true,
        message: "Syncing Jira team to GitHub…",
        error: "",
      });
      const result = await dayOffStore.syncTeam(
        baseUrl,
        {
          id: team.id,
          name: team.name,
          members: [
            ...new Map(team.members.map((member) => [member.accountId, member])).values(),
          ],
        },
        request.signal,
      );
      if (!active()) return;
      setSyncState({
        key: requestKey,
        busy: false,
        message: `${result.synced} Jira members synced`,
        error: "",
      });
      window.dispatchEvent(new Event("powerview:shared-day-off-changed"));
    } catch (reason) {
      if (active())
        setSyncState({
          key: requestKey,
          busy: false,
          message: "",
          error:
            reason instanceof Error ? reason.message : "Jira team could not be synced.",
        });
    } finally {
      if (syncController.current === request) syncController.current = undefined;
    }
  };
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [periodMode, setPeriodMode] = useState<PeriodMode>("week");
  const [anchor, setAnchor] = useState(() => dayInZone(new Date(), timeZone));
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const key = JSON.stringify([
    baseUrl,
    accountId,
    teamListKey,
    selectedTeam,
    anchor,
    periodMode,
    timeZone,
  ]);
  const currentKey = useRef(key);
  currentKey.current = key;
  // Invalidate before the newly selected controls can receive a click. A passive
  // cleanup reading controller.current could otherwise abort a newer Load request.
  useLayoutEffect(() => {
    const previousRequest = controller.current;
    previousRequest?.abort();
    controller.current = undefined;
    setBusy(false);
    setError("");
    setProgress("");
    setSnapshot(undefined);
  }, [key, api, teamsApi]);
  useLayoutEffect(() => () => controller.current?.abort(), []);
  const load = async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const requestKey = key;
    const active = () =>
      !request.signal.aborted &&
      currentKey.current === requestKey &&
      controller.current === request;
    setBusy(true);
    setSnapshot(undefined);
    setError("");
    setProgress("Reading team membership…");
    try {
      if (!teamChoice)
        throw new Error("Select one of your teams before loading the report.");
      dayInZone(new Date(), timeZone);
      const identity = await api.getUser(request.signal);
      if (identity.accountId !== accountId)
        throw new Error("The Jira account changed. Reconnect in Settings.");
      request.signal.throwIfAborted();
      const team = await teamsApi.loadTeam(
        teamChoice.organizationId,
        teamChoice.id,
        request.signal,
      );
      request.signal.throwIfAborted();
      if (!team.members.length)
        throw new Error(
          "This team has no available members. Check team access and membership.",
        );
      const members = new Map(team.members.map((member) => [member.accountId, member]));
      if ([...members.keys()].some((id) => !id))
        throw new Error("Team membership contains an invalid account ID.");
      const days = periodDays(anchor, periodMode);
      const data = await loadTimeReport(
        api,
        { accountIds: [...members.keys()], days, timeZone, periodMode },
        accountId,
        request.signal,
        (message) => {
          if (active()) setProgress(message);
        },
      );
      if (!active()) return;
      setSnapshot({
        key: requestKey,
        teamName: team.name,
        warnings: team.warnings ?? [],
        data,
        input: {
          weekStart: days[0]!,
          periodMode,
          users: [...members.values()].map((member) => ({
            userId: member.accountId,
            displayName: member.displayName,
          })),
          worklogs: data.worklogs.map((log) => ({
            id: log.id,
            userId: log.authorId,
            issueKey: log.issueKey,
            day: dayInZone(log.started, timeZone),
            timeSpentSeconds: log.timeSpentSeconds,
          })),
          dayOffs: [],
        },
      });
    } catch (reason) {
      if (active())
        setError(
          reason instanceof Error ? reason.message : "Time Report could not be loaded.",
        );
    } finally {
      if (active()) setBusy(false);
    }
  };
  const shown = snapshot?.key === key ? snapshot : undefined;
  const dayOff = useSharedDayOff(
    dayOffStore,
    baseUrl,
    shown?.input.users.map((user) => user.userId) ?? [],
    periodDays(anchor, periodMode),
  );
  return (
    <section className="reporting-card time-report-panel" aria-label="Load Time Report">
      <header className="reporting-header">
        <div>
          <span className="time-report-eyebrow">TEAM WORKLOGS</span>
          <h2>Time Report</h2>
          <p>Review your team’s logged time across Jira by week or month.</p>
        </div>
        <span className="time-report-badge">Logged hours</span>
      </header>
      <p className="time-report-notice">
        Shared Day Off dates come from GitHub. Unavailable dates are not treated as
        working days.
        {dayOff.available ? (
          <button
            type="button"
            className="text-button"
            disabled={dayOff.busy || dayOff.loading}
            onClick={() => void (dayOff.complete ? dayOff.refresh() : dayOff.connect())}
          >
            {dayOff.complete ? "Refresh Day Off" : "Allow GitHub storage access"}
          </button>
        ) : (
          <span> Сховище Day Off не налаштоване.</span>
        )}
        {dayOff.error ? <span role="alert">{dayOff.error}</span> : null}
        {dayOff.loading ? <span role="status">Loading shared Day Off…</span> : null}
        {dayOff.warnings.map((warning) => (
          <span role="status" key={warning}>
            {warning}
          </span>
        ))}
      </p>
      <form
        className="time-report-form"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <div className="time-report-team-picker">
          <label>
            My teams{" "}
            <select
              value={teamChoice ? selectedTeam : ""}
              disabled={teamLoading || !availableTeams.length}
              onChange={(event) => setSelectedTeam(event.target.value)}
            >
              <option value="">
                {teamLoading ? "Loading your teams…" : "Choose a team"}
              </option>
              {availableTeams.map((team) => (
                <option
                  key={JSON.stringify([team.organizationId, team.id])}
                  value={JSON.stringify([team.organizationId, team.id])}
                >
                  {team.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            type="button"
            disabled={teamLoading}
            onClick={() => setTeamRefresh((value) => value + 1)}
          >
            {teamError ? "Retry teams" : "Refresh teams"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={
              teamLoading ||
              !teamChoice ||
              !accountId ||
              Boolean(currentSync?.busy) ||
              !dayOffStore?.syncTeam
            }
            onClick={() => void syncTeam()}
          >
            Sync Jira team
          </button>
          {!dayOffStore?.syncTeam ? (
            <p className="time-report-help">
              Team sync requires GitHub access in the Chrome extension.
            </p>
          ) : null}
          {currentSync?.message ? (
            <p role="status" className="time-report-help">
              {currentSync.message}
            </p>
          ) : null}
          {currentSync?.error ? (
            <p role="alert" className="time-report-error">
              {currentSync.error}
            </p>
          ) : null}
          {teamLoading ? (
            <p role="status" className="time-report-help">
              Finding your teams…
            </p>
          ) : teamError ? (
            <p role="alert" className="time-report-error time-report-team-message">
              {teamError}
            </p>
          ) : !availableTeams.length ? (
            <p className="time-report-help">
              No teams were found for your account. Check your Atlassian team membership,
              then refresh teams.
            </p>
          ) : null}
        </div>
        <fieldset className="time-report-period">
          <legend>Period</legend>
          <div className="time-report-view-tabs" role="group" aria-label="Report period">
            <button
              type="button"
              aria-pressed={periodMode === "week"}
              onClick={() => setPeriodMode("week")}
            >
              Weekly
            </button>
            <button
              type="button"
              aria-pressed={periodMode === "month"}
              onClick={() => setPeriodMode("month")}
            >
              Monthly
            </button>
          </div>
        </fieldset>
        <label>
          {periodMode === "week" ? "Week containing" : "Month"}{" "}
          <input
            type={periodMode === "week" ? "date" : "month"}
            value={periodMode === "week" ? anchor : anchor.slice(0, 7)}
            onChange={(event) => {
              const value = event.target.value;
              if (periodMode === "month" && /^\d{4}-\d{2}$/.test(value))
                setAnchor(`${value}-01`);
              else if (periodMode === "week" && /^\d{4}-\d{2}-\d{2}$/.test(value))
                setAnchor(value);
            }}
            required
          />
        </label>
        <label>
          Report time zone{" "}
          <input
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            required
          />
        </label>
        <p className="time-report-help">
          Searches the selected team’s logged time for this{" "}
          {periodMode === "week" ? "week" : "month"} across all accessible projects. Jira
          search can omit older worklogs on heavily used issues.
        </p>
        <div className="time-report-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={busy || !accountId || !teamChoice || teamLoading}
          >
            Load Time Report
          </button>
          {busy ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                controller.current?.abort();
                setBusy(false);
                setProgress("");
                setError("Loading cancelled. Load again to retry.");
              }}
            >
              Cancel loading
            </button>
          ) : null}
        </div>
      </form>
      {busy ? (
        <p className="time-report-feedback" role="status">
          <span className="reporting-spinner" aria-hidden="true" />
          {progress}
        </p>
      ) : null}
      {error ? (
        <p className="time-report-feedback time-report-error" role="alert">
          {error}
        </p>
      ) : null}
      {shown ? (
        <>
          <h2 className="time-report-team-title">{shown.teamName}</h2>
          {shown.warnings.length ? (
            <ul aria-label="Team membership warnings">
              {shown.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <p className="time-report-notice">{shown.data.coverageNotice}</p>
          {shown.data.state === "partial" ? (
            <div className="time-report-feedback time-report-error" role="alert">
              <p>
                Incomplete report: {shown.data.failedIssueIds.length} issue requests
                failed. Full totals are unavailable. Load again to retry.
              </p>
              <ul>
                {shown.data.reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : (
            <TimeReportView
              input={{ ...shown.input, dayOffs: dayOff.dayOffs }}
              baseUrl={baseUrl}
              timeZone={timeZone}
              onWeekChange={setAnchor}
              capacityKnown={dayOff.complete && !dayOff.loading && !dayOff.error}
            />
          )}
        </>
      ) : null}
    </section>
  );
}
