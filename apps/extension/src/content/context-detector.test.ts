import { describe, expect, it } from "vitest";

import { detectJiraContext } from "./context-detector";

const detectedAt = new Date("2026-07-22T12:00:00.000Z");

describe("detectJiraContext", () => {
  it("detects Cloud issue and project context from a browse URL", () => {
    expect(
      detectJiraContext(
        {
          pageUrl: "https://example.atlassian.net/browse/power-42",
          metadata: {},
        },
        detectedAt,
      ),
    ).toEqual({
      baseUrl: "https://example.atlassian.net",
      pageUrl: "https://example.atlassian.net/browse/power-42",
      detectedAt: "2026-07-22T12:00:00.000Z",
      deploymentType: "cloud",
      projectKey: "POWER",
      issueKey: "POWER-42",
      detectionSources: ["url"],
    });
  });

  it("detects board, sprint, filter, and JQL from stable URL values", () => {
    const context = detectJiraContext(
      {
        pageUrl:
          "https://example.atlassian.net/jira/software/c/projects/POWER/boards/17?" +
          "sprint=8&filter=10010&jql=project%20%3D%20POWER",
        metadata: {},
      },
      detectedAt,
    );

    expect(context).toMatchObject({
      projectKey: "POWER",
      boardId: "17",
      sprintId: "8",
      filterId: "10010",
      jql: "project = POWER",
    });
  });

  it("uses same-origin Jira metadata for Data Center base paths", () => {
    const context = detectJiraContext(
      {
        pageUrl: "https://jira.example.com/jira/secure/RapidBoard.jspa?rapidView=12",
        metadata: {
          "ajs-base-url": "https://jira.example.com/jira",
          "ajs-project-key": "OPS",
          "ajs-project-id": "10100",
          "ajs-deployment-type": "data-center",
          "ajs-version-number": "10.3.1",
        },
      },
      detectedAt,
    );

    expect(context).toMatchObject({
      baseUrl: "https://jira.example.com/jira",
      projectKey: "OPS",
      projectId: "10100",
      boardId: "12",
      deploymentType: "data-center",
      detectionSources: ["url", "meta"],
    });
  });

  it("rejects unrelated pages and cross-origin metadata", () => {
    expect(
      detectJiraContext(
        { pageUrl: "https://example.com/docs", metadata: {} },
        detectedAt,
      ),
    ).toBeUndefined();
    expect(
      detectJiraContext(
        {
          pageUrl: "https://example.com/docs",
          metadata: { "ajs-base-url": "https://evil.example/jira" },
        },
        detectedAt,
      ),
    ).toBeUndefined();
  });
});
