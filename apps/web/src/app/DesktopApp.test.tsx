import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  hasConnection: vi.fn(),
  sendMessage: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  storageRemove: vi.fn(),
}));
vi.mock("./App", () => ({ App: () => <p>Desktop workspace</p> }));
beforeEach(() => {
  vi.clearAllMocks();
  bridge.hasConnection.mockResolvedValue(false);
  bridge.connect.mockResolvedValue(undefined);
  bridge.disconnect.mockResolvedValue(undefined);
  window.powerViewDesktop = bridge;
});
async function renderDesktop() {
  const { DesktopApp } = await import("./DesktopApp");
  render(<DesktopApp />);
}
it("sends credentials through the desktop bridge and clears the token field", async () => {
  await renderDesktop();
  fireEvent.change(await screen.findByLabelText("Jira URL"), {
    target: { value: "https://example.atlassian.net" },
  });
  fireEvent.change(screen.getByLabelText("Atlassian email"), {
    target: { value: "test@example.com" },
  });
  fireEvent.change(screen.getByLabelText("API token"), {
    target: { value: "test-only-placeholder" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect to Jira" }));
  await screen.findByText("Desktop workspace");
  expect(bridge.connect).toHaveBeenCalledWith({
    baseUrl: "https://example.atlassian.net",
    email: "test@example.com",
    token: "test-only-placeholder",
    deploymentType: "cloud",
  });
  expect(screen.queryByLabelText("API token")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Change Jira connection"));
  await screen.findByLabelText("API token");
  expect(bridge.disconnect).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("API token")).toHaveValue("");
});
it("keeps the form available when system credential storage fails", async () => {
  bridge.connect.mockRejectedValue(new Error("Encryption unavailable"));
  await renderDesktop();
  fireEvent.change(await screen.findByLabelText("Jira URL"), {
    target: { value: "https://example.atlassian.net" },
  });
  fireEvent.change(screen.getByLabelText("API token"), {
    target: { value: "test-only-placeholder" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect to Jira" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save"),
  );
  expect(screen.queryByText("Desktop workspace")).not.toBeInTheDocument();
});
