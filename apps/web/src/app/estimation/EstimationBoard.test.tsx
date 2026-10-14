import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceContext } from "../workspace/WorkspaceContext";
import { EstimationBoard } from "./EstimationBoard";

const workspace = {
  jiraBaseUrl: "https://jira.test",
  board: { id: "7", name: "Release board" },
  issues: [],
  truncated: false,
} as unknown as WorkspaceContext;
const fill = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

describe("EstimationBoard", () => {
  beforeEach(() => localStorage.clear());
  it("imports client keys, gates QA, persists readiness, and reopens review after a scope change", () => {
    const view = render(<EstimationBoard workspace={workspace} />);
    fill("Client issue list", "PROJ-1, PROJ-1");
    fireEvent.click(screen.getByRole("button", { name: "Add to release" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 issues added");
    fireEvent.click(
      screen.getByRole("button", { name: /PROJ-1 Issue details not loaded/ }),
    );
    expect(screen.getByLabelText("Test environment")).toBeDisabled();
    expect(screen.getByLabelText("Confirm final scope")).toBeDisabled();
    fill("Tech Lead", "Alex");
    fill("Estimate (dev days)", "3");
    fill("Subtask decomposition", "API and UI integration");
    fill("Final scope / acceptance criteria", "Client can select release scope");
    fireEvent.click(screen.getByLabelText("Confirm final scope"));
    expect(screen.getByLabelText("Test environment")).toBeEnabled();
    fill("QA Lead", "Sam");
    fill("Test environment", "Staging");
    fill("Test conditions", "Enable release flag");
    fill("Test plan", "Verify selection persists");
    fill("Test data for developer", "Seed two issues");
    expect(
      screen.getByRole("button", { name: "Mark ready for development" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Submit QA plan and test data"));
    fireEvent.click(screen.getByRole("button", { name: "Mark ready for development" }));
    expect(screen.getByRole("button", { name: "Ready to dev ✓" })).toBeDisabled();
    view.unmount();
    render(<EstimationBoard workspace={workspace} />);
    fireEvent.click(
      screen.getByRole("button", { name: /PROJ-1 Issue details not loaded/ }),
    );
    expect(screen.getByLabelText("Submit QA plan and test data")).toBeChecked();
    fill("Final scope / acceptance criteria", "Expanded scope");
    expect(screen.getByLabelText("Confirm final scope")).not.toBeChecked();
    expect(screen.getByLabelText("Test environment")).toBeDisabled();
    expect(screen.getByLabelText("Submit QA plan and test data")).not.toBeChecked();
  });
});
