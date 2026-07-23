import { describe, expect, it } from "vitest";

import {
  extensionRequestSchema,
  extensionResponseSchema,
  jiraPageContextSchema,
} from "./schemas";

const context = {
  baseUrl: "https://example.atlassian.net",
  pageUrl: "https://example.atlassian.net/browse/POWER-42",
  detectedAt: "2026-07-22T12:00:00.000Z",
  deploymentType: "cloud",
  projectKey: "POWER",
  issueKey: "POWER-42",
  detectionSources: ["url"],
} as const;

describe("extension message schemas", () => {
  it("accepts a strict context update", () => {
    expect(
      extensionRequestSchema.safeParse({
        type: "CONTEXT_UPDATE",
        requestId: "38bd0c46-0316-4eca-9c4b-a18d270a7f31",
        context,
      }).success,
    ).toBe(true);
  });

  it("rejects unknown message types and extra properties", () => {
    expect(extensionRequestSchema.safeParse({ type: "DELETE_ALL" }).success).toBe(false);
    expect(
      extensionRequestSchema.safeParse({
        type: "CONTEXT_GET",
        requestId: "38bd0c46-0316-4eca-9c4b-a18d270a7f31",
        unsafe: true,
      }).success,
    ).toBe(false);
  });

  it("rejects malformed contexts and responses", () => {
    expect(
      jiraPageContextSchema.safeParse({ ...context, pageUrl: "not-a-url" }).success,
    ).toBe(false);
    expect(
      extensionResponseSchema.safeParse({
        type: "CONTEXT_RESULT",
        requestId: "38bd0c46-0316-4eca-9c4b-a18d270a7f31",
        ok: true,
        context: { ...context, unexpected: "field" },
      }).success,
    ).toBe(false);
  });
});
