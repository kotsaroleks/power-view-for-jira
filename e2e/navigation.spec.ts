/// <reference types="chrome" />

import { expect, test as base, type Page } from "@playwright/test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { StoredJiraContext } from "../packages/storage/src/context-store";
import { jiraCloudCurrentUserFixture } from "../packages/test-fixtures/src/index";

import { installGitHubCalendarFixture } from "./github-calendar-fixture";
import { installJiraFixture } from "./jira-fixture";

const destinations = [
  { button: "Workspace", heading: "What do you want to open?" },
  { button: "Reports", heading: "Reports" },
  { button: "Timesheet", heading: "Timesheet" },
  { button: "Gantt", heading: "Gantt" },
  { button: "Status", heading: "Status chart" },
  { button: "Estimation", heading: "Estimation board" },
  { button: "Open diagnostics", heading: "Diagnostics" },
  { button: "Settings", heading: "Settings" },
] as const;

const test = base.extend<{
  connectionState: "cloud" | "data-center" | "no-context" | "signed-out";
  extension: {
    app: Page;
    fixture: Awaited<ReturnType<typeof installJiraFixture>>;
    open: () => Promise<void>;
    stageBuild: () => Promise<string>;
    errors: string[];
    recoverConnection: () => void;
  };
}>({
  connectionState: ["cloud", { option: true }],
  extension: async ({ playwright, connectionState }, provide) => {
    const directory = await mkdtemp(resolve(tmpdir(), "power-view-navigation-"));
    const extensionPath = resolve(directory, "extension");
    await cp(resolve(import.meta.dirname, "../dist/extension"), extensionPath, {
      recursive: true,
    });
    const manifestPath = resolve(extensionPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.host_permissions = ["https://fixture.atlassian.net/*"];
    await writeFile(manifestPath, JSON.stringify(manifest));
    const profilePath = resolve(directory, "profile");
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    const context = await playwright.chromium.launchPersistentContext(profilePath, {
      ...(executablePath ? { executablePath } : { channel: "chromium" }),
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      viewport: { width: 1440, height: 900 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    try {
      // Configure only this disposable headless profile as an unpacked developer
      // installation; Chrome otherwise disables it on runtime.reload.
      const manager = await context.newPage();
      await manager.goto("chrome://extensions");
      await manager.evaluate(async () => {
        const api = (
          chrome as typeof chrome & {
            developerPrivate: {
              updateProfileConfiguration: (update: {
                inDeveloperMode: boolean;
              }) => Promise<void>;
            };
          }
        ).developerPrivate;
        await api.updateProfileConfiguration({ inDeveloperMode: true });
      });
      await manager.close();
      const fixture = await installJiraFixture(
        context,
        connectionState === "data-center" ? "data-center" : "cloud",
      );
      await installGitHubCalendarFixture(context);
      let signedOut = connectionState === "signed-out";
      if (signedOut) {
        await context.route("**/rest/api/3/myself", (route) =>
          route.fulfill(
            signedOut
              ? {
                  status: 401,
                  json: { errorMessages: ["Sign in to the fixture Jira site."] },
                }
              : { status: 200, json: jiraCloudCurrentUserFixture },
          ),
        );
      }
      const jira = await context.newPage();
      await jira.goto("https://fixture.atlassian.net/browse/POWER-1");
      let worker = context.serviceWorkers()[0];
      worker ??= await context.waitForEvent("serviceworker");
      const extensionId = new URL(worker.url()).host;
      await expect
        .poll(async () =>
          worker.evaluate(async () =>
            Boolean(
              (await chrome.storage.session.get("jira-context:latest"))[
                "jira-context:latest"
              ],
            ),
          ),
        )
        .toBe(true);
      if (connectionState === "no-context") {
        await jira.close();
        await worker.evaluate(() => chrome.storage.session.clear());
      }
      if (connectionState === "data-center") {
        await worker.evaluate(async () => {
          const values = await chrome.storage.session.get("jira-context:latest");
          const stored = values["jira-context:latest"] as StoredJiraContext;
          stored.context.deploymentType = "data-center";
          await chrome.storage.session.set({
            "jira-context:latest": stored,
            [`jira-context:tab:${stored.tabId}`]: stored,
          });
        });
      }
      await worker.evaluate(() =>
        chrome.storage.local.set({
          "app-sections:v1": {
            reports: true,
            timesheet: true,
            gantt: true,
            status: true,
            estimation: true,
          },
        }),
      );
      const errors: string[] = [];
      context.on("page", (page) =>
        page.on("pageerror", (error) => {
          if (page.url().startsWith(`chrome-extension://${extensionId}/`))
            errors.push(error.message);
        }),
      );
      const app = await context.newPage();
      await provide({
        app,
        fixture,
        errors,
        stageBuild: async () => {
          const infoPath = resolve(extensionPath, "build-info.json");
          const info = JSON.parse(await readFile(infoPath, "utf8")) as {
            builtAt: string;
          };
          const builtAt = new Date(Date.parse(info.builtAt) + 1000).toISOString();
          const htmlPath = resolve(extensionPath, "app/index.html");
          const html = await readFile(htmlPath, "utf8");
          await writeFile(
            htmlPath,
            html
              .replace(info.builtAt, builtAt)
              .replace(
                /<title>[^<]*<\/title>/,
                `<title>Power View for Jira · ${builtAt}</title>`,
              ),
          );
          await writeFile(infoPath, JSON.stringify({ ...info, builtAt }));
          return builtAt;
        },
        recoverConnection: () => {
          signedOut = false;
        },
        open: async () => {
          await app.goto(`chrome-extension://${extensionId}/app/index.html`);
        },
      });
    } finally {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
});

function menuButton(app: Page, name: string) {
  return app.getByRole("banner").getByRole("button", { name, exact: true });
}

async function expectDestination(app: Page, destination: (typeof destinations)[number]) {
  await expect(
    app
      .getByRole("main")
      .getByRole("heading", {
        name: destination.heading,
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await expect(menuButton(app, destination.button)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(app.getByRole("banner").locator('[aria-current="page"]')).toHaveCount(1);
}

test("every top-menu destination works from every page and with the keyboard", async ({
  extension,
}) => {
  test.setTimeout(90_000);
  const { app, fixture, errors } = extension;
  await extension.open();
  await expectDestination(app, destinations[0]);
  for (const source of destinations) {
    for (const target of destinations) {
      await menuButton(app, source.button).click();
      await expectDestination(app, source);
      await menuButton(app, target.button).click();
      await expectDestination(app, target);
    }
  }
  for (const [index, destination] of destinations.entries()) {
    const button = menuButton(app, destination.button);
    await button.focus();
    await button.press(index % 2 ? "Enter" : "Space");
    await expectDestination(app, destination);
    await app.getByRole("button", { name: "Power View for Jira home" }).click();
    await expectDestination(app, destinations[0]);
  }
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("Settings layout and draft actions remain usable at desktop and narrow widths", async ({
  extension,
}, testInfo) => {
  const { app } = extension;
  await extension.open();
  await expectDestination(app, destinations[0]);
  await menuButton(app, "Settings").click();
  await expectDestination(app, destinations[7]);
  const query = app.getByRole("textbox", { name: "JQL query" });
  await expect(query).toBeVisible();
  const workspace = await app.locator(".workspace-settings-card").boundingBox();
  const sidebar = await app.locator(".settings-sidebar").boundingBox();
  expect(sidebar!.x).toBeGreaterThanOrEqual(workspace!.x + workspace!.width);
  await app.screenshot({
    path: testInfo.outputPath("settings-desktop.png"),
    fullPage: false,
  });
  for (const summary of await app.locator(".setup-form > details > summary").all()) {
    await summary.focus();
    await summary.press("Enter");
  }
  for (const width of [1440, 1024, 768, 390, 320]) {
    await app.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => app.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await query.scrollIntoViewIfNeeded();
    const save = app.getByRole("button", {
      name: "Save and open Workspace",
      exact: true,
    });
    const box = await save.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);
    expect(
      await save.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
    ).toBe(true);
    if (width === 390 || width === 320) {
      await app.evaluate(() => window.scrollTo(0, 0));
      await app.screenshot({
        path: testInfo.outputPath(`settings-${width}.png`),
        fullPage: false,
      });
    }
  }
  await query.fill('project = "OTHER" ORDER BY Rank ASC');
  await app.getByRole("button", { name: "Back to Workspace" }).click();
  await expectDestination(app, destinations[0]);
  await menuButton(app, "Settings").click();
  await expect(query).toHaveValue('project = "OTHER" ORDER BY Rank ASC');
  expect(extension.fixture.writes).toEqual([]);
  expect(extension.errors).toEqual([]);
});

test("Settings preview keeps the draft local and validation explains what to fix", async ({
  extension,
}) => {
  const { app, fixture } = extension;
  await extension.open();
  await expectDestination(app, destinations[0]);
  await menuButton(app, "Reports").click();
  await app.getByText("View scope", { exact: true }).click();
  const activeQuery = await app.locator(".report-scope code").innerText();
  await menuButton(app, "Settings").click();
  const readSavedSetups = () =>
    app.evaluate(async () => {
      const values = await chrome.storage.local.get("settings:v2");
      return (
        (values["settings:v2"] as { setups?: Record<string, unknown> } | undefined)
          ?.setups ?? {}
      );
    });
  const savedBefore = await readSavedSetups();
  await app.getByRole("searchbox", { name: "Search projects" }).press("Enter");
  await expectDestination(app, destinations[7]);
  expect(await readSavedSetups()).toEqual(savedBefore);
  const query = app.getByRole("textbox", { name: "JQL query" });
  await app.context().route("**/rest/agile/1.0/board/7/issue?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("jql")?.includes("key = POWER-2")
    ) {
      await route.fulfill({
        json: {
          issues: fixture.issues.filter(({ key }) => key === "POWER-2"),
          startAt: 0,
          maxResults: 100,
          total: 1,
        },
      });
    } else await route.fallback();
  });
  await query.fill("key = POWER-2 ORDER BY Rank ASC");
  await app.getByRole("button", { name: "Preview issues", exact: true }).click();
  await expect(app.locator(".issue-preview-result")).toContainText("1 issue ready");
  await expectDestination(app, destinations[7]);
  expect(await readSavedSetups()).toEqual(savedBefore);
  await menuButton(app, "Reports").click();
  await expect(app.locator(".report-scope code")).toHaveText(activeQuery);
  await menuButton(app, "Settings").click();
  await expect(query).toHaveValue("key = POWER-2 ORDER BY Rank ASC");
  await query.fill("");
  await app.getByRole("button", { name: "Save and open Workspace", exact: true }).click();
  const alert = app.locator(".setup-errors[role=alert]");
  await expect(alert).toContainText("JQL");
  await expect(alert).toBeFocused();
  await expectDestination(app, destinations[7]);
  await query.fill("key = POWER-2 ORDER BY Rank ASC");
  await expect(alert).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(extension.errors).toEqual([]);
});

test("editing Settings does not erase the loaded workspace or trap navigation", async ({
  extension,
}) => {
  const { app, fixture } = extension;
  await extension.open();
  await expectDestination(app, destinations[0]);
  await menuButton(app, "Settings").click();
  const query = app.getByRole("textbox", { name: "JQL query" });
  await query.fill('project = "OTHER" ORDER BY Rank ASC');
  await expect(menuButton(app, "Workspace")).toBeEnabled();
  for (const destination of destinations.filter(({ button }) => button !== "Settings")) {
    await menuButton(app, destination.button).click();
    await expectDestination(app, destination);
    if (destination.button === "Gantt") {
      await expect(
        app
          .getByRole("grid", { name: "Gantt tasks" })
          .getByRole("link", { name: "POWER-1", exact: true }),
      ).toBeVisible();
    }
    await menuButton(app, "Settings").click();
    await expect(query).toHaveValue('project = "OTHER" ORDER BY Rank ASC');
  }
  await app.getByRole("combobox", { name: "Jira board", exact: true }).selectOption("");
  await menuButton(app, "Workspace").click();
  await expectDestination(app, destinations[0]);
  await menuButton(app, "Settings").click();
  await app.getByRole("combobox", { name: "Jira board", exact: true }).selectOption("7");
  await expect(query).toHaveValue("filter = 9001 ORDER BY Rank ASC");
  await app.context().route("**/rest/agile/1.0/board/7/issue?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("jql")?.includes("key = POWER-2")
    ) {
      const issues = fixture.issues.filter(({ key }) => key === "POWER-2");
      await route.fulfill({
        json: { issues, startAt: 0, maxResults: 100, total: issues.length },
      });
    } else await route.fallback();
  });
  await query.fill("filter = 9001 AND key = POWER-2 ORDER BY Rank ASC");
  await app.getByRole("button", { name: "Save and open Workspace", exact: true }).click();
  await expectDestination(app, destinations[0]);
  await menuButton(app, "Gantt").click();
  const grid = app.getByRole("grid", { name: "Gantt tasks" });
  await expect(grid.getByRole("link", { name: "POWER-2", exact: true })).toBeVisible();
  await expect(grid.getByRole("link", { name: "POWER-1", exact: true })).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(extension.errors).toEqual([]);
});

test("Settings can be left while metadata is still loading", async ({ extension }) => {
  const { app } = extension;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await app.context().route("**/rest/api/3/field", async (route) => {
    requested();
    await waiting;
    await route.fallback();
  });
  try {
    await extension.open();
    await started;
    await menuButton(app, "Workspace").click();
    await expectDestination(app, destinations[0]);
    await menuButton(app, "Gantt").click();
    await expectDestination(app, destinations[3]);
    await expect(
      app.getByText("Workspace data is not ready yet.", { exact: true }),
    ).toBeVisible();
    await menuButton(app, "Settings").click();
    await expectDestination(app, destinations[7]);
    await menuButton(app, "Power View for Jira home").click();
    await expectDestination(app, destinations[0]);
  } finally {
    release();
  }
});

test("Gantt updates keep the loaded query separate from an unsaved Settings draft", async ({
  extension,
}) => {
  const { app, fixture } = extension;
  await extension.open();
  await expectDestination(app, destinations[0]);
  await menuButton(app, "Reports").click();
  await app.getByText("View scope", { exact: true }).click();
  const loadedQuery = await app.locator(".report-scope code").innerText();
  await menuButton(app, "Settings").click();
  const query = app.getByRole("textbox", { name: "JQL query" });
  await query.fill('project = "OTHER" ORDER BY Rank ASC');
  await menuButton(app, "Gantt").click();
  await app.getByRole("button", { name: "Edit status for POWER-1", exact: true }).click();
  await app
    .getByRole("combobox", { name: "Change status for POWER-1", exact: true })
    .selectOption("31");
  await menuButton(app, "Status").click();
  await expect(app.getByRole("img", { name: /Done 2, 66.7%/ })).toBeVisible();
  await menuButton(app, "Reports").click();
  await app.getByText("View scope", { exact: true }).click();
  await expect(app.locator(".report-scope code")).toHaveText(loadedQuery);
  await menuButton(app, "Settings").click();
  await expect(query).toHaveValue('project = "OTHER" ORDER BY Rank ASC');
  await expect(app.locator(".issue-preview-result")).toHaveCount(0);
  expect(fixture.writes.map(({ method }) => method)).toEqual(["POST"]);
  expect(fixture.unexpected).toEqual([]);
  expect(extension.errors).toEqual([]);
});

test("failed Settings metadata does not block the menu or home", async ({
  extension,
}) => {
  const { app } = extension;
  await app.context().route("**/rest/api/3/field", (route) =>
    route.fulfill({
      status: 403,
      json: { errorMessages: ["Fixture metadata unavailable"] },
    }),
  );
  await extension.open();
  await expect(
    app.getByRole("button", { name: "Retry setup data", exact: true }),
  ).toBeVisible();
  await menuButton(app, "Workspace").click();
  await expectDestination(app, destinations[0]);
  await menuButton(app, "Status").click();
  await expectDestination(app, destinations[4]);
  await expect(
    app.getByText("Workspace data is not ready yet.", { exact: true }),
  ).toBeVisible();
  await menuButton(app, "Settings").click();
  await menuButton(app, "Power View for Jira home").click();
  await expectDestination(app, destinations[0]);
});

for (const target of ["Timesheet", "Open diagnostics", "Settings"] as const) {
  test(`background workspace loading does not override ${target}`, async ({
    extension,
  }) => {
    const { app } = extension;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested!: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    await app.context().route("**/rest/agile/1.0/board/7/issue?**", async (route) => {
      requested();
      await waiting;
      await route.fallback();
    });
    try {
      await extension.open();
      await started;
      await menuButton(app, target).click();
      const destination = destinations.find(({ button }) => button === target)!;
      await expectDestination(app, destination);
      release();
      await expect(app.locator(".issue-preview-result")).toContainText(
        `${extension.fixture.issues.length} issues ready`,
      );
      await expectDestination(app, destination);
    } finally {
      release();
    }
    expect(extension.errors).toEqual([]);
    expect(extension.fixture.unexpected).toEqual([]);
  });
}

test("menu controls remain reachable and unobscured at narrow widths and 200% zoom", async ({
  extension,
}, testInfo) => {
  const { app } = extension;
  await extension.open();
  await expectDestination(app, destinations[0]);
  for (const width of [1920, 1440, 1280, 1110, 1100, 768, 560, 390, 320]) {
    await app.setViewportSize({ width, height: 900 });
    for (const destination of destinations) {
      const button = menuButton(app, destination.button);
      await button.click();
      await expectDestination(app, destination);
      expect(
        await button.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.left >= 0 &&
            bounds.right <= innerWidth &&
            element.contains(
              document.elementFromPoint(
                bounds.left + bounds.width / 2,
                bounds.top + bounds.height / 2,
              ),
            )
          );
        }),
        `${destination.button} at ${width}px`,
      ).toBe(true);
    }
    expect(
      await app.getByRole("banner").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth;
      }),
    ).toBe(true);
  }
  await app.screenshot({ path: testInfo.outputPath("menu-320.png") });
  await app.setViewportSize({ width: 1280, height: 900 });
  await app.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id === undefined) throw new Error("Missing app tab for zoom testing.");
    await chrome.tabs.setZoom(tab.id, 2);
  });
  await expect.poll(() => app.evaluate(() => innerWidth)).toBe(640);
  for (const destination of destinations) {
    await menuButton(app, destination.button).click();
    await expectDestination(app, destination);
  }
  await app.screenshot({ path: testInfo.outputPath("menu-200-percent.png") });
  expect(extension.errors).toEqual([]);
});

