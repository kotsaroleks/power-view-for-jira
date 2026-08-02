import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UpdatePanel } from "./UpdatePanel";

describe("UpdatePanel", () => {
  it("shows 'Not checked yet' before any check has run", async () => {
    render(<UpdatePanel getCheckResult={vi.fn().mockResolvedValue(undefined)} />);

    expect(await screen.findByText("Not checked yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload extension" })).toBeInTheDocument();
  });

  it("shows the cached result on mount", async () => {
    render(
      <UpdatePanel
        getCheckResult={vi.fn().mockResolvedValue({
          schemaVersion: 1,
          status: "up-to-date",
          checkedAt: "2026-07-24T12:00:00.000Z",
        })}
      />,
    );

    expect(await screen.findByText("Up to date.")).toBeInTheDocument();
  });

  it("shows update-available status with quick actions", async () => {
    render(
      <UpdatePanel
        getCheckResult={vi.fn().mockResolvedValue({
          schemaVersion: 1,
          status: "update-available",
          checkedAt: "2026-07-24T12:00:00.000Z",
          currentCommitSha: "abc1234abc1234abc1234abc1234abc1234abcd",
          latestCommitSha: "def5678def5678def5678def5678def5678defa",
        })}
      />,
    );

    expect(await screen.findByText(/Update available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload extension" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open chrome://extensions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy update command" }),
    ).toBeInTheDocument();
  });

  it("re-checks on demand via Check now", async () => {
    const checkForUpdateNow = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      status: "up-to-date",
      checkedAt: "2026-07-24T12:05:00.000Z",
    });

    render(
      <UpdatePanel
        getCheckResult={vi.fn().mockResolvedValue(undefined)}
        checkForUpdateNow={checkForUpdateNow}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));

    expect(await screen.findByText("Up to date.")).toBeInTheDocument();
    expect(checkForUpdateNow).toHaveBeenCalled();
  });

  it("copies the update command to the clipboard", async () => {
    const copyUpdateCommand = vi.fn().mockResolvedValue(undefined);

    render(
      <UpdatePanel
        getCheckResult={vi.fn().mockResolvedValue({
          schemaVersion: 1,
          status: "update-available",
          checkedAt: "2026-07-24T12:00:00.000Z",
        })}
        copyUpdateCommand={copyUpdateCommand}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Copy update command" }));

    expect(copyUpdateCommand).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("opens chrome://extensions", async () => {
    const openChromeExtensionsPage = vi.fn();

    render(
      <UpdatePanel
        getCheckResult={vi.fn().mockResolvedValue({
          schemaVersion: 1,
          status: "update-available",
          checkedAt: "2026-07-24T12:00:00.000Z",
        })}
        openChromeExtensionsPage={openChromeExtensionsPage}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Open chrome://extensions" }),
    );

    expect(openChromeExtensionsPage).toHaveBeenCalled();
  });
});
