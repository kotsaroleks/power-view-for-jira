import { SettingsStore } from "@power-view/storage";
import { SetupPanel } from "./SetupPanel";
import { MemoryStorage, previewContext, previewRuntime } from "./preview-runtime";

export function SetupPanelDevPreview() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button">
          <span className="brand-mark" aria-hidden="true">
            PV
          </span>
          <span className="brand-copy">
            <strong>Power View for Jira</strong>
            <small>LBR</small>
          </span>
        </button>
        <div className="topbar-actions">
          <button className="settings-button" type="button" aria-current="page">
            Settings
          </button>
        </div>
      </header>
      <main className="app-main">
        <section className="page-frame settings-page" aria-labelledby="settings-title">
          <section className="setup-card" aria-labelledby="settings-title">
            <div className="setup-card-header">
              <div>
                <p className="report-eyebrow">WORKSPACE SETUP</p>
                <h2 id="settings-title">Configure your Jira workspace</h2>
                <p>Uses your active browser session. No credentials are stored.</p>
              </div>
            </div>
            <div className="app-context-summary">
              <span className="app-status-dot" aria-hidden="true" />
              <strong>Context detected</strong>
              <span>LBR</span>
              <span>Board 1296</span>
              <span>{previewContext.baseUrl}</span>
            </div>
            <SetupPanel
              context={previewContext}
              runtime={previewRuntime()}
              settingsStore={new SettingsStore(new MemoryStorage())}
              autoContinue={false}
            />
          </section>
        </section>
      </main>
    </div>
  );
}
