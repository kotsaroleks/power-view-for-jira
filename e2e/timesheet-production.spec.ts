import { installGitHubCalendarFixture } from "./github-calendar-fixture";
import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { JiraTransportRequest } from "../packages/extension-messaging/src/schemas";
import { validatedJiraRequestUrl } from "../apps/extension/src/jira-request-policy";

const production = resolve(
  process.env.POWER_VIEW_E2E_APP_PATH ??
    resolve(import.meta.dirname, "../dist/extension/app"),
);
const baseUrl = "https://fixture.atlassian.net";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
test.use({
  ...(chromeExecutable ? { launchOptions: { executablePath: chromeExecutable } } : {}),
});
const sampleIssues = Array.from({ length: 6 }, (_, index) => ({
  id: String(20001 + index),
  key: `${index === 5 ? "OTHER" : "POWER"}-${index + 1}`,
  fields: {
    issuetype: { name: "Task", subtask: false, hierarchyLevel: 0 },
    assignee: { accountId: "me" },
    summary: [
      "Release preparation",
      "Review worklog contracts",
      "Regression tests",
      "Resolve integration failures",
      "Update release documentation",
      "Support another project",
    ][index]!,
    project: {
      id: index === 5 ? "20000" : "10000",
      key: index === 5 ? "OTHER" : "POWER",
      name: index === 5 ? "Other project" : "Power View",
    },
  },
}));

const weeklyIssues = [
  {
    id: "20070",
    key: "POWER-70",
    name: "Task",
    level: 0,
    assignee: "someone-else",
    parent: null,
    summary: "Pinned cross-team task",
  },
  {
    id: "20071",
    key: "POWER-71",
    name: "Task",
    level: 0,
    assignee: "fixture-author",
    parent: null,
    summary: "Assigned without worklogs",
  },
  {
    id: "20080",
    key: "LBR-68393",
    name: "Epic",
    level: 1,
    assignee: "someone-else",
    parent: null,
    summary: "ARIA — Regular Project related activities",
  },
  {
    id: "20081",
    key: "POWER-81",
    name: "Story",
    level: 0,
    assignee: "someone-else",
    parent: "LBR-68393",
    summary: "First-run experience",
  },
  {
    id: "20082",
    key: "POWER-82",
    name: "Subtask",
    level: -1,
    assignee: "someone-else",
    parent: "POWER-81",
    summary: "Welcome screen",
  },
  {
    id: "20083",
    key: "POWER-83",
    name: "Task",
    level: 0,
    assignee: "someone-else",
    parent: null,
    summary: "Other board work",
  },
].map((issue) => ({
  id: issue.id,
  key: issue.key,
  fields: {
    issuetype: {
      name: issue.name,
      subtask: issue.level === -1,
      hierarchyLevel: issue.level,
    },
    assignee: { accountId: issue.assignee },
    summary: issue.summary,
    ...(issue.parent ? { parent: { key: issue.parent } } : {}),
    project: { id: "10000", key: "POWER", name: "Power View" },
  },
}));
const allIssues = [...sampleIssues, ...weeklyIssues];

