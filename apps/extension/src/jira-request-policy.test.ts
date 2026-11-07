import { describe, expect, it } from "vitest";
import {
  POWER_VIEW_TEAM_CONTEXT_QUERY,
  POWER_VIEW_MY_TEAMS_QUERY,
} from "@power-view/extension-messaging";

import {
  sanitizedJiraRequestHeaders,
  isJiraReadRequest,
  validatedJiraRequestUrl,
} from "./jira-request-policy";

const request = {
  baseUrl: "https://example.atlassian.net",
  method: "GET" as const,
  path: "/rest/api/3/myself",
};

describe("Teams read boundary", () => {
  it("allows only the two fixed GraphQL discovery queries, never arbitrary queries or mutations", () => {
    const tenant = {
      ...request,
      method: "POST" as const,
      path: "/gateway/api/graphql",
      body: {
        operationName: "PowerViewTenantContext",
        query: POWER_VIEW_TEAM_CONTEXT_QUERY,
        variables: { hostNames: ["example.atlassian.net"] },
      },
    };
    const mine = {
      ...tenant,
      body: {
        operationName: "PowerViewMyTeams",
        query: POWER_VIEW_MY_TEAMS_QUERY,
        variables: {
          organizationId: "ari:cloud:platform::org/fixture-org",
          siteId: "11111111-2222-3333-4444-555555555555",
          memberId: "me",
          after: null,
        },
      },
    };
    for (const valid of [tenant, mine]) {
      expect(validatedJiraRequestUrl(valid, request.baseUrl, false).pathname).toBe(
        "/gateway/api/graphql",
      );
      expect(isJiraReadRequest(valid)).toBe(true);
    }
    for (const bad of [
      { ...tenant, body: { ...tenant.body, query: "mutation { createTeam { id } }" } },
      {
        ...tenant,
        body: { ...tenant.body, variables: { hostNames: ["other.atlassian.net"] } },
      },
      {
        ...mine,
        body: { ...mine.body, variables: { ...mine.body.variables, memberId: "" } },
      },
      {
        ...mine,
        body: { ...mine.body, variables: { ...mine.body.variables, first: 1000 } },
      },
      {
        ...mine,
        body: {
          ...mine.body,
          query: `${POWER_VIEW_MY_TEAMS_QUERY} query Extra { me { name } }`,
        },
      },
      { ...mine, query: { query: "anything" } },
    ]) {
      expect(() => validatedJiraRequestUrl(bad, request.baseUrl, false)).toThrow();
      if (!("query" in bad)) expect(isJiraReadRequest(bad)).toBe(false);
    }
  });
  const path =
    "/gateway/api/public/teams/v1/org/org-123/teams/57c307db-71ea-47d7-8899-ce00b8fc62dd";
  it("allows selected team and paginated member reads without allowing membership writes", () => {
    expect(
      validatedJiraRequestUrl({ ...request, path }, request.baseUrl, false).pathname,
    ).toBe(path);
    const members = {
      ...request,
      method: "POST" as const,
      path: `${path}/members`,
      body: { first: 100, after: "cursor" },
    };
    expect(validatedJiraRequestUrl(members, request.baseUrl, false).pathname).toBe(
      `${path}/members`,
    );
    expect(isJiraReadRequest(members)).toBe(true);
    for (const bad of [
      { ...members, path: `${path}/members/add` },
      { ...members, body: { first: 101 } },
      { ...members, body: { first: 100, members: [{ accountId: "someone" }] } },
      { ...members, query: { redirect: "elsewhere" } },
      { ...members, method: "DELETE" as const },
    ])
      expect(() => validatedJiraRequestUrl(bad, request.baseUrl, false)).toThrow();
    expect(
      validatedJiraRequestUrl(
        { ...request, path: "/rest/api/3/user", query: { accountId: "person" } },
        request.baseUrl,
        false,
      ).searchParams.get("accountId"),
    ).toBe("person");
    expect(() =>
      validatedJiraRequestUrl(
        { ...request, path: "/rest/api/3/user" },
        request.baseUrl,
        false,
      ),
    ).toThrow();
  });
});

