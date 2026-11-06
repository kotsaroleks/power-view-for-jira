import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimeReportView } from "./TimeReportView";

describe("TimeReportView", () => {
  it("withholds capacity and deficit indicators when Day Off data is unknown", () => {
    const view = render(
      <TimeReportView
        baseUrl="https://example.atlassian.net"
        timeZone="UTC"
        onWeekChange={vi.fn()}
        capacityKnown={false}
        input={{
          weekStart: "2026-10-26",
          users: [{ userId: "alice", displayName: "Alice" }],
          worklogs: [],
          dayOffs: [],
        }}
      />,
    );
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(view.container.querySelector(".time-report-deficit")).toBeNull();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });
  it("shows preserved Day Off conflict hours and opens issue details from employee", () => {
    const onWeekChange = vi.fn();
    render(
      <TimeReportView
        baseUrl="https://example.atlassian.net"
        timeZone="UTC"
        onWeekChange={onWeekChange}
        input={{
          weekStart: "2026-10-26",
          users: [{ userId: "alice", displayName: "Alice" }],
          worklogs: [
            {
              id: "1",
              userId: "alice",
              issueKey: "ADMIN-1",
              day: "2026-10-26",
              timeSpentSeconds: 7200,
            },
          ],
          dayOffs: [{ userId: "alice", date: "2026-10-26" }],
        }}
      />,
    );
    expect(screen.getByText("Day Off · 2h")).toHaveClass("time-report-conflict");
    expect(within(screen.getAllByRole("row")[1]!).getByText("32h")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(onWeekChange).toHaveBeenCalledWith("2026-11-02");
    fireEvent.click(screen.getByRole("button", { name: "Alice" }));
    expect(screen.getByRole("link", { name: "ADMIN-1" })).toHaveAttribute(
      "href",
      "https://example.atlassian.net/browse/ADMIN-1",
    );
    expect(screen.getByRole("tab", { name: "Individual View" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
  it("uses N/A for a zero team norm", () => {
    render(
      <TimeReportView
        baseUrl="https://example.atlassian.net"
        timeZone="UTC"
        onWeekChange={vi.fn()}
        input={{ weekStart: "2026-10-26", users: [], worklogs: [], dayOffs: [] }}
      />,
    );
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });
  it("does not apply a daily capacity to each issue and drops obsolete employee filters", () => {
    const props = {
      baseUrl: "https://example.atlassian.net",
      timeZone: "UTC",
      onWeekChange: vi.fn(),
    };
    const input = {
      weekStart: "2026-10-26",
      users: [{ userId: "alice", displayName: "Alice" }],
      worklogs: [
        {
          id: "1",
          userId: "alice",
          issueKey: "ADMIN-1",
          day: "2026-10-26",
          timeSpentSeconds: 14400,
        },
        {
          id: "2",
          userId: "alice",
          issueKey: "ADMIN-2",
          day: "2026-10-26",
          timeSpentSeconds: 14400,
        },
      ],
      dayOffs: [],
    };
    const view = render(<TimeReportView {...props} input={input} />);
    fireEvent.change(screen.getByLabelText("Employee"), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Alice" }));
    const issueRow = screen.getByRole("link", { name: "ADMIN-1" }).closest("tr")!;
    expect(within(issueRow).getAllByRole("cell")[0]).not.toHaveClass(
      "time-report-deficit",
    );
    view.rerender(
      <TimeReportView
        {...props}
        input={{ ...input, users: [{ userId: "bob", displayName: "Bob" }] }}
      />,
    );
    expect(screen.getByRole("button", { name: "Bob" })).toBeInTheDocument();
    expect(screen.getByLabelText("Employee")).toHaveValue("");
  });
});

it("shows every monthly day, weekday capacity and calendar-month navigation", () => {
  const onWeekChange = vi.fn();
  const view = render(
    <TimeReportView
      baseUrl="https://example.atlassian.net"
      timeZone="UTC"
      onWeekChange={onWeekChange}
      capacityKnown
      input={{
        weekStart: "2026-12-01",
        periodMode: "month",
        users: [{ userId: "alice", displayName: "Alice" }],
        worklogs: [
          {
            id: "1",
            userId: "alice",
            issueKey: "ADMIN-1",
            day: "2026-12-31",
            timeSpentSeconds: 7200,
          },
        ],
        dayOffs: [],
      }}
    />,
  );
  expect(screen.getByText("2026-12-01 – 2026-12-31")).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(35);
  expect(screen.getByRole("columnheader", { name: "2026-12-31" })).toBeInTheDocument();
  expect(screen.queryByText(/40h per week/)).not.toBeInTheDocument();
  expect(view.container.querySelector(".time-report-deficit")).not.toBeNull();
  expect(screen.queryByText("Unavailable")).toBeNull();
  expect(screen.getAllByText("184h")).toHaveLength(2);
  expect(screen.getAllByText("1.1%")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  expect(onWeekChange).toHaveBeenCalledWith("2026-11-01");
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(onWeekChange).toHaveBeenCalledWith("2027-01-01");
  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  expect(screen.getByRole("link", { name: "ADMIN-1" })).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(33);
  view.rerender(
    <TimeReportView
      baseUrl="https://example.atlassian.net"
      timeZone="UTC"
      onWeekChange={onWeekChange}
      capacityKnown={false}
      input={{
        weekStart: "2026-12-01",
        periodMode: "month",
        users: [{ userId: "alice", displayName: "Alice" }],
        worklogs: [],
        dayOffs: [],
      }}
    />,
  );
  expect(screen.getByText(/Complete Day Off data is unavailable/)).toBeVisible();
  expect(view.container.querySelector(".time-report-deficit")).toBeNull();
});
