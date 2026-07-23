import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import {
  jiraCloudCurrentUserFixture,
  jiraCloudProjectsFixture,
  jiraCloudServerInfoFixture,
  jiraFieldsFixture,
  makeJiraScheduleFixtures,
} from "../packages/test-fixtures/src/index";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const extensionPath = resolve(import.meta.dirname, "../dist/extension");

test.describe("extension shell", () => {
  test.skip(!existsSync(extensionPath), "Run pnpm build before the extension E2E test.");

  let context: BrowserContext | undefined;
  let temporaryExtensionRoot: string | undefined;

  test.beforeAll(async () => {
    temporaryExtensionRoot = await mkdtemp(
      resolve(tmpdir(), "power-view-extension-e2e-"),
    );
    const testExtensionPath = resolve(temporaryExtensionRoot, "extension");
    await cp(extensionPath, testExtensionPath, { recursive: true });
    const manifestPath = resolve(testExtensionPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.host_permissions = ["https://fixture.atlassian.net/*"];
    await writeFile(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`);

    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    context = await chromium.launchPersistentContext("", {
      ...(executablePath ? { executablePath } : { channel: "chromium" }),
      headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
      args: [
        `--disable-extensions-except=${testExtensionPath}`,
        `--load-extension=${testExtensionPath}`,
      ],
    });
  });

  test.afterAll(async () => {
    await context?.close();
    if (temporaryExtensionRoot) {
      await rm(temporaryExtensionRoot, { recursive: true });
    }
  });

  test("shows safe no-context states in the popup and application", async () => {
    if (!context) {
      throw new Error("The extension browser context was not initialized.");
    }

    let serviceWorker = context.serviceWorkers()[0];
    serviceWorker ??= await context.waitForEvent("serviceworker");
    const extensionId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();

    await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
    await expect(popup.getByRole("heading", { name: "Custom Jira site" })).toBeVisible();
    await expect(popup.getByRole("button", { name: "Open Power View" })).toBeDisabled();

    const app = await context.newPage();
    await app.goto(`chrome-extension://${extensionId}/app/index.html`);
    await expect(
      app.getByRole("heading", { name: "Open Power View from Jira." }),
    ).toBeVisible();
  });

  test("detects Jira and loads a fixture schedule through the browser session", async () => {
    if (!context) {
      throw new Error("The extension browser context was not initialized.");
    }

    const issues = makeJiraScheduleFixtures();
    await context.route("https://fixture.atlassian.net/**", async (route) => {
      const url = new URL(route.request().url());
      const json = url.pathname.endsWith("/serverInfo")
        ? jiraCloudServerInfoFixture
        : url.pathname.endsWith("/myself")
          ? jiraCloudCurrentUserFixture
          : url.pathname.endsWith("/project/search")
            ? jiraCloudProjectsFixture
            : url.pathname.endsWith("/field")
              ? jiraFieldsFixture
              : url.pathname.endsWith("/search/jql")
                ? { issues, isLast: true }
                : undefined;

      if (json) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(json),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html>
          <html>
            <head>
              <meta name="ajs-base-url" content="https://fixture.atlassian.net">
              <meta name="ajs-project-key" content="POWER">
              <meta name="ajs-issue-key" content="POWER-1">
            </head>
            <body><h1>Fixture Jira issue</h1></body>
          </html>`,
      });
    });

    const jira = await context.newPage();
    await jira.goto("https://fixture.atlassian.net/browse/POWER-1");
    await expect(jira.getByRole("heading", { name: "Fixture Jira issue" })).toBeVisible();

    let serviceWorker = context.serviceWorkers()[0];
    serviceWorker ??= await context.waitForEvent("serviceworker");
    const extensionId = new URL(serviceWorker.url()).host;
    const app = await context.newPage();
    await app.goto(`chrome-extension://${extensionId}/app/index.html`);

    await expect(
      app.getByRole("heading", { name: "Test your Jira connection." }),
    ).toBeVisible();
    await app.getByRole("button", { name: "Test Jira connection" }).click();
    await expect(app.getByText("Connected as Fixture Cloud User")).toBeVisible();

    await app.getByRole("button", { name: "Load projects and fields" }).click();
    await expect(app.getByLabel("Jira project")).toHaveValue("POWER");
    await app.getByRole("button", { name: "Load issue preview" }).click();
    await expect(app.getByText("5 normalized issues ready")).toBeVisible();
    await expect(app.getByRole("heading", { name: "Schedule workspace" })).toBeVisible();
    await expect(app.locator(".gantt-dependency-path")).toHaveCount(1);

    await app.locator('summary[aria-label="Risk: All risks"]').click();
    await app.getByRole("checkbox", { name: "Risk: Blocked" }).check();
    await expect(app.getByText(/1 match/)).toBeVisible();
  });
});