describe("Jira request policy", () => {
  it("allows only the exact report ancestor metadata fields for a key or numeric ID", () => {
    for (const version of [2, 3])
      for (const reference of ["POWER-42", "10042"]) {
        const read = {
          ...request,
          path: `/rest/api/${version}/issue/${reference}`,
          query: { fields: "summary,parent,issuetype,updated" },
        };
        expect(() => validatedJiraRequestUrl(read, request.baseUrl, false)).not.toThrow();
        for (const fields of [
          "*all",
          "description",
          "summary,parent,description,updated",
          "",
        ])
          expect(() =>
            validatedJiraRequestUrl(
              { ...read, query: { fields } },
              request.baseUrl,
              false,
            ),
          ).toThrow();
        expect(() =>
          validatedJiraRequestUrl(
            { ...read, query: { ...read.query, expand: "changelog" } },
            request.baseUrl,
            false,
          ),
        ).toThrow();
      }
  });
  it("builds only an allowlisted same-instance URL", () => {
    expect(
      validatedJiraRequestUrl(
        {
          ...request,
          path: "/rest/api/3/project/search",
          query: { query: "power", startAt: 0, maxResults: 25 },
        },
        request.baseUrl,
        false,
      ).href,
    ).toBe(
      "https://example.atlassian.net/rest/api/3/project/search?query=power&startAt=0&maxResults=25",
    );
  });

  it("rejects alternate Jira origins and unknown query parameters", () => {
    expect(() =>
      validatedJiraRequestUrl(request, "https://other.atlassian.net", false),
    ).toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        { ...request, query: { redirect: "https://evil.example" } },
        request.baseUrl,
        false,
      ),
    ).toThrow();
  });

  it("forwards only the Accept header", () => {
    expect(
      sanitizedJiraRequestHeaders({
        ...request,
        headers: {
          Accept: "application/json",
          Authorization: "Bearer secret",
          Cookie: "session=secret",
        },
      }),
    ).toEqual({ Accept: "application/json" });
  });

  it("allows only the approved mutation shapes", () => {
    const dateUpdate = {
      ...request,
      method: "PUT" as const,
      path: "/rest/api/3/issue/POWER-42",
      body: {
        fields: {
          customfield_10010: "2026-08-01",
          duedate: "2026-08-10",
        },
      },
    };

    expect(validatedJiraRequestUrl(dateUpdate, request.baseUrl, false).href).toBe(
      "https://example.atlassian.net/rest/api/3/issue/POWER-42",
    );
    expect(sanitizedJiraRequestHeaders(dateUpdate)).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Atlassian-Token": "no-check",
    });
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...dateUpdate,
          body: { fields: { summary: "unsafe write" } },
        },
        request.baseUrl,
        false,
      ),
    ).toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...dateUpdate,
          path: "/rest/api/3/issue/POWER-42",
          body: { fields: { duedate: "not-a-date" } },
        },
        request.baseUrl,
        false,
      ),
    ).toThrow();
  });

  it("allows assignee and issue-link mutations but rejects extra body fields", () => {
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...request,
          method: "PUT",
          path: "/rest/api/3/issue/POWER-42/assignee",
          body: { accountId: "abc123" },
        },
        request.baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...request,
          method: "POST",
          path: "/rest/api/3/issueLink",
          body: {
            type: { name: "Blocks" },
            inwardIssue: { key: "POWER-42" },
            outwardIssue: { key: "POWER-1" },
          },
        },
        request.baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...request,
          method: "POST",
          path: "/rest/api/3/issueLink",
          body: {
            type: { name: "Blocks" },
            inwardIssue: { key: "POWER-42" },
            outwardIssue: { key: "POWER-1" },
            comment: { body: "not allowlisted" },
          },
        },
        request.baseUrl,
        false,
      ),
    ).toThrow();
  });

  it("allows issue-scoped workflow reads and strict status transitions", () => {
    const transitionsPath = "/rest/api/3/issue/POWER-42/transitions";
    expect(() =>
      validatedJiraRequestUrl(
        { ...request, path: transitionsPath },
        request.baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...request,
          method: "POST",
          path: transitionsPath,
          body: { transition: { id: "31" } },
        },
        request.baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...request,
          method: "POST",
          path: transitionsPath,
          body: { transition: { id: "31" }, fields: { summary: "unsafe" } },
        },
        request.baseUrl,
        false,
      ),
    ).toThrow();
  });

  it("allows read-only reporting endpoints and strict bulk changelog reads", () => {
    expect(() =>
      validatedJiraRequestUrl(
        { ...request, path: "/rest/api/3/status" },
        request.baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        { ...request, path: "/rest/api/3/project/POWER/statuses" },
        request.baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        { ...request, path: "/rest/agile/1.0/board/7/configuration" },
        request.baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...request,
          path: "/rest/agile/1.0/board/7/issue",
          query: { maxResults: 100, startAt: 0 },
        },
        request.baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...request,
          method: "POST",
          path: "/rest/api/3/changelog/bulkfetch",
          body: { issueIdsOrKeys: ["10001"], fieldIds: ["status"], maxResults: 1000 },
        },
        request.baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...request,
          method: "POST",
          path: "/rest/api/3/changelog/bulkfetch",
          body: {
            issueIdsOrKeys: ["10001"],
            fieldIds: ["status"],
            maxResults: 1000,
            jql: "project = POWER",
          },
        },
        request.baseUrl,
        false,
      ),
    ).toThrow();
    // fieldIds is optional in the Atlassian schema, so a body without it must pass.
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...request,
          method: "POST",
          path: "/rest/api/3/changelog/bulkfetch",
          body: { issueIdsOrKeys: ["10001"], maxResults: 1000 },
        },
        request.baseUrl,
        false,
      ),
    ).not.toThrow();
  });

  it("still rejects a bulk changelog body whose fieldIds is present but invalid", () => {
    const invalidFieldIds: unknown[] = [
      "status",
      null,
      [""],
      ["a".repeat(513)],
      [1],
      Array.from({ length: 11 }, () => "status"),
    ];

    for (const fieldIds of invalidFieldIds) {
      expect(() =>
        validatedJiraRequestUrl(
          {
            ...request,
            method: "POST",
            path: "/rest/api/3/changelog/bulkfetch",
            body: { issueIdsOrKeys: ["10001"], fieldIds, maxResults: 1000 },
          },
          request.baseUrl,
          false,
        ),
      ).toThrow();
    }
  });
});

