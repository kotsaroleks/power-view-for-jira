import { z } from "zod";
import {
  POWER_VIEW_TEAM_CONTEXT_QUERY,
  POWER_VIEW_MY_TEAMS_QUERY,
} from "@power-view/extension-messaging";
import { mapWithConcurrency, MAX_CLIENT_CONCURRENCY } from "./concurrency";
import { JiraClientError } from "./errors";
import type { JiraTransport } from "./JiraTransport";
import { WorklogIdentityError } from "./TimesheetClient";

const organizationId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9-]+$/);
const teamIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/);
const accountId = z.string().min(1).max(255);
const teamSchema = z.object({
  organizationId,
  teamId: teamIdSchema,
  displayName: z.string().min(1),
  state: z.enum(["ACTIVE", "ARCHIVED"]),
});
const memberPageSchema = z.object({
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().min(1).max(2048).nullable().optional(),
  }),
  results: z.array(z.object({ accountId })),
});
const profileSchema = z.object({
  accountId,
  displayName: z.string().min(1),
  emailAddress: z.string().optional(),
});
const graphErrors = z.array(z.object({ message: z.string() })).optional();
const tenantResponseSchema = z.object({
  errors: graphErrors,
  data: z
    .object({
      tenantContexts: z
        .array(
          z
            .object({
              cloudId: z.string().nullable(),
              orgId: z.string().nullable(),
              hostName: z.string().nullable(),
            })
            .nullable(),
        )
        .nullable(),
    })
    .nullable()
    .optional(),
});
const myTeamsResponseSchema = z.object({
  errors: graphErrors,
  data: z
    .object({
      team: z
        .object({
          teamSearchV2: z
            .object({
              nodes: z.array(
                z
                  .object({
                    team: z
                      .object({
                        id: z.string(),
                        displayName: z.string().min(1),
                        organizationId: z.string().nullable(),
                      })
                      .nullable(),
                  })
                  .nullable(),
              ),
              pageInfo: z.object({
                hasNextPage: z.boolean(),
                endCursor: z.string().max(2048).nullable(),
              }),
            })
            .nullable(),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
});

export interface CloudTeamSummary {
  id: string;
  name: string;
  organizationId: string;
}

export interface CloudTeamMember {
  jiraEmail?: string;
  accountId: string;
  displayName: string;
  /** A profile permission failure must never remove a member from the denominator. */
  profileUnavailable: boolean;
}

export interface CloudTeam {
  id: string;
  name: string;
  organizationId: string;
  teamId: string;
  displayName: string;
  state: "ACTIVE" | "ARCHIVED";
  members: CloudTeamMember[];
  warnings: string[];
}

export interface TeamsApi {
  listMyTeams(
    expectedAccountId: string,
    signal?: AbortSignal,
  ): Promise<CloudTeamSummary[]>;
  loadTeam(orgId: string, teamId: string, signal?: AbortSignal): Promise<CloudTeam>;
}

/** Read-only Atlassian Teams API. The POST members operation only fetches membership.
 * https://developer.atlassian.com/platform/teams/components/team-public-rest-api/
 */
export class CloudTeamsClient implements TeamsApi {
  constructor(
    private readonly transport: JiraTransport,
    private readonly baseUrl: string,
  ) {}

  /** Discover the current site's organization and only the current user's teams. */
  async listMyTeams(
    expectedAccountId: string,
    signal?: AbortSignal,
  ): Promise<CloudTeamSummary[]> {
    accountId.parse(expectedAccountId);
    const hostName = new URL(this.baseUrl).hostname;
    const checkIdentity = async () => {
      signal?.throwIfAborted();
      const current = await this.transport.request(
        { baseUrl: this.baseUrl, method: "GET", path: "/rest/api/3/myself" },
        z.object({ accountId }),
        signal,
      );
      signal?.throwIfAborted();
      if (current.accountId !== expectedAccountId)
        throw new WorklogIdentityError(
          "The Jira account changed. Reconnect in Settings.",
        );
    };
    await checkIdentity();
    const context = await this.transport.request(
      {
        baseUrl: this.baseUrl,
        method: "POST",
        path: "/gateway/api/graphql",
        body: {
          operationName: "PowerViewTenantContext",
          query: POWER_VIEW_TEAM_CONTEXT_QUERY,
          variables: { hostNames: [hostName] },
        },
      },
      tenantResponseSchema,
      signal,
    );
    signal?.throwIfAborted();
    if (context.errors?.length)
      throw new Error(
        `Team discovery failed: ${context.errors.map((error) => error.message).join("; ")}`,
      );
    const contexts = context.data?.tenantContexts;
    if (
      !contexts ||
      contexts.length !== 1 ||
      !contexts[0] ||
      contexts[0].hostName !== hostName ||
      !contexts[0].orgId ||
      !contexts[0].cloudId
    )
      throw new Error(
        "Atlassian did not return an unambiguous organization for this Jira site.",
      );
    const tenant = contexts[0];
    const org = organizationId.parse(
      tenant.orgId!.replace(/^ari:cloud:platform::org\//, ""),
    );
    const siteId = teamIdSchema.parse(tenant.cloudId);
    const teams = new Map<string, CloudTeamSummary>();
    const cursors = new Set<string>();
    let after: string | null = null;
    while (true) {
      signal?.throwIfAborted();
      const response: z.infer<typeof myTeamsResponseSchema> =
        await this.transport.request(
          {
            baseUrl: this.baseUrl,
            method: "POST",
            path: "/gateway/api/graphql",
            body: {
              operationName: "PowerViewMyTeams",
              query: POWER_VIEW_MY_TEAMS_QUERY,
              variables: {
                organizationId: `ari:cloud:platform::org/${org}`,
                siteId,
                memberId: expectedAccountId,
                after,
              },
            },
          },
          myTeamsResponseSchema,
          signal,
        );
      signal?.throwIfAborted();
      if (response.errors?.length)
        throw new Error(
          `My teams could not be read: ${response.errors.map((error) => error.message).join("; ")}`,
        );
      const result = response.data?.team?.teamSearchV2;
      if (!result)
        throw new Error("Atlassian did not return team membership search results.");
      for (const node of result.nodes) {
        if (!node?.team)
          throw new Error("Atlassian returned incomplete team search results.");
        const team = node.team;
        const id = teamIdSchema.parse(team.id.replace(/^ari:cloud:identity::team\//, ""));
        const teamOrg =
          team.organizationId?.replace(/^ari:cloud:platform::org\//, "") ?? org;
        if (teamOrg !== org)
          throw new Error("Atlassian returned a team from a different organization.");
        const summary = { id, name: team.displayName, organizationId: org };
        const previous = teams.get(id);
        if (previous && previous.name !== summary.name)
          throw new Error(
            "Atlassian returned conflicting team results. Refresh to retry.",
          );
        teams.set(id, summary);
      }
      if (!result.pageInfo.hasNextPage) break;
      const next = result.pageInfo.endCursor;
      if (!next || cursors.has(next) || !result.nodes.length)
        throw new Error(
          "Atlassian My teams pagination was incomplete. Refresh to retry.",
        );
      cursors.add(next);
      after = next;
    }
    await checkIdentity();
    return [...teams.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async loadTeam(
    orgId: string,
    teamId: string,
    signal?: AbortSignal,
  ): Promise<CloudTeam> {
    organizationId.parse(orgId);
    teamIdSchema.parse(teamId);
    signal?.throwIfAborted();
    const path = `/gateway/api/public/teams/v1/org/${orgId}/teams/${teamId}`;
    const team = await this.transport.request(
      { baseUrl: this.baseUrl, method: "GET", path },
      teamSchema,
      signal,
    );
    signal?.throwIfAborted();
    if (team.organizationId !== orgId || team.teamId !== teamId)
      throw new Error("Atlassian returned a different team or organization.");
    const members = new Set<string>();
    const cursors = new Set<string>();
    let after: string | undefined;
    while (true) {
      signal?.throwIfAborted();
      const page = await this.transport.request(
        {
          baseUrl: this.baseUrl,
          method: "POST",
          path: `${path}/members`,
          body: { first: 50, ...(after ? { after } : {}) },
        },
        memberPageSchema,
        signal,
      );
      signal?.throwIfAborted();
      page.results.forEach((member) => members.add(member.accountId));
      if (!page.pageInfo.hasNextPage) break;
      const next = page.pageInfo.endCursor;
      if (!next || cursors.has(next) || !page.results.length)
        throw new Error(
          "Atlassian team membership pagination was incomplete. Refresh to retry.",
        );
      cursors.add(next);
      after = next;
    }
    const warnings: string[] = [];
    const profiles = await mapWithConcurrency(
      [...members],
      MAX_CLIENT_CONCURRENCY,
      async (id): Promise<CloudTeamMember> => {
        try {
          const profile = await this.transport.request(
            {
              baseUrl: this.baseUrl,
              method: "GET",
              path: "/rest/api/3/user",
              query: { accountId: id },
            },
            profileSchema,
            signal,
          );
          signal?.throwIfAborted();
          if (profile.accountId !== id)
            throw new Error("Jira returned a different user profile.");
          return {
            accountId: profile.accountId,
            displayName: profile.displayName,
            ...(profile.emailAddress ? { jiraEmail: profile.emailAddress } : {}),
            profileUnavailable: false,
          };
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof JiraClientError && error.appError.code === "AUTH_REQUIRED")
            throw error;
          warnings.push(`Name unavailable for ${id}; this member remains included.`);
          return { accountId: id, displayName: id, profileUnavailable: true };
        }
      },
      signal,
    );
    signal?.throwIfAborted();
    return {
      ...team,
      id: team.teamId,
      name: team.displayName,
      members: profiles,
      warnings,
    };
  }
}
