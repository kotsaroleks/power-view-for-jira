import { makeJiraIssueFixture } from "@power-view/test-fixtures";
import { describe, expect, it } from "vitest";

import {
  mapJiraField,
  mapJiraIssue,
  mapJiraProject,
  mapJiraServerInfo,
  mapJiraUser,
} from "./mappers";
import { rawJiraIssueSchema } from "./schemas";

describe("Jira response mappers", () => {
  it("normalizes Cloud users without requiring private email data", () => {
    expect(
      mapJiraUser({
        accountId: "account-1",
        displayName: "Mia Example",
        active: true,
        avatarUrls: { "48x48": "https://avatar.example/mia.png" },
      }),
    ).toEqual({
      accountId: "account-1",
      displayName: "Mia Example",
      avatarUrl: "https://avatar.example/mia.png",
    });
  });

  it("normalizes Data Center usernames", () => {
    expect(
      mapJiraUser({ displayName: "Fred Example", name: "fred", active: true }),
    ).toEqual({ displayName: "Fred Example", username: "fred" });
  });

  it("detects Cloud from the configured host and preserves safe server fields", () => {
    expect(
      mapJiraServerInfo(
        {
          baseUrl: "https://other.example",
          version: "1001.0.0",
          versionNumbers: [1001, 0, 0],
          buildNumber: "582",
          serverTitle: "Example Jira",
        },
        "https://example.atlassian.net",
        "unknown",
      ),
    ).toEqual({
      baseUrl: "https://example.atlassian.net",
      deploymentType: "cloud",
      version: "1001.0.0",
      versionNumbers: [1001, 0, 0],
      buildNumber: 582,
      serverTitle: "Example Jira",
    });
  });

  it("normalizes the Data Center deployment label returned by Jira", () => {
    expect(
      mapJiraServerInfo(
        {
          baseUrl: "https://jira.example.com",
          deploymentType: "Data Center",
          versionNumbers: [10, 7, 1],
        },
        "https://jira.example.com",
        "unknown",
      ).deploymentType,
    ).toBe("data-center");
  });

  it("normalizes project IDs and safe display metadata", () => {
    expect(mapJiraProject({ id: 10000, key: "POWER", name: "Power View" })).toEqual({
      id: "10000",
      key: "POWER",
      name: "Power View",
    });
  });

  it("derives custom field status when Jira omits the flag", () => {
    expect(
      mapJiraField({
        id: "customfield_10010",
        name: "Planned Start",
        schema: { type: "date" },
      }),
    ).toEqual({
      id: "customfield_10010",
      name: "Planned Start",
      custom: true,
      clauseNames: [],
      schema: { type: "date" },
    });
  });

  it("normalizes issue fields, configured dates, hierarchy, progress, and links", () => {
    const fixture = makeJiraIssueFixture(0);
    const rawIssue = rawJiraIssueSchema.parse({
      ...fixture,
      fields: {
        ...fixture.fields,
        parent: { id: "19999", key: "POWER-99" },
        customfield_10014: "POWER-100",
        issuelinks: [
          {
            id: "30001",
            type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
            outwardIssue: { id: "20002", key: "POWER-2" },
          },
        ],
      },
    });

    expect(
      mapJiraIssue(rawIssue, {
        baseUrl: "https://fixture.atlassian.net/",
        fieldMapping: {
          startDateFieldId: "customfield_10010",
          hierarchyFieldId: "customfield_10014",
        },
      }),
    ).toMatchObject({
      id: "20001",
      key: "POWER-1",
      browseUrl: "https://fixture.atlassian.net/browse/POWER-1",
      summary: "Sanitized planning issue 1",
      startDate: "2026-02-01",
      dueDate: "2026-02-10",
      parentKey: "POWER-99",
      epicKey: "POWER-100",
      progress: { percentage: 0, source: "status" },
      issueLinks: [
        {
          direction: "outward",
          linkedIssueKey: "POWER-2",
          semanticType: "blocks",
        },
      ],
      rawFieldPresence: {
        hasStartDate: true,
        hasDueDate: true,
        hasParent: true,
        hasEpic: true,
      },
    });
  });
});