describe("priority production policy", () => {
  it.each(["2", "3"])(
    "allows API %s priorities and a combined date/priority update",
    (version) => {
      expect(() =>
        validatedJiraRequestUrl(
          { ...request, path: `/rest/api/${version}/priority` },
          request.baseUrl,
          false,
        ),
      ).not.toThrow();
      for (const fields of [
        { priority: { id: "1" } },
        { priority: { id: "1" }, duedate: "2026-10-14", customfield_10010: "2026-10-12" },
      ]) {
        expect(() =>
          validatedJiraRequestUrl(
            {
              ...request,
              method: "PUT",
              path: `/rest/api/${version}/issue/POWER-42`,
              body: { fields },
            },
            request.baseUrl,
            false,
          ),
        ).not.toThrow();
      }
    },
  );
  it.each([null, { id: "" }, { id: 1 }, { id: "1", name: "High" }, { id: "../1" }])(
    "rejects invalid priority %j",
    (priority) => {
      expect(() =>
        validatedJiraRequestUrl(
          {
            ...request,
            method: "PUT",
            path: "/rest/api/3/issue/POWER-42",
            body: { fields: { priority } },
          },
          request.baseUrl,
          false,
        ),
      ).toThrow();
    },
  );
});

describe("Timesheet exact policies", () => {
  const baseUrl = "https://example.atlassian.net";
  const body = { started: "2026-10-29T09:00:00.000+0200", timeSpentSeconds: 5400 };
  const write = {
    baseUrl,
    method: "POST" as const,
    path: "/rest/api/3/issue/PV-1/worklog",
    query: { adjustEstimate: "leave" },
    body,
  };
  it("allows the declared CRUD operations with estimate unchanged", () => {
    expect(validatedJiraRequestUrl(write, baseUrl, false).search).toBe(
      "?adjustEstimate=leave",
    );
    expect(() =>
      validatedJiraRequestUrl(
        { ...write, method: "PUT", path: `${write.path}/10` },
        baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        { baseUrl, method: "DELETE", path: `${write.path}/10`, query: write.query },
        baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        { baseUrl, method: "GET", path: `${write.path}/10` },
        baseUrl,
        false,
      ),
    ).not.toThrow();
  });
  it("rejects alternate authors, estimate changes, v2 mutations, unknown fields and malformed IDs", () => {
    for (const request of [
      { ...write, body: { ...body, author: { accountId: "other" } } },
      { ...write, body: { ...body, visibility: { type: "group", value: "private" } } },
      { ...write, query: { adjustEstimate: "auto" } },
      { ...write, query: {} },
      { ...write, path: write.path.replace("/3/", "/2/") },
      { ...write, body: { ...body, timeSpentSeconds: 0 } },
      { ...write, body: { ...body, timeSpentSeconds: 1.5 } },
      { ...write, body: { ...body, started: "not-a-date" } },
      { ...write, body: { ...body, started: "2026-02-30T09:00:00+0200" } },
      { ...write, body: { ...body, started: "2026-10-29T24:00:00Z" } },
      { ...write, method: "DELETE" as const, path: `${write.path}/abc`, body: undefined },
    ])
      expect(() => validatedJiraRequestUrl(request, baseUrl, false)).toThrow();
    expect(() =>
      validatedJiraRequestUrl(write, "https://other.atlassian.net", false),
    ).toThrow();
  });
  it("accepts only plain ADF descriptions and bounded minimal POST search", () => {
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...write,
          body: {
            ...body,
            comment: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: "Work" }] }],
            },
          },
        },
        baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        { ...write, body: { ...body, comment: "<script>" } },
        baseUrl,
        false,
      ),
    ).toThrow();
    const search = {
      baseUrl,
      method: "POST" as const,
      path: "/rest/api/3/search/jql",
      body: {
        jql: "worklogAuthor = currentUser()",
        fields: ["summary", "project"],
        maxResults: 100,
      },
    };
    expect(() => validatedJiraRequestUrl(search, baseUrl, false)).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...search,
          body: {
            ...search.body,
            fields: ["summary", "project", "issuetype", "assignee", "parent"],
          },
        },
        baseUrl,
        false,
      ),
    ).not.toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        {
          ...search,
          body: {
            ...search.body,
            fields: [
              "summary",
              "project",
              "issuetype",
              "assignee",
              "parent",
              "description",
            ],
          },
        },
        baseUrl,
        false,
      ),
    ).toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        { ...search, body: { ...search.body, fields: ["*all"] } },
        baseUrl,
        false,
      ),
    ).toThrow();
    expect(() =>
      validatedJiraRequestUrl(
        { ...search, body: { ...search.body, expand: "changelog" } },
        baseUrl,
        false,
      ),
    ).toThrow();
  });
});
