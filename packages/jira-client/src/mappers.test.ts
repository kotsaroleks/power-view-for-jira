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
        parent: {
          id: "19999",
          key: "POWER-99",
          fields: {
            summary: "Release epic",
            issuetype: {
              id: "10001",
              name: "Epic",
              subtask: false,
              hierarchyLevel: 1,
            },
            status: {
              id: "1",
              name: "To Do",
              statusCategory: { key: "new" },
            },
          },
        },
        customfield_10014: "POWER-100",
        timeoriginalestimate: 144_000,
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
      parentReference: {
        id: "19999",
        key: "POWER-99",
        summary: "Release epic",
        issueType: {
          id: "10001",
          name: "Epic",
          subtask: false,
          hierarchyLevel: 1,
        },
        status: { id: "1", name: "To Do", category: "to-do" },
      },
      progress: { percentage: 0, source: "status" },
      originalEstimateSeconds: 144_000,
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

  it("normalizes Sprint values from Cloud and legacy Data Center shapes", () => {
    const fixture = makeJiraIssueFixture(0);
    const rawIssue = rawJiraIssueSchema.parse({
      ...fixture,
      fields: {
        ...fixture.fields,
        customfield_10020: [
          {
            id: 101,
            name: "Sprint 8.1",
            state: "ACTIVE",
            boardId: 7,
            startDate: "2026-08-01T00:00:00.000Z",
          },
          "com.atlassian.greenhopper.service.sprint.Sprint@1[id=102,rapidViewId=7,state=FUTURE,name=Sprint 8.2]",
        ],
        customfield_10016: 5,
      },
    });

    expect(
      mapJiraIssue(rawIssue, {
        baseUrl: "https://fixture.atlassian.net/",
        fieldMapping: {
          sprintFieldId: "customfield_10020",
          storyPointsFieldId: "customfield_10016",
        },
      }),
    ).toMatchObject({
      storyPoints: 5,
      sprints: [
        { id: "101", name: "Sprint 8.1", state: "active", boardId: "7" },
        { id: "102", name: "Sprint 8.2", state: "future", boardId: "7" },
      ],
    });
  });

  it("keeps an unset Story Points field unestimated", () => {
    const fixture = makeJiraIssueFixture(0);
    const rawIssue = rawJiraIssueSchema.parse({
      ...fixture,
      fields: {
        ...fixture.fields,
        customfield_10016: null,
      },
    });

    expect(
      mapJiraIssue(rawIssue, {
        baseUrl: "https://fixture.atlassian.net/",
        fieldMapping: { storyPointsFieldId: "customfield_10016" },
      }).storyPoints,
    ).toBeUndefined();
  });

  function semanticTypeOf(type: { name: string; inward: string; outward: string }) {
    const fixture = makeJiraIssueFixture(0);
    const rawIssue = rawJiraIssueSchema.parse({
      ...fixture,
      fields: {
        ...fixture.fields,
        issuelinks: [
          { id: "30001", type, outwardIssue: { id: "20002", key: "POWER-2" } },
        ],
      },
    });
    return mapJiraIssue(rawIssue, { baseUrl: "https://fixture.atlassian.net/" })
      .issueLinks[0]?.semanticType;
  }

  it.each([
    [
      "finish-finish [GANTT]",
      "has to be finished together with",
      "has to be finished together with",
    ],
    [
      "Gantt: finish-finish",
      "has to be finished together with",
      "has to be finished together with",
    ],
  ] as const)("maps %s to finish-to-finish", (name, inward, outward) => {
    expect(semanticTypeOf({ name, inward, outward })).toBe("finish-to-finish");
  });

  it.each([
    ["Blocks", "is blocked by", "blocks"],
    ["finish-start [GANTT]", "has to be done after", "has to be done before"],
    ["Gantt: finish-start", "has to be done after", "has to be done before"],
  ] as const)(
    "maps %s to blocks (finish-to-start), not finish-to-finish",
    (name, inward, outward) => {
      expect(semanticTypeOf({ name, inward, outward })).toBe("blocks");
    },
  );

  it.each([
    ["Gantt: start-finish", "start is earliest end of", "earliest end is start of"],
    [
      "Gantt: start-start",
      "has to be started together with",
      "has to be started together with",
    ],
  ] as const)(
    "leaves out-of-scope %s as unknown (only FS and FF are supported kinds)",
    (name, inward, outward) => {
      expect(semanticTypeOf({ name, inward, outward })).toBe("unknown");
    },
  );
});