test("production Timesheet: no board dependency, compact grid and confirmed CRUD", async ({
  page,
}, testInfo) => {
  test.skip(
    !existsSync(resolve(production, "index.html")),
    "Build the extension before this test.",
  );
  const calendar = await installGitHubCalendarFixture(page);
  const user = {
    accountId: "fixture-author",
    displayName: "Demo user · TEST DATA",
    timeZone: "Europe/Kyiv",
  };
  let logs = sampleIssues.map((issue, index) => ({
    id: String(100 + index),
    issueId: issue.id,
    author: user,
    started: `${today}T09:00:00.000+0200`,
    timeSpentSeconds: 1800 * (index + 1),
    updated: "2026-10-29T12:00:00.000Z",
    comment: {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Test fixture worklog" }] },
      ],
    },
  }));
  const writes: JiraTransportRequest[] = [];
  const reads: JiraTransportRequest[] = [];
  let nextId = 9000;
  await page.exposeFunction(
    "powerViewTestSend",
    (input: { type: string; requestId: string; payload?: JiraTransportRequest }) => {
      const common = { requestId: input.requestId, ok: true };
      if (input.type === "CONTEXT_GET")
        return {
          ...common,
          type: "CONTEXT_RESULT",
          context: {
            baseUrl,
            pageUrl: `${baseUrl}/browse/POWER-1`,
            deploymentType: "cloud",
            detectedAt: new Date().toISOString(),
            projectKey: "POWER",
            detectionSources: ["url"],
          },
        };
      if (input.type === "DIAGNOSTICS_GET")
        return {
          ...common,
          type: "DIAGNOSTICS_RESULT",
          diagnostics: {
            extensionVersion: "0.3.0",
            browserVersion: "Test",
            cacheStatus: "not-configured",
            loadedIssueCount: 0,
          },
        };
      if (input.type !== "JIRA_REQUEST" || !input.payload)
        return { ...common, type: "ACK" };
      const req = input.payload;
      validatedJiraRequestUrl(req, baseUrl, false);
      const path = req.path;
      const method = req.method;
      let data: unknown;
      const issueKey = path.match(/\/issue\/([^/]+)/)?.[1];
      const issue = allIssues.find((value) => value.key === issueKey);
      const worklogId = path.match(/\/worklog\/(\d+)$/)?.[1];
      const body = req.body as
        | {
            jql?: string;
            started?: string;
            timeSpentSeconds?: number;
            comment?: (typeof logs)[number]["comment"];
          }
        | undefined;
      if (method !== "GET" && path.includes("/worklog")) {
        writes.push(req);
        if (method === "DELETE") {
          logs = logs.filter((log) => log.id !== worklogId);
          data = null;
        } else {
          if (!issue || !body?.started || !body.timeSpentSeconds)
            throw new Error("Invalid fixture mutation");
          const saved = {
            id: worklogId ?? String(nextId++),
            issueId: issue.id,
            author: user,
            started: body.started,
            timeSpentSeconds: body.timeSpentSeconds,
            updated: new Date(Date.now() + nextId++).toISOString(),
            comment: body.comment ??
              logs.find((log) => log.id === worklogId)?.comment ?? {
                type: "doc",
                version: 1,
                content: [],
              },
          };
          logs = [...logs.filter((log) => log.id !== worklogId), saved];
          data = saved;
        }
      } else {
        reads.push(req);
        if (path.endsWith("/myself")) data = user;
        else if (path.endsWith("/serverInfo"))
          data = { baseUrl, deploymentType: "Cloud", versionNumbers: [1001, 0, 0] };
        else if (path.endsWith("/field")) data = [];
        else if (path.endsWith("/project/search"))
          data = {
            values: [
              { id: "10000", key: "POWER", name: "Power View" },
              { id: "20000", key: "OTHER", name: "Other project" },
            ],
            startAt: 0,
            maxResults: 50,
            total: 2,
            isLast: true,
          };
        else if (path.endsWith("/search/jql")) {
          const jql = body?.jql ?? String(req.query?.jql ?? "");
          data = {
            issues: /filter\s*=\s*42/i.test(jql)
              ? allIssues
              : /key\s*=\s*"?OTHER-6/i.test(jql)
                ? [sampleIssues[5]]
                : sampleIssues,
            isLast: true,
          };
        } else if (path.endsWith("/worklog")) {
          const records = logs.filter((log) => log.issueId === issue?.id);
          data = {
            worklogs: records,
            startAt: 0,
            maxResults: 100,
            total: records.length,
          };
        } else if (worklogId) data = logs.find((log) => log.id === worklogId);
        else if (issue) data = issue;
        else if (path === "/rest/agile/1.0/board")
          data = {
            values: [{ id: 7, name: "Team board" }],
            startAt: 0,
            maxResults: 50,
            total: 1,
            isLast: true,
          };
        else if (path === "/rest/agile/1.0/board/7/configuration")
          data = { filter: { id: "42" } };
        else throw new Error(`Unexpected fixture read: ${method} ${path}`);
      }
      return {
        ...common,
        type: "JIRA_RESPONSE",
        status: method === "DELETE" ? 204 : 200,
        data,
        durationMs: 1,
        retryCount: 0,
      };
    },
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "power-view:weekly-priority:v1:https://fixture.atlassian.net:fixture-author",
      JSON.stringify(["LBR-68393"]),
    );
    const send = (message: unknown) =>
      (
        globalThis as typeof globalThis & {
          powerViewTestSend: (input: unknown) => Promise<unknown>;
        }
      ).powerViewTestSend(message);
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          sendMessage: send,
        },
        permissions: {
          contains: () => Promise.resolve(true),
          request: () => Promise.resolve(true),
        },
      },
    });
  });
  await page.route("https://power-view.test/**", async (route) => {
    const relative =
      new URL(route.request().url()).pathname.replace(/^\//, "") || "index.html";
    const path = resolve(production, relative);
    if (!path.startsWith(`${production}/`)) throw new Error("Invalid fixture asset path");
    await route.fulfill({
      body: await readFile(
        relative.startsWith("icons/") ? resolve(production, "..", relative) : path,
      ),
      contentType: path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".png")
            ? "image/png"
            : "text/html",
    });
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("https://power-view.test/index.html");
  await page.getByRole("button", { name: "Timesheet", exact: true }).click();
  const table = page.getByRole("table");
  await expect(page.getByRole("combobox", { name: "Period", exact: true })).toHaveValue(
    "week",
  );
  await expect(page.getByRole("button", { name: "Log time", exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(table).toBeVisible();
  await expect(page.getByRole("status", { name: "Jira time zone warning" })).toHaveCount(
    0,
  );
  await expect(table.getByRole("link", { name: "OTHER-6", exact: true })).toBeVisible();
  expect(reads.some((req) => /\/board\/\d+\/issue$/.test(req.path))).toBe(false);
  expect(reads.find((req) => req.path === "/rest/api/3/search/jql")?.body).toMatchObject({
    jql: expect.stringContaining("worklogAuthor = currentUser()"),
  });
  const firstRow = table.locator("tbody tr").nth(4);
  expect(
    (await firstRow.boundingBox())!.y + (await firstRow.boundingBox())!.height,
  ).toBeLessThan(900);
  await page.screenshot({
    path: testInfo.outputPath("layout-check.png"),
    fullPage: true,
  });
  expect((await table.boundingBox())!.y).toBeLessThan(300);
  await page.screenshot({
    path: testInfo.outputPath("timesheet-week.png"),
    fullPage: true,
  });
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("month");
  await expect(table).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("timesheet-month.png"),
    fullPage: true,
  });
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("week");
  await page.getByRole("button", { name: /OTHER-6, .*3h, 1 worklogs/ }).click();
  await expect(page.getByRole("region", { name: "Worklog details" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("timesheet-details.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add another worklog", exact: true }).click();
  const inlineCreate = page.getByRole("region", { name: "Log time", exact: true });
  await expect(inlineCreate).toBeVisible();
  await expect(inlineCreate).toContainText("OTHER-6");
  await expect(page.getByRole("dialog", { name: "Log time", exact: true })).toBeVisible();
  await expect(
    inlineCreate.getByRole("combobox", { name: "Board", exact: true }),
  ).toHaveCount(0);
  await expect(table).toBeAttached();
  await page.getByLabel("Duration", { exact: true }).fill("90m");
  await page.screenshot({
    path: testInfo.outputPath("timesheet-log-time.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save worklog" }).click();
  await expect(inlineCreate).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /OTHER-6, .*4h 30m, 2 worklogs/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /OTHER-6, .*4h 30m, 2 worklogs/ }).click();
  const savedId = logs.find(
    (log) =>
      log.issueId === "20006" && log.timeSpentSeconds === 5400 && Number(log.id) >= 9000,
  )!.id;
  await page
    .getByRole("button", { name: `Edit worklog ${savedId}`, exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Edit worklog", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Edit worklog", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Duration", { exact: true }).fill("30m");
  await page.getByRole("button", { name: "Save worklog" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /OTHER-6, .*3h 30m, 2 worklogs/ }).click();
  await page
    .getByRole("button", { name: `Delete worklog ${savedId}`, exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Delete worklog", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Delete worklog", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /OTHER-6, .*3h, 1 worklogs/ }),
  ).toBeVisible();
  expect(writes.map((req) => req.method)).toEqual(["POST", "PUT", "DELETE"]);
  expect(writes.every((req) => req.query?.adjustEstimate === "leave")).toBe(true);
  const weeklyControls = page.getByLabel("Weekly tasks", { exact: true });
  await weeklyControls
    .getByRole("combobox", { name: "Board", exact: true })
    .selectOption("7");
  await expect(table.getByRole("link", { name: "POWER-71", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pin POWER-70", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unpin POWER-70", exact: true }),
  ).toBeVisible();
  await expect(table.getByRole("link").first()).toHaveText("POWER-70");
  await expect(
    page.getByRole("button", { name: "Expand LBR-68393", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(table.getByRole("link", { name: "POWER-81", exact: true })).toHaveCount(0);
  await expect(page.getByText("Pinned issues", { exact: true })).toBeVisible();
  await expect(page.getByText("My worklogs this week", { exact: true })).toBeVisible();
  await expect(page.getByText("Priority issues", { exact: true })).toBeVisible();
  const order = await table.getByRole("link").allTextContents();
  expect(order.indexOf("LBR-68393")).toBeGreaterThan(order.indexOf("OTHER-6"));
  expect(order.indexOf("LBR-68393")).toBeLessThan(order.indexOf("POWER-71"));
  await expect(page.getByText("Assigned to me", { exact: true })).toBeVisible();
  await expect(page.getByText("Other issues", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector(".timesheet-table-scroll")!.scrollTop = 0;
  });
  await page.screenshot({
    path: testInfo.outputPath("timesheet-agreed-groups-1440.png"),
    fullPage: false,
  });
  await table.getByRole("link", { name: "LBR-68393", exact: true }).evaluate((link) => {
    const row = link.closest("tr")!;
    const scroll = row.closest(".timesheet-table-scroll")!;
    scroll.scrollTop = row.offsetTop - 90;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: testInfo.outputPath("timesheet-priority.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: "Expand LBR-68393", exact: true }).click();
  await page.getByRole("button", { name: "Expand POWER-81", exact: true }).click();
  await expect(table.getByRole("link", { name: "POWER-82", exact: true })).toBeVisible();
  await table
    .getByRole("link", { name: "POWER-82", exact: true })
    .scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const scroll = document.querySelector(".timesheet-table-scroll")!;
    scroll.scrollTop = scroll.scrollHeight;
  });
  await page.screenshot({
    path: testInfo.outputPath("timesheet-agreed-hierarchy.png"),
    fullPage: false,
  });
  const ownEmptyCell = page.getByRole("textbox", { name: /POWER-71, .*hours/ }).first();
  await expect(ownEmptyCell).toBeEnabled();
  await ownEmptyCell.fill("1,5");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Log time", exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: testInfo.outputPath("timesheet-inline-entry.png"),
    fullPage: false,
  });
  const adjacentCell = page.getByRole("textbox", { name: /POWER-71, .*hours/ }).nth(1);
  await ownEmptyCell.press("Tab");
  await expect
    .poll(() => logs.find((log) => log.issueId === "20071")?.timeSpentSeconds)
    .toBe(5400);
  expect(writes.at(-1)?.body).toMatchObject({ timeSpentSeconds: 5400 });
  await expect(adjacentCell).toBeFocused();
  await adjacentCell.fill("0");
  await adjacentCell.press("Tab");
  const cellError = page.locator(".weekly-cell-error");
  await expect(cellError).toContainText("Use details to delete time");
  await expect(cellError.getByRole("button", { name: "Refresh records" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("timesheet-invalid-entry.png"),
    fullPage: true,
  });
  await adjacentCell.press("Escape");
  await expect(cellError).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("timesheet-inline-saved.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector(".timesheet-table-scroll")!.scrollTop = 0;
  });
  const fifthIssueRow = table.getByRole("link").nth(4).locator("xpath=ancestor::tr");
  const fifthIssueBounds = (await fifthIssueRow.boundingBox())!;
  expect(fifthIssueBounds.y + fifthIssueBounds.height).toBeLessThanOrEqual(800);
  await expect(
    table.getByRole("columnheader", { name: "Issue", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("timesheet-agreed-groups-1280.png"),
    fullPage: false,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(table).toBeVisible();
  await expect(
    weeklyControls.getByRole("combobox", { name: "Board", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("navigation", { name: "Power View navigation" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const brand = document.querySelector(".brand-copy")!.getBoundingClientRect();
      const actions = document.querySelector(".topbar-actions")!.getBoundingClientRect();
      return (
        brand.bottom <= actions.top ||
        actions.bottom <= brand.top ||
        brand.right <= actions.left
      );
    }),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("timesheet-zoom-200.png"),
    fullPage: false,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
    window.scrollTo(0, 0);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  // Mark and clear an empty date without producing a Jira mutation.
  const dayOffControls = page.getByRole("checkbox", { name: /^Day off / });
  const emptyDate = await dayOffControls.evaluateAll((nodes) =>
    nodes
      .find((node) => !(node as HTMLInputElement).disabled)
      ?.getAttribute("aria-label"),
  );
  expect(emptyDate).toBeTruthy();
  const dayOff = page.getByRole("checkbox", { name: emptyDate!, exact: true });
  const writesBefore = writes.length;
  await dayOff.click();
  await expect(dayOff).toBeChecked();
  await expect(dayOff).toBeEnabled();
  await dayOff.click();
  await expect(dayOff).not.toBeChecked();
  expect(calendar.writes()).toBe(2);
  expect(writes).toHaveLength(writesBefore);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("navigation", { name: "Power View navigation" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const brand = document.querySelector(".brand-copy strong")!.getBoundingClientRect();
      const actions = document.querySelector(".topbar-actions")!.getBoundingClientRect();
      return brand.right <= actions.left;
    }),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("timesheet-mobile.png"),
    fullPage: true,
  });
  expect(pageErrors).toEqual([]);
  user.timeZone = "America/Los_Angeles";
  logs.find((log) => log.issueId === "20006")!.started = "2026-11-02T14:00:00.000-0800";
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await page.getByRole("button", { name: "Timesheet", exact: true }).click();
  await page.getByLabel("Go to date").fill("2026-11-02");
  await expect(page.getByRole("table")).toHaveAccessibleName(
    /America\/Los_Angeles · Jira profile/,
  );
  await expect(
    page.getByRole("textbox", { name: "OTHER-6, 2026-11-02, hours", exact: true }),
  ).toHaveValue("3");
  await expect(
    page.getByRole("textbox", { name: "OTHER-6, 2026-11-03, hours", exact: true }),
  ).toHaveValue("");
  const timeZoneWarning = page.getByRole("status", { name: "Jira time zone warning" });
  await expect(timeZoneWarning).toBeVisible();
  await expect(timeZoneWarning).toContainText(
    "America/Los_Angeles (−10h relative to Europe/Kyiv",
  );
  await expect(page.getByLabel("Go to date")).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("timesheet-jira-profile-date.png"),
    fullPage: true,
  });
  const writesBeforeZoneChange = writes.length;
  await page.getByText(/Filters & time zone/).click();
  await page
    .getByRole("combobox", { name: "Time zone", exact: true })
    .selectOption("Europe/Kyiv");
  await expect(timeZoneWarning).toContainText("Timesheet view: Europe/Kyiv.");
  await expect(timeZoneWarning).toContainText("America/Los_Angeles (−10h");
  await expect(
    page.getByRole("textbox", { name: "OTHER-6, 2026-11-03, hours", exact: true }),
  ).toHaveValue("3");
  expect(writes).toHaveLength(writesBeforeZoneChange);
  await page.getByText(/Filters & time zone/).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(timeZoneWarning).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("timesheet-time-zone-warning-mobile.png"),
    fullPage: false,
  });
  expect(pageErrors).toEqual([]);
});