test("section visibility changes apply to both menu and Workspace and survive a reload", async ({
  extension,
}) => {
  const { app } = extension;
  await extension.open();
  await expectDestination(app, destinations[0]);
  const sections = [
    ["Reports", "Reports"],
    ["Timesheet", "Timesheet"],
    ["Gantt", "Gantt"],
    ["Status chart", "Status"],
    ["Estimation board", "Estimation"],
  ] as const;
  for (const [index, [label, button]] of sections.entries()) {
    await menuButton(app, "Settings").click();
    const toggle = app.getByRole("switch", { name: label, exact: true });
    await app
      .locator(".section-toggle-row")
      .filter({ has: toggle })
      .locator(".section-toggle-track")
      .click();
    await expect(toggle).not.toBeChecked();
    await expect(menuButton(app, button)).toHaveCount(0);
    await menuButton(app, "Workspace").click();
    await expect(app.locator(".tool-grid").getByRole("button")).toHaveCount(
      sections.length - index - 1,
    );
  }
  await expect(app.getByText("No sections are enabled.", { exact: false })).toBeVisible();
  await app.reload();
  await expectDestination(app, destinations[0]);
  await expect(app.locator(".tool-grid").getByRole("button")).toHaveCount(0);
  await menuButton(app, "Settings").click();
  for (const [label, button] of sections) {
    const toggle = app.getByRole("switch", { name: label, exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.press("Space");
    await expect(toggle).toBeChecked();
    await expect(menuButton(app, button)).toBeEnabled();
  }
  await menuButton(app, "Workspace").click();
  await expect(app.locator(".tool-grid").getByRole("button")).toHaveCount(5);
  expect(extension.errors).toEqual([]);
});

test("unfinished Timesheet cells explain blocked menu actions and allow navigation after canceling", async ({
  extension,
}) => {
  const { app, fixture } = extension;
  fixture.issues[0]!.fields.assignee.accountId = "fixture-account-id";
  await extension.open();
  await expectDestination(app, destinations[0]);
  await menuButton(app, "Timesheet").click();
  await app.getByRole("combobox", { name: "Board", exact: true }).selectOption("7");
  const cell = app.getByRole("textbox", { name: /^POWER-1, .*hours$/ }).first();
  await expect(cell).toBeEnabled();
  await cell.fill("invalid");
  for (const button of [
    ...destinations
      .filter(({ button }) => button !== "Timesheet")
      .map(({ button }) => button),
    "Power View for Jira home",
    "↻ Update app",
  ]) {
    await menuButton(app, button).click();
    await expectDestination(app, destinations[2]);
    await expect(
      app.getByRole("status").filter({
        hasText: "Finish saving or canceling your Timesheet changes",
      }),
    ).toBeVisible();
    await expect(cell).toHaveValue("invalid");
  }
  await cell.press("Escape");
  await menuButton(app, "Gantt").click();
  await expectDestination(app, destinations[3]);
  await expect(app.locator(".navigation-feedback")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(extension.errors).toEqual([]);
});

async function updateAndReopen(
  app: Page,
  stageBuild: () => Promise<string>,
): Promise<Page> {
  const buildTime = await stageBuild();
  const appUrl = app.url();
  const context = app.context();
  await Promise.all([app.waitForEvent("close"), menuButton(app, "↻ Update app").click()]);
  await expect
    .poll(() => context.pages().some((page) => page.url() === appUrl))
    .toBe(true);
  const restored = context.pages().find((page) => page.url() === appUrl);
  if (!restored) throw new Error("Power View did not reopen after updating.");
  await expect(restored).toHaveTitle(`Power View for Jira · ${buildTime}`);
  await expect(restored.locator('meta[name="power-view-built-at"]')).toHaveAttribute(
    "content",
    buildTime,
  );
  return restored;
}

test("Update app explains when Chrome already has the same build", async ({
  extension,
}) => {
  const { app } = extension;
  await extension.open();
  await expectDestination(app, destinations[0]);
  await menuButton(app, "Settings").click();
  await menuButton(app, "↻ Update app").click();
  await expect(
    app.getByRole("status").filter({ hasText: "Chrome already has this local build" }),
  ).toBeVisible();
  await expectDestination(app, destinations[7]);
  await expect(menuButton(app, "↻ Update app")).toBeEnabled();
  expect(extension.errors).toEqual([]);
});

test("Update app restores a connected application from every page", async ({
  extension,
}) => {
  test.setTimeout(90_000);
  let app = extension.app;
  await extension.open();
  await expectDestination(app, destinations[0]);
  for (const source of destinations) {
    await menuButton(app, source.button).click();
    await expectDestination(app, source);
    app = await updateAndReopen(app, extension.stageBuild);
    await expectDestination(app, destinations[0]);
    await menuButton(app, "Gantt").click();
    await expectDestination(app, destinations[3]);
    await expect(app.getByRole("grid", { name: "Gantt tasks" })).toBeVisible();
  }
  expect(extension.errors).toEqual([]);
  expect(extension.fixture.writes).toEqual([]);
  expect(extension.fixture.unexpected).toEqual([]);
});

test.describe("no Jira context", () => {
  test.use({ connectionState: "no-context" });
  test("Settings, diagnostics, home and Update app remain usable", async ({
    extension,
  }) => {
    let app = extension.app;
    await extension.open();
    await expectDestination(app, destinations[7]);
    await expect(menuButton(app, "Workspace")).toBeEnabled();
    await expect(menuButton(app, "Timesheet")).toHaveCount(0);
    await expect(app.getByRole("main").getByRole("alert")).toContainText(
      "No Jira context",
    );
    await menuButton(app, "Open diagnostics").click();
    await expectDestination(app, destinations[6]);
    await app.getByRole("button", { name: "← Back", exact: true }).click();
    await expectDestination(app, destinations[7]);
    await menuButton(app, "Open diagnostics").click();
    await menuButton(app, "Power View for Jira home").click();
    await expectDestination(app, destinations[0]);
    await menuButton(app, "Settings").click();
    app = await updateAndReopen(app, extension.stageBuild);
    await expectDestination(app, destinations[7]);
    await expect(app.getByRole("main").getByRole("alert")).toContainText(
      "No Jira context",
    );
    expect(extension.errors).toEqual([]);
  });
});

test.describe("Jira Data Center", () => {
  test.use({ connectionState: "data-center" });
  test("Cloud-only Timesheet is consistently disabled in the menu and Workspace", async ({
    extension,
  }) => {
    const { app } = extension;
    await extension.open();
    await expectDestination(app, destinations[0]);
    const timesheet = menuButton(app, "Timesheet");
    await expect(timesheet).toBeDisabled();
    await expect(timesheet).toHaveAttribute("title", "Timesheet requires Jira Cloud.");
    const card = app.locator(".tool-grid").getByRole("button", { name: /Timesheet/ });
    await expect(card).toBeDisabled();
    await expect(card).toHaveAttribute("title", "Timesheet requires Jira Cloud.");
    for (const destination of destinations.filter(
      ({ button }) => button !== "Timesheet",
    )) {
      await menuButton(app, destination.button).click();
      await expectDestination(app, destination);
      await expect(timesheet).toBeDisabled();
    }
    expect(extension.errors).toEqual([]);
    expect(extension.fixture.unexpected).toEqual([]);
  });
});

test.describe("signed-out Jira session", () => {
  test.use({ connectionState: "signed-out" });
  test("support and Settings remain reachable and navigation recovers after reconnecting", async ({
    extension,
  }) => {
    const { app } = extension;
    await extension.open();
    await expect(
      app.getByRole("button", { name: "Reconnect", exact: true }),
    ).toBeVisible();
    await expect(menuButton(app, "Workspace")).toBeEnabled();
    await expect(menuButton(app, "Timesheet")).toHaveCount(0);
    await menuButton(app, "Open diagnostics").click();
    await expectDestination(app, destinations[6]);
    await menuButton(app, "Settings").click();
    await expectDestination(app, destinations[7]);
    extension.recoverConnection();
    await app.getByRole("button", { name: "Reconnect", exact: true }).click();
    await expect(app.getByText("Connected as Fixture Cloud User")).toBeVisible();
    await expect(menuButton(app, "Timesheet")).toBeEnabled();
    await menuButton(app, "Timesheet").click();
    await expectDestination(app, destinations[2]);
    expect(extension.errors).toEqual([]);
  });
});
