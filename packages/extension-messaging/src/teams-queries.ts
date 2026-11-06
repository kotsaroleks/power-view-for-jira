/** Fixed, read-only operations shared with the extension's request allowlist. */
export const POWER_VIEW_TEAM_CONTEXT_QUERY =
  "query PowerViewTenantContext($hostNames: [String!]!) { tenantContexts(hostNames: $hostNames) { cloudId orgId hostName } }";

export const POWER_VIEW_MY_TEAMS_QUERY =
  "query PowerViewMyTeams($organizationId: ID!, $siteId: String!, $memberId: ID!, $after: String) { team { teamSearchV2(organizationId: $organizationId, siteId: $siteId, filter: { membership: { memberIds: [$memberId] } }, first: 100, after: $after, enablePagination: true) { nodes { team { id displayName organizationId } } pageInfo { hasNextPage endCursor } } } }";
