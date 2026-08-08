import { SettingsStore } from "@power-view/storage";

import { App } from "./App";
import { MemoryStorage, previewRuntime } from "./SetupPanelDevPreview";

export function AppDevPreview() {
  return (
    <App
      runtime={previewRuntime()}
      settingsStore={new SettingsStore(new MemoryStorage())}
    />
  );
}
