import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Application root element was not found.");
}
const root = ReactDOM.createRoot(rootElement);

const showGanttPreview =
  import.meta.env.DEV &&
  new URLSearchParams(globalThis.location.search).has("gantt-preview");

async function renderApplication(): Promise<void> {
  const application = showGanttPreview
    ? React.createElement((await import("./app/gantt/DevGanttPreview")).DevGanttPreview)
    : React.createElement(App);

  root.render(<React.StrictMode>{application}</React.StrictMode>);
}

void renderApplication();
