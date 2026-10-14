import { createJiraClient, type JiraTransport } from "@power-view/jira-client";
import { describe, expect, it } from "vitest";
import { validatedJiraRequestUrl } from "../../../../extension/src/jira-request-policy";

describe("Jira client priorities through production policy", () => {
  it.each(["cloud", "data-center"] as const)(
    "loads and saves priorities for %s",
    async (deploymentType) => {
      const baseUrl = "https://jira.example.com";
      const transport: JiraTransport = {
        request(request, schema) {
          validatedJiraRequestUrl(request, baseUrl, false);
          return Promise.resolve(
            schema.parse(request.method === "GET" ? [{ id: "1", name: "High" }] : null),
          );
        },
      };
      const client = createJiraClient(transport, { baseUrl, deploymentType });
      const priorities = await client.getPriorities();
      expect(priorities).toEqual([{ id: "1", name: "High" }]);
      await expect(
        client.updateIssueFields("POWER-42", { priority: { id: priorities[0]!.id } }),
      ).resolves.toBeUndefined();
    },
  );
});
