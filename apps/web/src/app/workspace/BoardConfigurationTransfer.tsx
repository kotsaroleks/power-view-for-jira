import type {
  BoardConfigurationScope,
  PortableBoardConfiguration,
  SettingsStore,
} from "@power-view/storage";
import { useState } from "react";

interface ConfigurationTransferStore {
  exportBoardConfiguration: SettingsStore["exportBoardConfiguration"];
  importBoardConfiguration: SettingsStore["importBoardConfiguration"];
}

export interface BoardConfigurationTransferProps {
  store: ConfigurationTransferStore;
  scope: BoardConfigurationScope;
  onImported?: () => void | Promise<void>;
  download?: (fileName: string, content: string) => void;
}

function defaultDownload(fileName: string, content: string): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function previewDocument(value: unknown): PortableBoardConfiguration | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<PortableBoardConfiguration>;
  if (
    candidate.kind !== "power-view-board-configuration" ||
    candidate.version !== 1 ||
    !candidate.board ||
    typeof candidate.board.boardName !== "string" ||
    !candidate.configuration ||
    !Array.isArray(candidate.configuration.ganttBoardState?.dependencies)
  ) {
    return undefined;
  }
  return candidate as PortableBoardConfiguration;
}

export function BoardConfigurationTransfer({
  store,
  scope,
  onImported,
  download = defaultDownload,
}: BoardConfigurationTransferProps) {
  const [preview, setPreview] = useState<PortableBoardConfiguration>();
  const [status, setStatus] = useState<"idle" | "exporting" | "importing" | "done">(
    "idle",
  );
  const [error, setError] = useState<string>();

  const exportConfiguration = async () => {
    setStatus("exporting");
    setError(undefined);
    try {
      const documentValue = await store.exportBoardConfiguration(scope);
      download(
        `power-view-${scope.projectKey}-board-${scope.boardId}.json`,
        `${JSON.stringify(documentValue, null, 2)}\n`,
      );
      setStatus("idle");
    } catch (caught) {
      setStatus("idle");
      setError(
        caught instanceof Error
          ? caught.message
          : "Power View could not export these settings.",
      );
    }
  };

  const chooseFile = async (file: File | undefined) => {
    setPreview(undefined);
    setStatus("idle");
    setError(undefined);
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const nextPreview = previewDocument(parsed);
      if (!nextPreview) throw new Error("invalid");
      setPreview(nextPreview);
    } catch {
      setError("Choose a valid Power View settings file.");
    }
  };

  const importConfiguration = async () => {
    if (!preview) return;
    setStatus("importing");
    setError(undefined);
    try {
      await store.importBoardConfiguration(scope, preview);
      await onImported?.();
      setPreview(undefined);
      setStatus("done");
    } catch (caught) {
      setStatus("idle");
      setError(
        caught instanceof Error
          ? caught.message
          : "Power View could not import these settings.",
      );
    }
  };

  const dependencyCount = preview?.configuration.ganttBoardState.dependencies.length ?? 0;

  return (
    <section className="board-configuration-transfer" aria-labelledby="transfer-title">
      <div>
        <h3 id="transfer-title">Transfer board settings</h3>
        <p>Share this board configuration without Jira credentials.</p>
      </div>
      <div className="board-configuration-transfer-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={status === "exporting" || status === "importing"}
          onClick={() => void exportConfiguration()}
        >
          {status === "exporting" ? "Exporting…" : "Export settings"}
        </button>
        <label className="secondary-button board-configuration-file-label">
          Choose settings file
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Choose settings file"
            disabled={status === "exporting" || status === "importing"}
            onChange={(event) => void chooseFile(event.target.files?.[0])}
          />
        </label>
      </div>

      {preview ? (
        <div className="board-configuration-preview">
          <div>
            <strong>{preview.board.boardName}</strong>
            <span>
              {preview.board.projectKey} · Board {preview.board.boardId}
            </span>
          </div>
          <span>Format {preview.version}</span>
          <span>
            {dependencyCount} {dependencyCount === 1 ? "dependency" : "dependencies"}
          </span>
          <button
            type="button"
            className="primary-button"
            disabled={status === "importing"}
            onClick={() => void importConfiguration()}
          >
            {status === "importing" ? "Importing…" : "Import"}
          </button>
        </div>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}
      {status === "done" ? <p role="status">Settings imported.</p> : null}
    </section>
  );
}
