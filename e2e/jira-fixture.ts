import type { BrowserContext } from "@playwright/test";
import {
  jiraCloudCurrentUserFixture,
  jiraCloudProjectsFixture,
  jiraCloudServerInfoFixture,
  jiraFieldsFixture,
  makeJiraIssueFixtures,
} from "../packages/test-fixtures/src/index";

export async function installJiraFixture(context: BrowserContext) {
  const today = new Date().toISOString().slice(0, 10);
  const issues = makeJiraIssueFixtures(3);
  for (const issue of issues) {
    issue.fields.customfield_10010 = today;
    issue.fields.duedate = today;
  }
  const board = {
    id: 7,
    name: "Power Delivery Board",
    type: "scrum",
    location: { projectKey: "POWER" },
  };
  const statuses = [
    { id: "1", name: "To Do" },
    { id: "3", name: "Done" },
  ];
  const writes: { method: string; path: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  await context.route("https://fixture.atlassian.net/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const issueKey = path.match(/\/issue\/(POWER-\d+)/)?.[1];
    const issue = issues.find((value) => value.key === issueKey);
    if (issue && (method === "PUT" || method === "POST")) {
      const body = request.postDataJSON() as {
        transition?: { id: string };
        accountId?: string;
        fields?: Record<string, unknown>;
      };
      if (path.endsWith("/transitions") && body.transition?.id === "31") {
        issue.fields.status = { id: "3", name: "Done", statusCategory: { key: "done" } };
      } else if (path.endsWith("/assignee") && body.accountId === "fixture-new-user") {
        issue.fields.assignee = {
          accountId: "fixture-new-user",
          displayName: "Fixture New User",
        };
      } else if (path.endsWith(`/issue/${issueKey}`) && body.fields) {
        Object.assign(issue.fields, body.fields);
      } else {
        unexpected.push(`${method} ${path}`);
        await route.fulfill({
          status: 400,
          json: { errorMessages: ["Unexpected fixture mutation"] },
        });
        return;
      }
      writes.push({ method, path, body });
      await route.fulfill({ status: 204 });
      return;
    }
    let json: unknown;
    if (path.endsWith("/serverInfo")) json = jiraCloudServerInfoFixture;
    else if (path.endsWith("/myself")) json = jiraCloudCurrentUserFixture;
    else if (path.endsWith("/project/search")) json = jiraCloudProjectsFixture;
    else if (path.endsWith("/field")) json = jiraFieldsFixture;
    else if (path === "/rest/agile/1.0/board")
      json = { values: [board], startAt: 0, maxResults: 50, total: 1, isLast: true };
    else if (path.endsWith("/board/7/configuration"))
      json = {
        id: 7,
        name: board.name,
        filter: { id: 9001 },
        columnConfig: {
          columns: [{ statuses: [{ id: "1" }] }, { statuses: [{ id: "3" }] }],
        },
      };
    else if (path.endsWith("/board/7")) json = board;
    else if (path.endsWith("/board/7/issue"))
      json = { issues, startAt: 0, maxResults: 100, total: issues.length };
    else if (path.endsWith("/search/jql")) json = { issues, isLast: true };
    else if (path.endsWith("/project/POWER/statuses"))
      json = [{ id: "10000", name: "Task", statuses }];
    else if (path.endsWith("/status")) json = statuses;
    else if (path.endsWith("/board/7/sprint"))
      json = { values: [], startAt: 0, maxResults: 50, total: 0, isLast: true };
    else if (path.endsWith("/transitions"))
      json = { transitions: [{ id: "31", name: "Complete", to: { name: "Done" } }] };
    else if (path.endsWith("/user/assignable/search"))
      json = [
        { accountId: "fixture-new-user", displayName: "Fixture New User", active: true },
      ];
    else if (path.endsWith("/editmeta"))
      json = {
        fields: {
          customfield_10010: {
            name: "Planned Start",
            required: false,
            operations: ["set"],
            schema: { type: "date" },
          },
          duedate: {
            name: "Due date",
            required: false,
            operations: ["set"],
            schema: { type: "date" },
          },
        },
      };
    else if (path.endsWith("/changelog/bulkfetch"))
      json = { issueChangeLogs: [], nextPageToken: null };
    else if (path.endsWith("/changelog"))
      json = { values: [], startAt: 0, maxResults: 100, total: 0, isLast: true };
    else if (path.endsWith("/worklog"))
      json = { worklogs: [], startAt: 0, maxResults: 100, total: 0 };
    else if (path === "/browse/POWER-1") {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><head><meta name="ajs-base-url" content="https://fixture.atlassian.net"><meta name="ajs-project-key" content="POWER"><meta name="ajs-issue-key" content="POWER-1"></head><body><h1>Fixture Jira issue</h1></body></html>`,
      });
      return;
    } else {
      unexpected.push(`${method} ${path}`);
      await route.fulfill({
        status: 404,
        json: { errorMessages: ["Fixture endpoint not implemented"] },
      });
      return;
    }
    await route.fulfill({ status: 200, json });
  });
  return { issues, writes, unexpected };
}
