import { Button } from "@power-view/ui";
import { useEffect, useState, type FormEvent } from "react";

import {
  defaultCheckForUpdateNow,
  defaultClearUpdateToken,
  defaultCopyUpdateCommand,
  defaultGetUpdateStatus,
  defaultOpenChromeExtensionsPage,
  defaultSaveUpdateToken,
  type UpdateStatus,
} from "./update-panel-operations";

export interface UpdatePanelProps {
  getUpdateStatus?: () => Promise<UpdateStatus>;
  saveUpdateToken?: (token: string) => Promise<void>;
  clearUpdateToken?: () => Promise<void>;
  checkForUpdateNow?: () => Promise<UpdateStatus["checkResult"]>;
  openChromeExtensionsPage?: () => void;
  copyUpdateCommand?: () => Promise<void>;
}

function statusMessage(status: UpdateStatus): string {
  const result = status.checkResult;
  if (!result) {
    return status.hasToken ? "Not checked yet." : "Add a token to enable update checks.";
  }

  switch (result.status) {
    case "up-to-date":
      return "Up to date.";
    case "update-available":
      return `Update available — new commit ${result.latestCommitSha?.slice(0, 7) ?? "?"}.`;
    case "token-missing":
      return "Add a token to enable update checks.";
    case "token-invalid":
      return "Token appears invalid. Generate a new one and save it again.";
    case "check-failed":
      return result.errorMessage
        ? `Check failed: ${result.errorMessage}`
        : "Check failed. Try again.";
    default:
      return "Not checked yet.";
  }
}

export function UpdatePanel({
  getUpdateStatus = defaultGetUpdateStatus,
  saveUpdateToken = defaultSaveUpdateToken,
  clearUpdateToken = defaultClearUpdateToken,
  checkForUpdateNow = defaultCheckForUpdateNow,
  openChromeExtensionsPage = defaultOpenChromeExtensionsPage,
  copyUpdateCommand = defaultCopyUpdateCommand,
}: UpdatePanelProps) {
  const [status, setStatus] = useState<UpdateStatus>();
  const [tokenInput, setTokenInput] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    void getUpdateStatus().then((result) => {
      if (isCurrent) {
        setStatus(result);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [getUpdateStatus]);

  const handleSaveToken = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      await saveUpdateToken(tokenInput);
      setTokenInput("");
      const checkResult = await checkForUpdateNow();
      setStatus({ hasToken: true, ...(checkResult ? { checkResult } : {}) });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveToken = async () => {
    await clearUpdateToken();
    setStatus({ hasToken: false });
  };

  const handleCheckNow = async () => {
    setIsChecking(true);
    try {
      const checkResult = await checkForUpdateNow();
      setStatus((current) => ({
        hasToken: current?.hasToken ?? true,
        ...(checkResult ? { checkResult } : {}),
      }));
    } finally {
      setIsChecking(false);
    }
  };

  const handleCopyCommand = async () => {
    await copyUpdateCommand();
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <details className="update-section">
      <summary>Updates</summary>

      {status?.hasToken ? (
        <>
          <p className="update-status">{statusMessage(status)}</p>
          <p className="update-hint">Token saved ({status.tokenHint ?? "…"}).</p>
          <div className="update-actions">
            <Button
              disabled={isChecking}
              onClick={() => void handleCheckNow()}
              type="button"
            >
              {isChecking ? "Checking…" : "Check now"}
            </Button>
            <Button onClick={() => void handleRemoveToken()} type="button">
              Remove token
            </Button>
          </div>
          {status.checkResult?.status === "update-available" ? (
            <div className="update-actions">
              <Button onClick={openChromeExtensionsPage} type="button">
                Open chrome://extensions
              </Button>
              <Button onClick={() => void handleCopyCommand()} type="button">
                {isCopied ? "Copied" : "Copy update command"}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <form onSubmit={(event) => void handleSaveToken(event)}>
          <label htmlFor="update-token">GitHub token</label>
          <input
            id="update-token"
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder="github_pat_…"
            required
            type="password"
            value={tokenInput}
          />
          <Button disabled={isSaving} type="submit">
            {isSaving ? "Saving…" : "Save token"}
          </Button>
        </form>
      )}
    </details>
  );
}
