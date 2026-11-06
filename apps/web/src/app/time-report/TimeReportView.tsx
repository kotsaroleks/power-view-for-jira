import { useState } from "react";
import {
  buildTimeReport,
  type TimeReportInput,
  type TimeReportDay,
} from "@power-view/domain";
import { adjacentPeriod, duration } from "../timesheet/timesheet-model";
import "./time-report.css";

export interface TimeReportViewProps {
  input: TimeReportInput;
  baseUrl: string;
  timeZone: string;
  onWeekChange: (weekStart: string) => void;
  capacityKnown?: boolean;
}

const percent = (value: number | null) =>
  value === null ? "N/A" : `${value.toFixed(1)}%`;
function DayCell({
  day,
  showDeficit = true,
}: {
  day: TimeReportDay;
  showDeficit?: boolean;
}) {
  return (
    <td
      className={
        day.conflict
          ? "time-report-conflict"
          : showDeficit &&
              !day.dayOff &&
              day.loggedSeconds < 28800 &&
              new Date(`${day.date}T12:00Z`).getUTCDay() % 6 !== 0
            ? "time-report-deficit"
            : ""
      }
    >
      {day.dayOff
        ? `Day Off${day.worklogCount ? ` · ${duration(day.loggedSeconds)}` : ""}`
        : duration(day.loggedSeconds)}
    </td>
  );
}

/** Presentation boundary: callers must supply an authorized roster and complete data. */
export function TimeReportView({
  input,
  baseUrl,
  timeZone,
  onWeekChange,
  capacityKnown = true,
}: TimeReportViewProps) {
  const mode = input.periodMode ?? "week";
  const showCapacity = capacityKnown;
  const expected = (seconds: number | null) =>
    seconds === null ? "Unavailable" : duration(seconds);
  const [individual, setIndividual] = useState<string>();
  const [filter, setFilter] = useState("");
  const users = [...input.users].sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName, undefined, {
        sensitivity: "base",
        numeric: true,
      }) || left.userId.localeCompare(right.userId),
  );
  const activeFilter = users.some((user) => user.userId === filter) ? filter : "";
  const selected = users.filter((user) => !activeFilter || user.userId === activeFilter);
  const report = buildTimeReport({ ...input, users: selected });
  const employee = report.employees.find((row) => row.user.userId === individual);
  const shift = (direction: number) =>
    onWeekChange(adjacentPeriod(input.weekStart, mode, direction));
  return (
    <section className="time-report-view" aria-label="Time Report">
      <div className="time-report-toolbar">
        <button
          className="secondary-button"
          type="button"
          onClick={() => shift(-1)}
          aria-label={`Previous ${mode}`}
        >
          ←
        </button>
        <strong>
          {report.days[0]} – {report.days.at(-1)}
        </strong>
        <button
          className="secondary-button"
          type="button"
          onClick={() => shift(1)}
          aria-label={`Next ${mode}`}
        >
          →
        </button>
        <label>
          Employee{" "}
          <select
            value={activeFilter}
            onChange={(event) => {
              setFilter(event.target.value);
              setIndividual(undefined);
            }}
          >
            <option value="">All employees</option>
            {users.map((user) => (
              <option key={user.userId} value={user.userId}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        Time zone: {timeZone}.{" "}
        {mode === "month"
          ? "Monthly capacity: 8h per weekday, excluding weekday Day Off dates. Weekend worklogs count toward logged time."
          : "Base capacity: 40h per week; each weekday Day Off subtracts 8h. Weekend worklogs count toward logged time."}
      </p>
      {!showCapacity ? (
        <p className="time-report-notice" role="status">
          Complete Day Off data is unavailable. Expected hours, utilization and deficit
          indicators are unavailable.
        </p>
      ) : null}
      <div className="time-report-view-tabs" role="tablist" aria-label="Time Report view">
        <button
          type="button"
          role="tab"
          aria-selected={!employee}
          onClick={() => setIndividual(undefined)}
        >
          Team View
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={Boolean(employee)}
          disabled={!report.employees.length}
          onClick={() => setIndividual(report.employees[0]?.user.userId)}
        >
          Individual View
        </button>
      </div>
      {employee ? (
        <>
          <label>
            Individual{" "}
            <select
              value={employee.user.userId}
              onChange={(event) => setIndividual(event.target.value)}
            >
              {report.employees.map((row) => (
                <option key={row.user.userId} value={row.user.userId}>
                  {row.user.displayName}
                </option>
              ))}
            </select>
          </label>
          <p>
            {employee.user.displayName} · Logged {duration(employee.loggedSeconds)} ·
            Expected {showCapacity ? expected(employee.expectedSeconds) : "Unavailable"} ·
            Utilization{" "}
            {showCapacity ? percent(employee.utilizationPercent) : "Unavailable"}
          </p>
          <div className="time-report-scroll">
            <table>
              <caption>Individual View · {employee.user.displayName}</caption>
              <thead>
                <tr>
                  <th scope="col">Jira Issue</th>
                  {report.days.map((day) => (
                    <th scope="col" key={day}>
                      {day}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {employee.issues.map((issue) => (
                  <tr key={issue.issueKey}>
                    <th scope="row">
                      <a
                        href={`${baseUrl}/browse/${encodeURIComponent(issue.issueKey)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {issue.issueKey}
                      </a>
                    </th>
                    {issue.days.map((day) => (
                      <DayCell day={day} key={day.date} showDeficit={false} />
                    ))}
                    <td>{duration(issue.loggedSeconds)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  {employee.days.map((day) => (
                    <DayCell day={day} key={day.date} showDeficit={showCapacity} />
                  ))}
                  <td>{duration(employee.loggedSeconds)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : (
        <div className="time-report-scroll">
          <table>
            <caption>Team View</caption>
            <thead>
              <tr>
                <th scope="col">Employee</th>
                {report.days.map((day) => (
                  <th scope="col" key={day}>
                    {day}
                  </th>
                ))}
                <th scope="col">Logged</th>
                <th scope="col">Expected</th>
                <th scope="col">Util.</th>
              </tr>
            </thead>
            <tbody>
              {report.employees.map((row) => (
                <tr key={row.user.userId}>
                  <th scope="row">
                    <button
                      className="time-report-person"
                      type="button"
                      onClick={() => setIndividual(row.user.userId)}
                    >
                      {row.user.displayName}
                    </button>
                  </th>
                  {row.days.map((day) => (
                    <DayCell day={day} key={day.date} showDeficit={showCapacity} />
                  ))}
                  <td>{duration(row.loggedSeconds)}</td>
                  <td>{showCapacity ? expected(row.expectedSeconds) : "Unavailable"}</td>
                  <td>
                    {showCapacity ? percent(row.utilizationPercent) : "Unavailable"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">TEAM</th>
                {report.team.days.map((day) => (
                  <td key={day.date}>{duration(day.loggedSeconds)}</td>
                ))}
                <td>{duration(report.team.loggedSeconds)}</td>
                <td>
                  {showCapacity ? expected(report.team.expectedSeconds) : "Unavailable"}
                </td>
                <td>
                  {showCapacity ? percent(report.team.utilizationPercent) : "Unavailable"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
