import type { UpdateCheckResult } from "@power-view/update-checker";
import { Button } from "@power-view/ui";
import { useEffect, useState } from "react";

import { isSafariExtension } from "../lib/browser-platform";

import {
  defaultCheckForUpdateNow,
  defaultCopyUpdateCommand,
  defaultGetCheckResult,
  defaultOpenChromeExtensionsPage,
  defaultReloadExtension,
} from "./update-panel-operations";

export interface UpdatePanelProps {
  getCheckResult?: () => Promise<UpdateCheckResult | undefined>;
  checkForUpdateNow?: () => Promise<UpdateCheckResult>;
  openChromeExtensionsPage?: () => void;
  reloadExtension?: () => void;
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
      return `Update available — new extension build ${result.latestCommitSha ?? "?"}.`;
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
  reloadExtension = defaultReloadExtension,
  copyUpdateCommand = defaultCopyUpdateCommand,
}: UpdatePanelProps) {
  const safari = isSafariExtension();
  const [checkResult, setCheckResult] = useState<UpdateCheckResult>();
  const [isChecking, setIsChecking] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (safari) {
      return;
    }
    let isCurrent = true;
    void getCheckResult().then((result) => {
      if (isCurrent) {
        setCheckResult(result);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [getCheckResult, safari]);

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

  if (safari) {
    return (
      <details className="update-section">
        <summary>Updates</summary>
        <p>Safari updates are installed with the Power View for Jira macOS app.</p>
        <p>For a local build, rebuild the Safari project and run it from Xcode.</p>
      </details>
    );
  }

  return (
    <details className="update-section">
      <summary>Updates</summary>

      <p className="update-status">{statusMessage(checkResult)}</p>
      <div className="update-actions">
        <Button disabled={isChecking} onClick={() => void handleCheckNow()} type="button">
          {isChecking ? "Checking…" : "Check now"}
        </Button>
        <Button onClick={openChromeExtensionsPage} type="button">
          Open chrome://extensions
        </Button>
        <Button onClick={reloadExtension} type="button">
          Reload extension
        </Button>
      </div>
      {checkResult?.status === "update-available" ? (
        <div className="update-actions">
          <Button onClick={() => void handleCopyCommand()} type="button">
            {isCopied ? "Copied" : "Copy update command"}
          </Button>
        </div>
      ) : null}
    </details>
  );
}
