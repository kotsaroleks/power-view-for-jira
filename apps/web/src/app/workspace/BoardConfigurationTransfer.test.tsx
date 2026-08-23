import { DEFAULT_DURATION_DAYS } from "@power-view/domain";
import { SettingsStore, type StorageArea } from "@power-view/storage";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BoardConfigurationTransfer } from "./BoardConfigurationTransfer";

class MemoryStorage implements StorageArea {
  private readonly values = new Map<string, unknown>();

  get(keys: string | string[]): Promise<Record<string, unknown>> {
    const selected = Array.isArray(keys) ? keys : [keys];
    return Promise.resolve(
      Object.fromEntries(selected.map((key) => [key, this.values.get(key)])),
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.entries(items).forEach(([key, value]) => this.values.set(key, value));
    return Promise.resolve();
  }

  remove(keys: string | string[]): Promise<void> {
    const selected = Array.isArray(keys) ? keys : [keys];
    selected.forEach((key) => this.values.delete(key));
    return Promise.resolve();
  }
}

const scope = {
  jiraBaseUrl: "https://example.atlassian.net",
  projectKey: "POWER",
  boardId: "7",
} as const;

async function configuredStore() {
  const store = new SettingsStore(new MemoryStorage());
  await store.saveSetup({
    jiraBaseUrl: scope.jiraBaseUrl,
    project: { id: "10000", key: "POWER", name: "Power View" },
    board: {
      id: "7",
      name: "Delivery Board",
      type: "scrum",
      projectKeys: ["POWER"],
    },
    jql: 'project = "POWER"',
    fieldMapping: {},
    defaultDurations: DEFAULT_DURATION_DAYS,
    nonWorkingDays: [0, 6],
    updatedAt: "2026-08-22T09:00:00.000Z",
  });
  await store.saveGanttBoardState(scope.jiraBaseUrl, "POWER:7", {
    dependencies: [
      {
        id: "POWER-1:POWER-2:FS",
        predecessorIssueKey: "POWER-1",
        successorIssueKey: "POWER-2",
        type: "FS",
        lagWorkingDays: 0,
      },
    ],
    reconciledDates: {},
  });
  return store;
}

function fileWithText(name: string, text: string): File {
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: () => Promise.resolve(text),
  });
  return file;
}

describe("BoardConfigurationTransfer", () => {
  it("exports the active board as a JSON download", async () => {
    const store = await configuredStore();
    const download = vi.fn();
    render(
      <BoardConfigurationTransfer store={store} scope={scope} download={download} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export settings" }));

    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    const [fileName, content] = download.mock.calls[0] as [string, string];
    expect(fileName).toBe("power-view-POWER-board-7.json");
    expect(JSON.parse(content)).toMatchObject({
      kind: "power-view-board-configuration",
      board: { boardId: "7" },
    });
  });

  it("previews a file before one Import action applies it", async () => {
    const source = await configuredStore();
    const document = await source.exportBoardConfiguration(scope, {
      exportedAt: "2026-08-22T10:00:00.000Z",
    });
    const target = await configuredStore();
    const importSpy = vi.spyOn(target, "importBoardConfiguration");
    const onImported = vi.fn();
    render(
      <BoardConfigurationTransfer store={target} scope={scope} onImported={onImported} />,
    );

    fireEvent.change(screen.getByLabelText("Choose settings file"), {
      target: {
        files: [fileWithText("settings.json", JSON.stringify(document))],
      },
    });

    expect(await screen.findByText("Delivery Board")).toBeInTheDocument();
    expect(screen.getByText("Format 1")).toBeInTheDocument();
    expect(screen.getByText("1 dependency")).toBeInTheDocument();
    expect(importSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(importSpy).toHaveBeenCalledOnce());
    expect(onImported).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Settings imported");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an invalid-file error without offering Import", async () => {
    const store = await configuredStore();
    render(<BoardConfigurationTransfer store={store} scope={scope} />);

    fireEvent.change(screen.getByLabelText("Choose settings file"), {
      target: { files: [fileWithText("broken.json", "{nope")] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a valid Power View settings file",
    );
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  });
});
