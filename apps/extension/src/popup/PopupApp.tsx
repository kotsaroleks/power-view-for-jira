import { PRODUCT_NAME, type JiraPageContext } from "@power-view/domain";
import {
  createContextRefreshRequest,
  createHostPermissionRequest,
  normalizeHostPermissionPattern,
  sendExtensionRequest,
  type ExtensionRuntime,
} from "@power-view/extension-messaging";
import { Button } from "@power-view/ui";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { openPowerView } from "./open-power-view";

async function activeTabUrl(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url;
}

function containsHostPermission(originPattern: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [originPattern] });
}

export interface PopupAppProps {
  runtime?: ExtensionRuntime;
  getActiveTabUrl?: () => Promise<string | undefined>;
  containsHostPermission?: (originPattern: string) => Promise<boolean>;
}

export function PopupApp({
  runtime = chrome.runtime,
  getActiveTabUrl = activeTabUrl,
  containsHostPermission: checkHostPermission = containsHostPermission,
}: PopupAppProps) {
  const [context, setContext] = useState<JiraPageContext>();
  const [customJiraUrl, setCustomJiraUrl] = useState("");
  const [error, setError] = useState<string>();
  const [permissionMessage, setPermissionMessage] = useState<string>();
  const [hasHostPermission, setHasHostPermission] = useState<boolean>();
  const [isLoading, setIsLoading] = useState(true);
  const [isOpening, setIsOpening] = useState(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);

  const refreshContext = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);

    try {
      const response = await sendExtensionRequest(runtime, createContextRefreshRequest());
      if (response.type === "ERROR") {
        setContext(undefined);
        setHasHostPermission(undefined);
        setError(response.error.message);
      } else if (response.type === "CONTEXT_RESULT") {
        setContext(response.context);
        setCustomJiraUrl(response.context.baseUrl);
        const originPattern = normalizeHostPermissionPattern(response.context.baseUrl);
        setHasHostPermission(await checkHostPermission(originPattern));
      } else {
        setContext(undefined);
        setHasHostPermission(undefined);
        setError("Power View returned an unexpected context response.");
      }
    } catch {
      setContext(undefined);
      setHasHostPermission(undefined);
      setError("Power View could not communicate with the extension service worker.");
    } finally {
      setIsLoading(false);
    }
  }, [checkHostPermission, runtime]);

  useEffect(() => {
    let isCurrent = true;

    const initialize = async () => {
      try {
        const url = await getActiveTabUrl();
        if (isCurrent && url) {
          const parsedUrl = new URL(url);
          if (parsedUrl.protocol === "https:") {
            setCustomJiraUrl(parsedUrl.origin);
          }
        }
      } catch {
        // Context refresh below provides the actionable user-facing state.
      }

      if (isCurrent) {
        await refreshContext();
      }
    };

    void initialize();
    return () => {
      isCurrent = false;
    };
  }, [getActiveTabUrl, refreshContext]);

  const handleOpen = async () => {
    setError(undefined);
    setIsOpening(true);

    try {
      await openPowerView(context, runtime);
      window.close();
    } catch {
      setError("Power View could not be opened. Please try again.");
      setIsOpening(false);
    }
  };

  const handlePermissionRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setPermissionMessage(undefined);
    setIsRequestingPermission(true);

    try {
      const originPattern = normalizeHostPermissionPattern(customJiraUrl);
      const response = await sendExtensionRequest(
        runtime,
        createHostPermissionRequest(originPattern),
      );

      if (response.type === "ERROR") {
        setError(response.error.message);
      } else if (response.type !== "HOST_PERMISSION_RESULT") {
        setError("Power View returned an unexpected permission response.");
      } else if (!response.granted) {
        setError("Chrome did not grant access to this Jira site.");
      } else {
        setPermissionMessage("Access granted for this Jira host.");
        setHasHostPermission(true);
        await refreshContext();
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Power View could not request access to this Jira site.",
      );
    } finally {
      setIsRequestingPermission(false);
    }
  };

  return (
    <main className="popup-shell">
      <div className="popup-heading">
        <div className="product-mark" aria-hidden="true">
          PV
        </div>
        <div>
          <p className="eyebrow">BROWSER-SESSION PLANNING</p>
          <h1>{PRODUCT_NAME}</h1>
        </div>
      </div>

      {isLoading ? (
        <p className="context-state" role="status">
          Detecting Jira context…
        </p>
      ) : context ? (
        <section className="context-card" aria-label="Detected Jira context">
          <div className="context-card-heading">
            <span className="status-dot" aria-hidden="true" />
            Jira detected
          </div>
          <strong>{context.baseUrl}</strong>
          <dl>
            {context.projectKey ? (
              <div>
                <dt>Project</dt>
                <dd>{context.projectKey}</dd>
              </div>
            ) : null}
            {context.issueKey ? (
              <div>
                <dt>Issue</dt>
                <dd>{context.issueKey}</dd>
              </div>
            ) : null}
            <div>
              <dt>Deployment</dt>
              <dd>{context.deploymentType}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {!isLoading && (!context || hasHostPermission === false) ? (
        <section className="permission-card" aria-labelledby="custom-jira-title">
          <h2 id="custom-jira-title">
            {context ? "Grant Jira access" : "Custom Jira site"}
          </h2>
          <p>
            {context
              ? "Power View detected this Jira site but still needs exact-site host access."
              : "Enter its URL to request access only to that HTTPS host."}
          </p>
          <form onSubmit={(event) => void handlePermissionRequest(event)}>
            <label htmlFor="custom-jira-url">Jira URL</label>
            <input
              id="custom-jira-url"
              inputMode="url"
              onChange={(event) => setCustomJiraUrl(event.target.value)}
              placeholder="https://jira.example.com"
              required
              type="url"
              value={customJiraUrl}
            />
            <Button disabled={isRequestingPermission} type="submit">
              {isRequestingPermission ? "Requesting…" : "Grant site access"}
            </Button>
          </form>
        </section>
      ) : null}

      {permissionMessage ? (
        <p className="success" role="status">
          {permissionMessage}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="popup-actions">
        <Button
          className="open-button"
          disabled={!context || hasHostPermission !== true || isLoading || isOpening}
          onClick={() => void handleOpen()}
          type="button"
        >
          {isOpening ? "Opening…" : "Open Power View"}
        </Button>
        <Button
          className="refresh-button"
          disabled={isLoading}
          onClick={() => void refreshContext()}
          type="button"
        >
          Detect again
        </Button>
      </div>
      <p className="privacy-note">No Jira data leaves your browser.</p>
    </main>
  );
}
