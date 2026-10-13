import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { installJiraFixture } from "./jira-fixture";
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
    await expect(app.getByText("No Jira context is available yet.")).toBeVisible();
  });

  test("detects Jira and loads a fixture schedule through the browser session", async () => {
    if (!context) {
      throw new Error("The extension browser context was not initialized.");
    }

    const fixture = await installJiraFixture(context);

    const jira = await context.newPage();
    await jira.goto("https://fixture.atlassian.net/browse/POWER-1");
    await expect(jira.getByRole("heading", { name: "Fixture Jira issue" })).toBeVisible();

    let serviceWorker = context.serviceWorkers()[0];
    serviceWorker ??= await context.waitForEvent("serviceworker");
    const extensionId = new URL(serviceWorker.url()).host;
    const app = await context.newPage();
    await app.goto(`chrome-extension://${extensionId}/app/index.html`);

    await expect(
      app.getByRole("heading", { name: "What do you want to open?" }),
    ).toBeVisible();
    await app.getByRole("button", { name: "Gantt", exact: true }).click();
    const grid = app.getByRole("grid", { name: "Gantt tasks" });
    await expect(grid.getByRole("link", { name: "POWER-1", exact: true })).toBeVisible();
    await expect(grid.getByRole("row")).toHaveCount(4);

    // Active filters must remain visible and reversible at narrow widths.
    const hideCompleted = app.getByRole("checkbox", {
      name: "Hide completed matching tasks",
    });
    await hideCompleted.check();
    await expect(grid.getByRole("row")).toHaveCount(3);
    await app.setViewportSize({ width: 768, height: 900 });
    await expect(hideCompleted).toBeVisible();
    await hideCompleted.uncheck();
    await expect(grid.getByRole("row")).toHaveCount(4);
    await app.setViewportSize({ width: 1280, height: 900 });

    // Grid arrows move focus without opening an issue or changing Jira.
    const firstCell = grid.getByRole("gridcell").nth(0);
    await firstCell.focus();
    await app.keyboard.press("ArrowDown");
    await expect(grid.getByRole("gridcell").nth(3)).toBeFocused();
    await app.keyboard.press("Control+Home");
    await expect(firstCell).toBeFocused();

    // Labels span weeks/months instead of competing for a daily cell.
    const dateLabels = app.locator(".gantt-v2-date-header > span");
    expect(await dateLabels.count()).toBeLessThan(15);
    for (const label of await dateLabels.all()) {
      expect(
        await label.evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
    await app.getByRole("button", { name: "Month", exact: true }).click();
    expect(await dateLabels.count()).toBeLessThan(5);

    // Real extension messaging + transport, with a mutable simulated Jira server.
    await app
      .getByRole("button", { name: "Edit status for POWER-1", exact: true })
      .click();
    await app
      .getByRole("combobox", { name: "Change status for POWER-1", exact: true })
      .selectOption("31");
    await expect(
      app.getByRole("button", { name: "Edit status for POWER-1", exact: true }),
    ).toHaveText("Done");
    await expect.poll(() => fixture.issues[0]?.fields.status.name).toBe("Done");

    await app
      .getByRole("button", { name: "Edit assignee for POWER-2", exact: true })
      .click();
    await app
      .getByRole("searchbox", { name: "Search assignee for POWER-2", exact: true })
      .fill("Fixture New User");
    await app.getByRole("button", { name: "Search Jira users", exact: true }).click();
    await app
      .getByRole("button", { name: "Assign POWER-2 to Fixture New User", exact: true })
      .click();
    await expect(
      app.getByRole("button", { name: "Edit assignee for POWER-2", exact: true }),
    ).toHaveText("Fixture New User");
    await expect
      .poll(() => fixture.issues[1]?.fields.assignee.accountId)
      .toBe("fixture-new-user");

    await app.getByRole("button", { name: "Day", exact: true }).click();
    await app.getByRole("button", { name: "Today", exact: true }).click();
    const move = app.getByRole("button", { name: "Move POWER-2", exact: true });
    await move.scrollIntoViewIfNeeded();
    const bar = await move.boundingBox();
    if (!bar) throw new Error("Missing task bar");
    const originalDate = fixture.issues[1]?.fields.customfield_10010;
    await app.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await app.mouse.down();
    await app.mouse.move(bar.x + bar.width / 2 + 80, bar.y + bar.height / 2, {
      steps: 5,
    });
    await app.mouse.up();
    await expect
      .poll(() => fixture.issues[1]?.fields.customfield_10010)
      .not.toBe(originalDate);
    expect(fixture.writes.map(({ method }) => method)).toEqual(["POST", "PUT", "PUT"]);

    // A reload verifies server-backed state rather than just optimistic labels.
    await app.reload();
    await expect(
      app.getByRole("heading", { name: "What do you want to open?" }),
    ).toBeVisible();
    await app.getByRole("button", { name: "Gantt", exact: true }).click();
    await expect(
      app.getByRole("button", { name: "Edit status for POWER-1", exact: true }),
    ).toHaveText("Done");
    await expect(
      app.getByRole("button", { name: "Edit assignee for POWER-2", exact: true }),
    ).toHaveText("Fixture New User");
    await app.getByRole("button", { name: "Reports", exact: true }).click();
    await app
      .getByRole("combobox", { name: "Report type", exact: true })
      .selectOption("weekly");
    await app.getByRole("button", { name: "Generate report", exact: true }).click();
    await expect(
      app.getByRole("button", { name: "Copy stand-up", exact: true }),
    ).toBeVisible();
    await expect(
      app.getByRole("button", { name: /WEEKLY · Power Delivery Board/ }),
    ).toBeVisible();
    expect(fixture.unexpected).toEqual([]);
  });
});
