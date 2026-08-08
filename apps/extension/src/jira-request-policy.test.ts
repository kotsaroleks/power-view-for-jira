import { describe, expect, it } from "vitest";

import {
  sanitizedJiraRequestHeaders,
  validatedJiraRequestUrl,
} from "./jira-request-policy";

const request = {
  baseUrl: "https://example.atlassian.net",
  method: "GET" as const,
  path: "/rest/api/3/myself",
};

describe("Jira request policy", () => {
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
