import { useEffect, useState, type FormEvent } from "react";
import { SettingsStore } from "@power-view/storage";
import { App } from "./App";

interface DesktopBridge {
  connect(input: {
    baseUrl: string;
    email: string;
    token: string;
    deploymentType: string;
  }): Promise<void>;
  disconnect(): Promise<void>;
  hasConnection(): Promise<boolean>;
  sendMessage(message: unknown): Promise<unknown>;
  storageGet(keys: string | string[]): Promise<Record<string, unknown>>;
  storageSet(items: Record<string, unknown>): Promise<void>;
  storageRemove(keys: string | string[]): Promise<void>;
}
declare global {
  interface Window {
    powerViewDesktop?: DesktopBridge;
  }
}
const bridge = window.powerViewDesktop;
const settings = bridge
  ? new SettingsStore({
      get: (keys) => bridge.storageGet(keys),
      set: (items) => bridge.storageSet(items),
      remove: (keys) => bridge.storageRemove(keys),
    })
  : undefined;

export function DesktopApp() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void bridge!
      .hasConnection()
      .then(setConnected)
      .catch(() => setError("Could not read the saved connection."))
      .finally(() => setLoading(false));
  }, []);
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await bridge!.connect({
        baseUrl: data.get("baseUrl") as string,
        email: data.get("email") as string,
        token: data.get("token") as string,
        deploymentType: data.get("deploymentType") as string,
      });
      form.reset();
      setConnected(true);
    } catch {
      setError(
        "Could not save the connection. Check the HTTPS Jira URL, email, token and system credential storage.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="page-frame">
        <p>Opening Power View…</p>
      </main>
    );
  if (connected)
    return (
      <>
        <div style={{ padding: "8px 24px", textAlign: "right" }}>
          <button
            className="text-button"
            onClick={() => {
              void bridge!
                .disconnect()
                .then(() => setConnected(false))
                .catch(() => setError("Could not disconnect."));
            }}
          >
            Change Jira connection
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
        <App
          runtime={bridge!}
          connectionDescription="Connects directly to Jira using your saved desktop credential."
          {...(settings ? { settingsStore: settings } : {})}
        />
      </>
    );
  return (
    <main className="page-frame" style={{ maxWidth: 560, margin: "80px auto" }}>
      <p className="report-eyebrow">POWER VIEW DESKTOP</p>
      <h1>Connect to Jira</h1>
      <p>
        Your credential is encrypted using system credential storage and used only by the
        desktop process.
      </p>
      <form
        onSubmit={(event) => void connect(event)}
        style={{ display: "grid", gap: 20 }}
      >
        <label>
          Jira URL
          <input
            name="baseUrl"
            type="url"
            placeholder="https://company.atlassian.net"
            required
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <label>
          Deployment
          <select name="deploymentType" style={{ display: "block", width: "100%" }}>
            <option value="cloud">Jira Cloud — API token without scopes</option>
            <option value="data-center">Jira Data Center — personal access token</option>
          </select>
        </label>
        <label>
          Atlassian email
          <input
            name="email"
            type="email"
            autoComplete="username"
            style={{ display: "block", width: "100%" }}
          />
        </label>
        <label>
          API token
          <input
            name="token"
            type="password"
            autoComplete="off"
            required
            style={{ display: "block", width: "100%" }}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button className="primary-button" disabled={busy}>
          {busy ? "Saving…" : "Connect to Jira"}
        </button>
      </form>
    </main>
  );
}
