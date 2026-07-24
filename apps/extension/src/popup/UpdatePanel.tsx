import type { UpdateCheckResult } from "@power-view/update-checker";
import { Button } from "@power-view/ui";
import { useEffect, useState } from "react";

import {
  defaultCheckForUpdateNow,
  defaultCopyUpdateCommand,
  defaultGetCheckResult,
  defaultOpenChromeExtensionsPage,
} from "./update-panel-operations";

export interface UpdatePanelProps {
  getCheckResult?: () => Promise<UpdateCheckResult | undefined>;
  checkForUpdateNow?: () => Promise<UpdateCheckResult>;
  openChromeExtensionsPage?: () => void;
  copyUpdateCommand?: () => Promise<void>;
}

function statusMessage(result: UpdateCheckResult | undefined): string {
  if (!result) {
    return "Not checked yet.";
  }

  switch (result.status) {
    case "up-to-date":
      return "Up to date.";
    case "update-available":
      return `Update available — new commit ${result.latestCommitSha?.slice(0, 7) ?? "?"}.`;
    case "check-failed":
      return result.errorMessage
        ? `Check failed: ${result.errorMessage}`
        : "Check failed. Try again.";
    default:
      return "Not checked yet.";
  }
}

export function UpdatePanel({
  getCheckResult = defaultGetCheckResult,
  checkForUpdateNow = defaultCheckForUpdateNow,
  openChromeExtensionsPage = defaultOpenChromeExtensionsPage,
  copyUpdateCommand = defaultCopyUpdateCommand,
}: UpdatePanelProps) {
  const [checkResult, setCheckResult] = useState<UpdateCheckResult>();
  const [isChecking, setIsChecking] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    void getCheckResult().then((result) => {
      if (isCurrent) {
        setCheckResult(result);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [getCheckResult]);

  const handleCheckNow = async () => {
    setIsChecking(true);
    try {
      setCheckResult(await checkForUpdateNow());
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

      <p className="update-status">{statusMessage(checkResult)}</p>
      <div className="update-actions">
        <Button disabled={isChecking} onClick={() => void handleCheckNow()} type="button">
          {isChecking ? "Checking…" : "Check now"}
        </Button>
      </div>
      {checkResult?.status === "update-available" ? (
        <div className="update-actions">
          <Button onClick={openChromeExtensionsPage} type="button">
            Open chrome://extensions
          </Button>
          <Button onClick={() => void handleCopyCommand()} type="button">
            {isCopied ? "Copied" : "Copy update command"}
          </Button>
        </div>
      ) : null}
    </details>
  );
}
