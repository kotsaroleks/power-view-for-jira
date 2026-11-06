import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extensionRequestSchema } from "../../../packages/extension-messaging/src/schemas";
import {
  normalizeJiraBaseUrl,
  validatedJiraRequestUrl,
  sanitizedJiraRequestHeaders,
} from "../../extension/src/jira-request-policy";

const here = import.meta.dirname;
let window: BrowserWindow;
let credentials:
  | {
      baseUrl: string;
      email: string;
      token: string;
      deploymentType: "cloud" | "data-center";
    }
  | undefined;
const pending = new Map<string, AbortController>();
let store: Record<string, unknown> = {};
let writes = Promise.resolve();
const profileFile = () => join(app.getPath("userData"), "connection.enc");
const storeFile = () => join(app.getPath("userData"), "workspace.json");
function persistStore() {
  writes = writes
    .catch(() => undefined)
    .then(() => writeFile(storeFile(), JSON.stringify(store), { mode: 0o600 }));
  return writes;
}
function error(requestId: string, code: string, message: string) {
  return {
    type: "ERROR",
    ok: false,
    requestId,
    error: { code, message, retryable: false },
  };
}

void app.whenReady().then(async () => {
  await mkdir(app.getPath("userData"), { recursive: true });
  try {
    store = JSON.parse(await readFile(storeFile(), "utf8")) as Record<string, unknown>;
  } catch {
    /* First launch. */
  }
  if (safeStorage.isEncryptionAvailable()) {
    try {
      credentials = JSON.parse(
        safeStorage.decryptString(await readFile(profileFile())),
      ) as typeof credentials;
    } catch {
      /* First launch or unavailable credentials. */
    }
  }
  function handle(channel: string, handler: (...args: unknown[]) => unknown) {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("Untrusted caller.");
      return handler(...args);
    });
  }
  handle("desktop:has-connection", () => Boolean(credentials));
  handle("desktop:connect", async (input) => {
    const value = input as Record<string, unknown>;
    if (
      typeof value.baseUrl !== "string" ||
      typeof value.email !== "string" ||
      typeof value.token !== "string" ||
      !value.token.trim() ||
      value.token.length > 4096
    )
      throw new Error("Enter the Jira URL, email and token.");
    const baseUrl = normalizeJiraBaseUrl(value.baseUrl, false);
    const deploymentType: "cloud" | "data-center" =
      value.deploymentType === "data-center" ? "data-center" : "cloud";
    if (deploymentType === "cloud" && !value.email.includes("@"))
      throw new Error("Enter your Atlassian email.");
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("System credential encryption is unavailable.");
    const next = {
      baseUrl,
      email: value.email.trim(),
      token: value.token.trim(),
      deploymentType,
    };
    await writeFile(profileFile(), safeStorage.encryptString(JSON.stringify(next)), {
      mode: 0o600,
    });
    credentials = next;
  });
  handle("desktop:disconnect", async () => {
    credentials = undefined;
    for (const controller of pending.values()) controller.abort();
    const { rm } = await import("node:fs/promises");
    await rm(profileFile(), { force: true });
  });
  handle("desktop:storage-get", (keys) =>
    Object.fromEntries(
      (typeof keys === "string" ? [keys] : (keys as string[])).map((key) => [
        key,
        store[key],
      ]),
    ),
  );
  handle("desktop:storage-set", async (items) => {
    Object.assign(store, items);
    await persistStore();
  });
  handle("desktop:storage-remove", async (keys) => {
    for (const key of typeof keys === "string" ? [keys] : (keys as string[]))
      delete store[key];
    await persistStore();
  });
  handle("desktop:message", async (input) => {
    const message = extensionRequestSchema.parse(input);
    const requestId = message.requestId;
    if (message.type === "JIRA_REQUEST_CANCEL") {
      pending.get(message.targetRequestId)?.abort();
      return { type: "ACK", ok: true, requestId };
    }
    if (!credentials)
      return error(requestId, "AUTH_REQUIRED", "Connect your Jira account.");
    const profile = credentials;
    if (message.type === "CONTEXT_GET" || message.type === "CONTEXT_REFRESH")
      return {
        type: "CONTEXT_RESULT",
        ok: true,
        requestId,
        context: {
          baseUrl: profile.baseUrl,
          pageUrl: profile.baseUrl,
          detectedAt: new Date().toISOString(),
          deploymentType: profile.deploymentType,
          detectionSources: ["user-input"],
        },
      };
    if (message.type === "DIAGNOSTICS_GET")
      return {
        type: "DIAGNOSTICS_RESULT",
        ok: true,
        requestId,
        diagnostics: {
          extensionVersion: app.getVersion(),
          browserVersion: "Power View Desktop",
          jiraBaseUrl: profile.baseUrl,
          deploymentType: profile.deploymentType,
          cacheStatus: "not-configured",
          loadedIssueCount: 0,
        },
      };
    if (message.type === "ISSUE_LOAD_REPORT") return { type: "ACK", ok: true, requestId };
    if (message.type !== "JIRA_REQUEST")
      return error(requestId, "UNKNOWN", "Unsupported desktop operation.");
    const controller = new AbortController();
    pending.set(requestId, controller);
    const timer = setTimeout(() => controller.abort(), 60000);
    const started = Date.now();
    try {
      const request = message.payload;
      const url = validatedJiraRequestUrl(request, profile.baseUrl, false);
      const authorization =
        profile.deploymentType === "cloud"
          ? `Basic ${Buffer.from(`${profile.email}:${profile.token}`).toString("base64")}`
          : `Bearer ${profile.token}`;
      const response = await fetch(url, {
        method: request.method,
        headers: {
          ...sanitizedJiraRequestHeaders(request),
          Authorization: authorization,
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok)
        return error(
          requestId,
          response.status === 401
            ? "AUTH_REQUIRED"
            : response.status === 403
              ? "PERMISSION_DENIED"
              : "UNKNOWN",
          `Jira returned HTTP ${response.status}.`,
        );
      const data: unknown = response.status === 204 ? null : await response.json();
      return {
        type: "JIRA_RESPONSE",
        ok: true,
        requestId,
        status: response.status,
        data,
        durationMs: Date.now() - started,
        retryCount: 0,
      };
    } catch {
      return error(
        requestId,
        "UNKNOWN",
        "Jira request failed. Check connection settings and network access.",
      );
    } finally {
      clearTimeout(timer);
      pending.delete(requestId);
    }
  });
  function openWindow() {
    window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 900,
      minHeight: 650,
      title: "Power View for Jira",
      webPreferences: {
        preload: join(here, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    void window.loadFile(resolve(here, "../extension/app/index.html"));
  }
  openWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
});
