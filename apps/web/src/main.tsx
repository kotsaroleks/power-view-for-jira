import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Application root element was not found.");
}
const root = ReactDOM.createRoot(rootElement);

const searchParams = new URLSearchParams(globalThis.location.search);
const showGanttPreview = import.meta.env.DEV && searchParams.has("gantt-preview");
const showSetupPreview = import.meta.env.DEV && searchParams.has("setup-preview");
const showAppPreview = import.meta.env.DEV && searchParams.has("app-preview");

async function renderApplication(): Promise<void> {
  if (showSetupPreview || showAppPreview) {
    // Rendered without StrictMode: its double-invoked effects abort the
    // preview's very first mock request, and the setup guard then blocks any
    // retry — a dev-only StrictMode artifact, not app behavior worth mocking.
    const component = showAppPreview
      ? (await import("./app/AppDevPreview")).AppDevPreview
      : (await import("./app/SetupPanelDevPreview")).SetupPanelDevPreview;
    root.render(React.createElement(component));
    return;
  }

  const application = showGanttPreview
    ? React.createElement((await import("./app/gantt/DevGanttPreview")).DevGanttPreview)
    : React.createElement(App);

  root.render(<React.StrictMode>{application}</React.StrictMode>);
}

void renderApplication();
