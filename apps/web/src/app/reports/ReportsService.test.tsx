import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReportsServiceProps } from "./ReportsService";
import { ReportsService } from "./ReportsService";
vi.mock("../reporting/ReportsView", () => ({
  ReportsView: () => (
    <label>
      Existing selection
      <input aria-label="Existing selection" defaultValue="retained" />
    </label>
  ),
}));
vi.mock("./BoardHealthReport", () => ({
  BoardHealthReportView: () => <p>Board health</p>,
}));

describe("ReportsService tabs", () => {
  it("keeps existing report state while showing the separate Time Report", () => {
    const props = {
      workspace: {
        board: { id: "7", projectKeys: [] },
        scope: { boardId: "7" },
        issues: [],
        reporting: { completedStatusIds: [], completedStatusNames: [] },
        editing: { fieldMapping: {} },
      },
      pageContext: { deploymentType: "cloud" },
      client: {},
      timeReport: <p>Time content</p>,
    } as unknown as ReportsServiceProps;
    render(<ReportsService {...props} />);
    fireEvent.change(screen.getByLabelText("Existing selection"), {
      target: { value: "changed" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Time Report" }));
    expect(screen.getByText("Time content")).toBeVisible();
    expect(screen.getByText("Board health")).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Existing Reports" }));
    expect(screen.getByLabelText("Existing selection")).toHaveValue("changed");
    expect(screen.queryByText("Time content")).not.toBeInTheDocument();
  });
});
