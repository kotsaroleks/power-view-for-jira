import { installGitHubCalendarFixture } from "./github-calendar-fixture";
import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  POWER_VIEW_TEAM_CONTEXT_QUERY,
  POWER_VIEW_MY_TEAMS_QUERY,
} from "../packages/extension-messaging/src/teams-queries";
import { validatedJiraRequestUrl } from "../apps/extension/src/jira-request-policy";
import {
  jiraTransportRequestSchema,
  type JiraTransportRequest,
} from "../packages/extension-messaging/src/schemas";
import {
  jiraCloudProjectsFixture,
  jiraFieldsFixture,
  makeJiraIssueFixtures,
} from "../packages/test-fixtures/src/index";

const production = resolve(
  process.env.POWER_VIEW_E2E_APP_PATH ??
    resolve(import.meta.dirname, "../dist/extension/app"),
);
const baseUrl = "https://fixture.atlassian.net";
const orgId = "fixture-org";
const teamId = "12121212-3434-5656-7878-909090909090";
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
test.use({
  ...(chromeExecutable ? { launchOptions: { executablePath: chromeExecutable } } : {}),
});

test("production Time Report: team-week worklog search, cross-project totals and styled responsive views", async ({
  page,
}, testInfo) => {
  test.skip(!existsSync(resolve(production, "index.html")), "Build the extension first.");
  const calendar = await installGitHubCalendarFixture(page, false);
  const viewer = {
    accountId: "fixture-author",
    displayName: "Alex Morgan",
    timeZone: "Europe/Kyiv",
  };
  const board = {
    id: 7,
    name: "Power Delivery Board",
    type: "scrum",
    location: { projectKey: "POWER" },
  };
  const boardIssues = makeJiraIssueFixtures(1);
  const descriptionChild = {
    id: "91009",
    key: "POWER-9",
    fields: {
      summary: "TEST DATA · Edited description",
      issuetype: { id: "subtask", name: "Subtask" },
      parent: { id: "91008", key: "POWER-8" },
    },
  };
  const descriptionParent = {
    id: "91008",
    key: "POWER-8",
    fields: {
      summary: "TEST DATA · Parent outside the candidate list",
      issuetype: { id: "epic", name: "Epic" },
    },
  };
  const adminIssue = {
    id: "90001",
    key: "ADMIN-9",
    fields: {
      summary: "Administrative work outside the current board",
      project: { id: "90000", key: "ADMIN" },
    },
  };
  const oldIssue = {
    id: "90002",
    key: "ARCHIVE-2",
    fields: {
      summary: "Older worklog outside the searchable worklog index",
      project: { id: "90001", key: "ARCHIVE" },
    },
  };
  const worklog = (
    id: string,
    issueId: string,
    accountId: string,
    seconds: number,
    started = "2026-10-26T10:00:00+0200",
  ) => ({
    id,
    issueId,
    author: { accountId },
    started,
    timeSpentSeconds: seconds,
    updated: "2026-10-28T12:00:00Z",
  });
  const logs = [
    worklog("101", adminIssue.id, viewer.accountId, 7200),
    worklog("102", oldIssue.id, viewer.accountId, 3600, "2026-10-25T22:30:00Z"),
    worklog("103", adminIssue.id, "fixture-colleague", 14400),
    worklog("104", adminIssue.id, "outsider", 28800),
    worklog("105", oldIssue.id, viewer.accountId, 3600, "2026-11-01T22:30:00Z"),
    worklog("106", oldIssue.id, viewer.accountId, 1800, "2026-09-30T22:30:00Z"),
  ];
  const requests: JiraTransportRequest[] = [];
  const unexpected: string[] = [];
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
            pageUrl: `${baseUrl}/jira/software/c/projects/POWER/boards/7`,
            deploymentType: "cloud",
            detectedAt: new Date().toISOString(),
            projectKey: "POWER",
            boardId: "7",
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
      const req = jiraTransportRequestSchema.parse(input.payload);
      validatedJiraRequestUrl(req, baseUrl, false);
      requests.push(req);
      let data: unknown;
      let status = 200;
      const path = req.path;
      const body = req.body as { jql?: string; nextPageToken?: string } | undefined;
      if (path.endsWith("/myself")) data = viewer;
      else if (path.endsWith("/serverInfo"))
        data = { baseUrl, deploymentType: "Cloud", versionNumbers: [1001, 0, 0] };
      else if (path.endsWith("/field")) data = jiraFieldsFixture;
      else if (path.endsWith("/project/search")) data = jiraCloudProjectsFixture;
      else if (path === "/rest/agile/1.0/board")
        data = { values: [board], startAt: 0, maxResults: 50, total: 1, isLast: true };
      else if (path.endsWith("/board/7/configuration"))
        data = {
          id: 7,
          name: board.name,
          filter: { id: 9001 },
          columnConfig: { columns: [{ statuses: [{ id: "1" }] }] },
        };
      else if (path.endsWith("/board/7")) data = board;
      else if (path.endsWith("/board/7/issue"))
        data = {
          issues: String(req.query?.jql ?? "").includes("updated >=")
            ? [descriptionChild]
            : boardIssues,
          startAt: 0,
          maxResults: 100,
          total: boardIssues.length,
        };
      else if (path.endsWith("/issue/POWER-8")) data = descriptionParent;
      else if (path.endsWith("/POWER-9/changelog")) {
        const offset = Number(req.query?.startAt ?? 0);
        data = {
          startAt: offset,
          maxResults: 1,
          total: 2,
          values: [
            {
              id: String(700 + offset),
              created: "2026-11-06T10:00:00Z",
              author: {
                accountId: offset ? "editor-b" : "editor-a",
                displayName: offset ? "Bob Editor" : "Alice Editor",
              },
              items: [
                {
                  fieldId: "description",
                  field: "Опис",
                  fromString: "Private old description",
                  toString: "Private new description",
                },
              ],
            },
          ],
        };
      } else if (path.endsWith("/board/7/sprint"))
        data = { values: [], startAt: 0, maxResults: 50, total: 0, isLast: true };
      else if (path.endsWith("/project/POWER/statuses")) data = [];
      else if (path.endsWith("/status")) data = [];
      else if (path === "/gateway/api/graphql") {
        const graph = req.body as { query: string; variables: Record<string, unknown> };
        if (graph.query === POWER_VIEW_TEAM_CONTEXT_QUERY)
          data = {
            data: {
              tenantContexts: [
                {
                  hostName: "fixture.atlassian.net",
                  cloudId: "11111111-2222-3333-4444-555555555555",
                  orgId,
                },
              ],
            },
          };
        else if (graph.query === POWER_VIEW_MY_TEAMS_QUERY) {
          expect(graph.variables.memberId).toBe(viewer.accountId);
          data = {
            data: {
              team: {
                teamSearchV2: {
                  nodes: [
                    {
                      team: {
                        id: `ari:cloud:identity::team/${teamId}`,
                        displayName: "Platform Team · TEST DATA",
                        organizationId: `ari:cloud:platform::org/${orgId}`,
                      },
                    },
                    {
                      team: {
                        id: "ari:cloud:identity::team/21212121-3434-5656-7878-909090909090",
                        displayName: "Support Team · TEST DATA",
                        organizationId: `ari:cloud:platform::org/${orgId}`,
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          };
        } else throw new Error("Unapproved GraphQL query in browser fixture");
      } else if (path.endsWith(`/teams/${teamId}/members`))
        data = {
          pageInfo: { hasNextPage: false, endCursor: null },
          results: [{ accountId: viewer.accountId }, { accountId: "fixture-colleague" }],
        };
      else if (path.endsWith(`/teams/${teamId}`))
        data = {
          organizationId: orgId,
          teamId,
          displayName: "Platform Team · TEST DATA",
          state: "ACTIVE",
        };
      else if (path === "/rest/api/3/user")
        data = {
          accountId: req.query?.accountId,
          displayName:
            req.query?.accountId === viewer.accountId ? "Alex Morgan" : "Jamie Lee",
        };
      else if (path.endsWith("/search/jql")) {
        const jql = body?.jql ?? String(req.query?.jql ?? "");
        if (/^\s*ORDER\s+BY\b/i.test(jql)) {
          status = 400;
          data = {
            errorMessages: [
              "Unbounded JQL queries are not allowed here. Please add a search restriction to your query.",
            ],
          };
        } else if (
          /worklogAuthor\s+in\s*\(/i.test(jql) &&
          /worklogDate\s*>=/i.test(jql) &&
          /worklogDate\s*</i.test(jql)
        ) {
          data =
            body?.nextPageToken === "old-issues"
              ? { issues: [oldIssue], isLast: true }
              : { issues: [adminIssue], isLast: false, nextPageToken: "old-issues" };
        } else data = { issues: boardIssues, isLast: true };
      } else if (path.endsWith("/worklog")) {
        const key = path.match(/\/issue\/([^/]+)\/worklog$/)?.[1];
        const issueId =
          key === adminIssue.key
            ? adminIssue.id
            : key === oldIssue.key
              ? oldIssue.id
              : "none";
        const records = logs.filter((log) => log.issueId === issueId);
        data = { worklogs: records, startAt: 0, maxResults: 100, total: records.length };
      } else {
        unexpected.push(`${req.method} ${path}`);
        throw new Error(`Unexpected Time Report fixture request: ${req.method} ${path}`);
      }
      return {
        ...common,
        type: "JIRA_RESPONSE",
        status,
        data,
        durationMs: 1,
        retryCount: 0,
      };
    },
  );
  await page.addInitScript(() => {
    const stored: Record<string, unknown> = {};
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        permissions: {
          contains: () => Promise.resolve(true),
          request: () => Promise.resolve(true),
        },

        storage: {
          local: {
            get: (keys: string | string[]) =>
              Promise.resolve(
                Object.fromEntries(
                  (Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]]),
                ),
              ),
            set: (items: Record<string, unknown>) => {
              Object.assign(stored, items);
              return Promise.resolve();
            },
            remove: (keys: string | string[]) => {
              (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
                delete stored[key];
              });
              return Promise.resolve();
            },
          },
        },
        runtime: {
          sendMessage: (message: unknown) =>
            (
              globalThis as typeof globalThis & {
                powerViewTestSend: (message: unknown) => Promise<unknown>;
              }
            ).powerViewTestSend(message),
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
          : "text/html",
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("https://power-view.test/index.html");
  await expect(
    page.getByRole("heading", { name: "What do you want to open?" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reports", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: "Reports", exact: true }).press("Space");
  await expect(page.getByRole("switch", { name: "Reports", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "Reports", exact: true }))
    .toBeEnabled({ timeout: 10000 })
    .catch((error: unknown) => {
      throw new Error(
        JSON.stringify({ requests, unexpected, errors, error: String(error) }),
      );
    });
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await page.getByRole("tab", { name: "Time Report", exact: true }).click();
  const panel = page.getByRole("region", { name: "Load Time Report", exact: true });
  await expect(panel).toBeVisible();
  const teamInput = panel.getByRole("combobox", { name: "My teams", exact: true });
  await expect(teamInput.locator("option")).toHaveText([
    "Choose a team",
    "Platform Team · TEST DATA",
    "Support Team · TEST DATA",
  ]);
  await expect(
    panel.getByRole("button", { name: "Load Time Report", exact: true }),
  ).toBeDisabled();
  await teamInput.selectOption({ label: "Platform Team · TEST DATA" });
  await expect(panel.getByLabel("Atlassian team link")).toHaveCount(0);
  await expect(panel.getByLabel("Organization ID")).toHaveCount(0);
  await panel.getByLabel("Week containing").fill("2026-10-26");
  await panel.getByLabel("Report time zone").fill("Europe/Kyiv");
  // Assert the production stylesheet actually styles the form, beyond successful CSS loading.
  expect(
    await teamInput.evaluate((input) => getComputedStyle(input).borderRadius),
  ).not.toBe("0px");
  expect(
    await teamInput.evaluate((input) => input.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(40);
  await page.screenshot({
    path: testInfo.outputPath("time-report-desktop-form.png"),
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Load Time Report", exact: true }).click();
  const table = panel.getByRole("table", { name: "Team View", exact: true });
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(
    table.locator("tbody tr").filter({ hasText: "Alex Morgan" }).locator("td").nth(7),
  ).toHaveText("3h");
  await expect(
    table.locator("tbody tr").filter({ hasText: "Jamie Lee" }).locator("td").nth(7),
  ).toHaveText("4h");
  await expect(table.locator("tfoot td").nth(7)).toHaveText("7h");
  await expect(table.locator("tfoot td").nth(8)).toHaveText("Unavailable");
  await expect(table.locator("tfoot td").nth(9)).toHaveText("Unavailable");
  await expect(
    panel.getByRole("status").filter({ hasText: "Complete Day Off data is unavailable" }),
  ).toContainText("Complete Day Off data is unavailable");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  calendar.seed(baseUrl, "fixture-author", "2026-10", ["2026-10-26"]);
  calendar.setAvailable(true);
  await panel
    .getByRole("button", { name: "Allow GitHub storage access", exact: true })
    .click();
  await expect(table.getByText("Day Off · 3h", { exact: true })).toBeVisible();
  await expect(table.locator("tfoot td").nth(8)).toHaveText("72h");
  await page.screenshot({
    path: testInfo.outputPath("time-report-desktop-team.png"),
    fullPage: true,
  });
  const searches = requests.filter(
    (req) =>
      req.path.endsWith("/search/jql") &&
      (req.body as { jql?: string })?.jql?.includes("worklogAuthor"),
  );
  expect(searches).toHaveLength(2);
  expect(
    searches.every(
      (req) =>
        /worklogAuthor\s+in/i.test((req.body as { jql: string }).jql) &&
        /worklogDate\s*>=/i.test((req.body as { jql: string }).jql) &&
        /worklogDate\s*</i.test((req.body as { jql: string }).jql),
    ),
  ).toBe(true);
  expect(
    searches.every(
      (req) => !/assignee|project\s*=|board\s*=/i.test((req.body as { jql: string }).jql),
    ),
  ).toBe(true);
  await table.getByRole("button", { name: "Alex Morgan", exact: true }).click();
  const individual = panel.getByRole("table", {
    name: "Individual View · Alex Morgan",
    exact: true,
  });
  await expect(individual.getByRole("link", { name: "ADMIN-9" })).toHaveAttribute(
    "href",
    `${baseUrl}/browse/ADMIN-9`,
  );
  await expect(individual.getByRole("link", { name: "ARCHIVE-2" })).toBeVisible();
  await expect(individual.locator("tfoot td").last()).toHaveText("3h");
  await page.screenshot({
    path: testInfo.outputPath("time-report-desktop-individual.png"),
    fullPage: true,
  });
  await panel.getByRole("tab", { name: "Team View", exact: true }).click();
  await panel.getByRole("button", { name: "Monthly", exact: true }).click();
  await expect(panel.getByRole("table")).toHaveCount(0);
  await expect(panel.getByLabel("Month", { exact: true })).toHaveValue("2026-10");
  await panel.getByRole("button", { name: "Load Time Report", exact: true }).click();
  const monthly = panel.getByRole("table", { name: "Team View", exact: true });
  await expect(monthly).toBeVisible();
  await expect(monthly.getByRole("columnheader")).toHaveCount(35);
  await expect(panel.getByText("2026-10-01 – 2026-10-31", { exact: true })).toBeVisible();
  await expect(monthly.locator("tfoot td").nth(31)).toHaveText("7h 30m");
  await expect(monthly.locator("tfoot td").nth(32)).toHaveText("344h");
  const monthlySearches = requests.filter(
    (req) =>
      req.path.endsWith("/search/jql") &&
      (req.body as { jql?: string })?.jql?.includes(
        'worklogDate >= "2026-09-29" AND worklogDate < "2026-11-03"',
      ),
  );
  expect(monthlySearches).toHaveLength(2);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: testInfo.outputPath("time-report-monthly.png"),
    fullPage: true,
  });
  await panel.getByRole("tab", { name: "Individual View", exact: true }).click();
  await expect(
    panel
      .getByRole("table", { name: "Individual View · Alex Morgan", exact: true })
      .locator("tfoot td")
      .last(),
  ).toHaveText("3h 30m");
  await panel.getByRole("tab", { name: "Team View", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(teamInput).toBeVisible();
  const inputBounds = await teamInput.boundingBox();
  expect(inputBounds!.x + inputBounds!.width).toBeLessThanOrEqual(390);
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await page.screenshot({
    path: testInfo.outputPath("time-report-mobile.png"),
    fullPage: true,
  });
  expect(
    requests.filter(
      (req) =>
        ["PUT", "DELETE", "PATCH"].includes(req.method) ||
        (req.method === "POST" &&
          !req.path.endsWith("/members") &&
          !req.path.endsWith("/search/jql") &&
          !req.path.endsWith("/graphql")),
    ),
  ).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.getByRole("button", { name: "Weekly", exact: true }).click();
  await panel.getByLabel("Week containing", { exact: true }).fill("2026-10-26");
  await panel.getByRole("button", { name: "Load Time Report", exact: true }).click();
  await page.getByRole("tab", { name: "Description changes", exact: true }).click();
  const descriptions = page.getByRole("region", { name: "Description changes report" });
  const historyCount = () =>
    requests.filter((req) => req.path.endsWith("/POWER-9/changelog")).length;
  expect(historyCount()).toBe(0);
  await descriptions.getByLabel("Report date", { exact: true }).fill("2026-11-06");
  await descriptions.getByRole("button", { name: "Preview description changes" }).click();
  await expect(
    descriptions.getByRole("link", { name: "POWER-9", exact: true }),
  ).toBeVisible();
  await expect(
    descriptions.getByRole("link", { name: "POWER-8", exact: true }),
  ).toBeVisible();
  await expect(
    descriptions.getByText("Alice Editor, Bob Editor", { exact: true }),
  ).toBeVisible();
  await expect(descriptions.getByText("— (context)", { exact: true })).toBeVisible();
  await expect(descriptions).toContainText("Changed issues: 1 · Edits: 2");
  await expect(descriptions).not.toContainText("Private old description");
  expect(historyCount()).toBe(2);
  expect(
    requests
      .filter((req) => req.path.endsWith("/POWER-9/changelog"))
      .map((req) => req.method),
  ).toEqual(["GET", "GET"]);
  await page.screenshot({
    path: testInfo.outputPath("description-report-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    descriptions.getByRole("button", { name: "Preview description changes" }),
  ).toBeVisible();
  expect(
    await descriptions
      .getByLabel("Report date", { exact: true })
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(40);
  await page.screenshot({
    path: testInfo.outputPath("description-report-mobile.png"),
    fullPage: true,
  });
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
