import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { UpdatePanel } from "./UpdatePanel";

describe("UpdatePanel", () => {
  it("shows a token input when no token is saved", async () => {
    render(
      <UpdatePanel getUpdateStatus={vi.fn().mockResolvedValue({ hasToken: false })} />,
    );

    expect(await screen.findByLabelText("GitHub token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save token" })).toBeInTheDocument();
  });

  it("saves a token, runs an immediate check, and shows the result", async () => {
    const saveUpdateToken = vi.fn().mockResolvedValue(undefined);
    const checkForUpdateNow = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      status: "up-to-date",
      checkedAt: "2026-07-24T12:00:00.000Z",
    });

    render(
      <UpdatePanel
        getUpdateStatus={vi.fn().mockResolvedValue({ hasToken: false })}
        saveUpdateToken={saveUpdateToken}
        checkForUpdateNow={checkForUpdateNow}
      />,
    );

    const input = await screen.findByLabelText("GitHub token");
    fireEvent.change(input, { target: { value: "github_pat_abcdefgh1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));

    expect(await screen.findByText("Up to date.")).toBeInTheDocument();
    expect(saveUpdateToken).toHaveBeenCalledWith("github_pat_abcdefgh1234");
    expect(checkForUpdateNow).toHaveBeenCalled();
  });

  it("shows update-available status with quick actions when a saved token has a pending update", async () => {
    render(
      <UpdatePanel
        getUpdateStatus={vi.fn().mockResolvedValue({
          hasToken: true,
          tokenHint: "…3f9c",
          checkResult: {
            schemaVersion: 1,
            status: "update-available",
            checkedAt: "2026-07-24T12:00:00.000Z",
            currentCommitSha: "abc1234abc1234abc1234abc1234abc1234abcd",
            latestCommitSha: "def5678def5678def5678def5678def5678defa",
          },
        })}
      />,
    );

    expect(await screen.findByText(/Update available/)).toBeInTheDocument();
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
        getUpdateStatus={vi
          .fn()
          .mockResolvedValue({ hasToken: true, tokenHint: "…3f9c" })}
        checkForUpdateNow={checkForUpdateNow}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));

    expect(await screen.findByText("Up to date.")).toBeInTheDocument();
    expect(checkForUpdateNow).toHaveBeenCalled();
  });

  it("removes the saved token", async () => {
    const clearUpdateToken = vi.fn().mockResolvedValue(undefined);

    render(
      <UpdatePanel
        getUpdateStatus={vi
          .fn()
          .mockResolvedValue({ hasToken: true, tokenHint: "…3f9c" })}
        clearUpdateToken={clearUpdateToken}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Remove token" }));

    expect(clearUpdateToken).toHaveBeenCalled();
    expect(await screen.findByLabelText("GitHub token")).toBeInTheDocument();
  });

  it("copies the update command to the clipboard", async () => {
    const copyUpdateCommand = vi.fn().mockResolvedValue(undefined);

    render(
      <UpdatePanel
        getUpdateStatus={vi.fn().mockResolvedValue({
          hasToken: true,
          tokenHint: "…3f9c",
          checkResult: {
            schemaVersion: 1,
            status: "update-available",
            checkedAt: "2026-07-24T12:00:00.000Z",
          },
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
        getUpdateStatus={vi.fn().mockResolvedValue({
          hasToken: true,
          tokenHint: "…3f9c",
          checkResult: {
            schemaVersion: 1,
            status: "update-available",
            checkedAt: "2026-07-24T12:00:00.000Z",
          },
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
