import type { JiraTransportRequest } from "@power-view/extension-messaging";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { CloudTeamsClient } from "./CloudTeamsClient";
import type { JiraTransport } from "./JiraTransport";
import { JiraClientError } from "./errors";
import { WorklogIdentityError } from "./TimesheetClient";
import {
  POWER_VIEW_MY_TEAMS_QUERY,
  POWER_VIEW_TEAM_CONTEXT_QUERY,
} from "@power-view/extension-messaging";

const orgId = "fixture-org-opaque-id";
const teamId = "12121212-3434-5656-7878-909090909090";
const baseUrl = "https://example.atlassian.net";
const team = { organizationId: orgId, teamId, displayName: "Platform", state: "ACTIVE" };
const page = (ids: string[], next: string | null = null) => ({
  results: ids.map((accountId) => ({ accountId })),
  pageInfo: { hasNextPage: Boolean(next), endCursor: next },
});

describe("Automatic My teams discovery", () => {
  const siteId = "12121212-3434-5656-7878-909090909091";
  const nextTeamId = "12121212-3434-5656-7878-909090909092";
  const tenant = {
    data: {
      tenantContexts: [{ cloudId: siteId, orgId, hostName: "example.atlassian.net" }],
    },
  };
  const result = (id = teamId, name = "Platform", next: string | null = null) => ({
    data: {
      team: {
        teamSearchV2: {
          nodes: [
            {
              team: {
                id: `ari:cloud:identity::team/${id}`,
                displayName: name,
                organizationId: `ari:cloud:platform::org/${orgId}`,
              },
            },
          ],
          pageInfo: { hasNextPage: Boolean(next), endCursor: next },
        },
      },
    },
  });
  function discoveryFixture(override?: (req: JiraTransportRequest) => unknown) {
    return fixture((req) => {
      if (req.path.endsWith("/myself")) return { accountId: "me" };
      if (
        (req.body as { operationName?: string })?.operationName ===
        "PowerViewTenantContext"
      )
        return tenant;
      return override ? override(req) : result();
    });
  }

  it("discovers site context automatically and paginates only the expected user's memberships", async () => {
    const { client, request } = discoveryFixture((req) =>
      (req.body as { variables?: { after?: string } }).variables?.after
        ? result(nextTeamId, "Other")
        : result(teamId, "Platform", "next"),
    );
    expect(await client.listMyTeams("me")).toEqual([
      { id: nextTeamId, name: "Other", organizationId: orgId },
      { id: teamId, name: "Platform", organizationId: orgId },
    ]);
    expect(request.mock.calls[1]?.[0]).toEqual({
      baseUrl,
      method: "POST",
      path: "/gateway/api/graphql",
      body: {
        operationName: "PowerViewTenantContext",
        query: POWER_VIEW_TEAM_CONTEXT_QUERY,
        variables: { hostNames: ["example.atlassian.net"] },
      },
    });
    expect(request.mock.calls[2]?.[0].body).toEqual({
      operationName: "PowerViewMyTeams",
      query: POWER_VIEW_MY_TEAMS_QUERY,
      variables: {
        organizationId: `ari:cloud:platform::org/${orgId}`,
        siteId,
        memberId: "me",
        after: null,
      },
    });
    expect(
      (request.mock.calls[3]?.[0].body as { variables: { after: string } }).variables
        .after,
    ).toBe("next");
    expect(request.mock.calls.at(-1)?.[0].path).toBe("/rest/api/3/myself");
  });

  it("rejects GraphQL errors even when plausible partial data is present", async () => {
    const { client } = discoveryFixture(() => ({
      ...result(),
      errors: [{ message: "Forbidden membership search" }],
    }));
    await expect(client.listMyTeams("me")).rejects.toThrow("Forbidden membership search");
  });

  it("rejects missing and mismatched tenant discovery rather than guessing organization IDs", async () => {
    for (const tenantContexts of [
      [],
      [{ ...tenant.data.tenantContexts[0], hostName: "other.atlassian.net" }],
    ]) {
      const { client } = fixture((req) =>
        req.path.endsWith("/myself") ? { accountId: "me" } : { data: { tenantContexts } },
      );
      await expect(client.listMyTeams("me")).rejects.toThrow("unambiguous organization");
    }
  });

  it("rejects repeated pagination cursors and null teams", async () => {
    const repeated = discoveryFixture(() => result(teamId, "Platform", "same"));
    await expect(repeated.client.listMyTeams("me")).rejects.toThrow(
      "pagination was incomplete",
    );
    const missing = discoveryFixture(() => ({
      data: {
        team: {
          teamSearchV2: {
            nodes: [{ team: null }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }));
    await expect(missing.client.listMyTeams("me")).rejects.toThrow(
      "incomplete team search",
    );
  });

  it("returns an empty membership list without substituting other visible teams", async () => {
    const { client } = discoveryFixture(() => ({
      data: {
        team: {
          teamSearchV2: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }));
    expect(await client.listMyTeams("me")).toEqual([]);
  });

  it("checks identity before discovery and before returning the list", async () => {
    const before = fixture(() => ({ accountId: "other" }));
    await expect(before.client.listMyTeams("me")).rejects.toBeInstanceOf(
      WorklogIdentityError,
    );
    expect(before.request).toHaveBeenCalledTimes(1);
    let identities = 0;
    const after = fixture((req) => {
      if (req.path.endsWith("/myself"))
        return { accountId: ++identities === 1 ? "me" : "other" };
      return (req.body as { operationName?: string })?.operationName ===
        "PowerViewTenantContext"
        ? tenant
        : result();
    });
    await expect(after.client.listMyTeams("me")).rejects.toBeInstanceOf(
      WorklogIdentityError,
    );
  });

  it("honors cancellation and rejects teams outside the discovered organization", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, request } = discoveryFixture();
    await expect(client.listMyTeams("me", controller.signal)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    const otherOrg = discoveryFixture(() => {
      const response = result();
      response.data.team.teamSearchV2.nodes[0]!.team.organizationId =
        "ari:cloud:platform::org/other";
      return response;
    });
    await expect(otherOrg.client.listMyTeams("me")).rejects.toThrow(
      "different organization",
    );
  });
});

function fixture(
  handler: (request: JiraTransportRequest) => unknown = (req) => {
    if (req.path.endsWith("/members")) return page(["member-1"]);
    if (req.path === "/rest/api/3/user")
      return { accountId: req.query?.accountId, displayName: "Alex" };
    return team;
  },
) {
  const request = vi.fn(async <T>(req: JiraTransportRequest, schema: z.ZodType<T>) =>
    schema.parse(await handler(req)),
  );
  return {
    request,
    client: new CloudTeamsClient(
      { request: request as JiraTransport["request"] },
      baseUrl,
    ),
  };
}

describe("Cloud Teams read-only client", () => {
  it("uses selected organization/team and drains member cursors without inferring roster from issues", async () => {
    const { client, request } = fixture((req) => {
      if (req.path.endsWith("/members"))
        return req.body && "after" in req.body
          ? page(["member-2"])
          : page(["member-1"], "next");
      if (req.path === "/rest/api/3/user")
        return {
          accountId: req.query?.accountId,
          displayName: `Name ${req.query?.accountId}`,
        };
      return team;
    });
    const result = await client.loadTeam(orgId, teamId);
    expect(result.id).toBe(teamId);
    expect(result.name).toBe("Platform");
    expect(result.members.map((member) => member.accountId)).toEqual([
      "member-1",
      "member-2",
    ]);
    expect(result.warnings).toEqual([]);
    const members = request.mock.calls.filter(([req]) => req.path.endsWith("/members"));
    expect(members.map(([req]) => req.body)).toEqual([
      { first: 50 },
      { first: 50, after: "next" },
    ]);
    expect(members[0]?.[0]).toMatchObject({
      baseUrl,
      method: "POST",
      path: `/gateway/api/public/teams/v1/org/${orgId}/teams/${teamId}/members`,
    });
    expect(
      request.mock.calls.every(
        ([req]) => req.method === "GET" || req.path.endsWith("/members"),
      ),
    ).toBe(true);
  });

  it("rejects malformed identifiers before issuing requests", async () => {
    const { client, request } = fixture();
    for (const [org, id] of [
      ["../other", teamId],
      [orgId, "team"],
      [orgId, `${teamId}/members/add`],
    ])
      await expect(client.loadTeam(org!, id!)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects a different team or organization from the response", async () => {
    const { client, request } = fixture(() => ({ ...team, organizationId: "other-org" }));
    await expect(client.loadTeam(orgId, teamId)).rejects.toThrow(
      "different team or organization",
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects repeating or missing continuation cursors", async () => {
    const repeated = fixture((req) =>
      req.path.endsWith("/members") ? page(["member"], "repeat") : team,
    );
    await expect(repeated.client.loadTeam(orgId, teamId)).rejects.toThrow(
      "pagination was incomplete",
    );
    const missing = fixture((req) =>
      req.path.endsWith("/members")
        ? {
            results: [{ accountId: "member" }],
            pageInfo: { hasNextPage: true },
          }
        : team,
    );
    await expect(missing.client.loadTeam(orgId, teamId)).rejects.toThrow(
      "pagination was incomplete",
    );
  });

  it("deduplicates repeated members without losing an empty team", async () => {
    const duplicates = fixture((req) => {
      if (req.path.endsWith("/members")) return page(["member", "member"]);
      if (req.path === "/rest/api/3/user")
        return { accountId: "member", displayName: "Member" };
      return team;
    });
    expect((await duplicates.client.loadTeam(orgId, teamId)).members).toHaveLength(1);
    const empty = fixture((req) => (req.path.endsWith("/members") ? page([]) : team));
    expect((await empty.client.loadTeam(orgId, teamId)).members).toEqual([]);
    expect(empty.request).toHaveBeenCalledTimes(2);
  });

  it("keeps roster members when profile names are inaccessible and explicitly warns", async () => {
    const { client } = fixture((req) => {
      if (req.path === "/rest/api/3/user") throw new Error("Forbidden");
      return req.path.endsWith("/members") ? page(["member"]) : team;
    });
    const result = await client.loadTeam(orgId, teamId);
    expect(result.members).toEqual([
      { accountId: "member", displayName: "member", profileUnavailable: true },
    ]);
    expect(result.warnings).toHaveLength(1);
  });

  it("propagates authentication and membership failures instead of returning a reduced roster", async () => {
    const auth = new JiraClientError({
      code: "AUTH_REQUIRED",
      message: "Sign in",
      retryable: false,
    });
    const { client } = fixture((req) => {
      if (req.path === "/rest/api/3/user") throw auth;
      return req.path.endsWith("/members") ? page(["member"]) : team;
    });
    await expect(client.loadTeam(orgId, teamId)).rejects.toBe(auth);
    const unavailable = fixture((req) => {
      if (req.path.endsWith("/members")) throw new Error("Membership unavailable");
      return team;
    });
    await expect(unavailable.client.loadTeam(orgId, teamId)).rejects.toThrow(
      "Membership unavailable",
    );
  });

  it("honors cancellation before the request and after membership loading", async () => {
    const controller = new AbortController();
    controller.abort();
    const early = fixture();
    await expect(
      early.client.loadTeam(orgId, teamId, controller.signal),
    ).rejects.toThrow();
    expect(early.request).not.toHaveBeenCalled();
    const active = new AbortController();
    const during = fixture((req) => {
      if (req.path.endsWith("/members")) {
        active.abort();
        return page(["member"]);
      }
      return team;
    });
    await expect(during.client.loadTeam(orgId, teamId, active.signal)).rejects.toThrow();
    expect(during.request).toHaveBeenCalledTimes(2);
  });
});
