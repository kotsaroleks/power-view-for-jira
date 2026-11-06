import { isValidJiraTimestamp } from "@power-view/domain";
import {
  POWER_VIEW_TEAM_CONTEXT_QUERY,
  POWER_VIEW_MY_TEAMS_QUERY,
  type JiraTransportRequest,
} from "@power-view/extension-messaging";

const ALLOWED_READ_ROUTES = new Map<string, ReadonlySet<string>>([
  ["/rest/api/2/myself", new Set()],
  ["/rest/api/2/serverInfo", new Set()],
  ["/rest/api/2/project", new Set()],
  ["/rest/api/2/field", new Set()],
  ["/rest/api/2/status", new Set()],
  ["/rest/api/2/priority", new Set()],
  [
    "/rest/api/2/search",
    new Set(["jql", "startAt", "maxResults", "fields", "validateQuery"]),
  ],
  ["/rest/api/3/myself", new Set()],
  ["/rest/api/3/serverInfo", new Set()],
  ["/rest/api/3/field", new Set()],
  ["/rest/api/3/status", new Set()],
  ["/rest/api/3/priority", new Set()],
  [
    "/rest/api/3/search/jql",
    new Set(["jql", "nextPageToken", "maxResults", "fields", "fieldsByKeys", "failFast"]),
  ],
  ["/rest/api/3/project/search", new Set(["startAt", "maxResults", "orderBy", "query"])],
  [
    "/rest/agile/1.0/board",
    new Set(["startAt", "maxResults", "type", "name", "projectKeyOrId"]),
  ],
]);

const ISSUE_KEY_PATTERN = "[A-Z][A-Z0-9_]*-\\d+";
const ISSUE_FIELD_PATTERN = /^(?:startdate|duedate|customfield_\d+)$/;
const DATE_VALUE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2}))?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validIssueReference(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["key"]) &&
    typeof value.key === "string" &&
    new RegExp(`^${ISSUE_KEY_PATTERN}$`).test(value.key)
  );
}

function validIssueUpdateBody(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["fields"]) || !isRecord(value.fields)) {
    return false;
  }
  const entries = Object.entries(value.fields);
  return (
    entries.length > 0 &&
    entries.length <= 3 &&
    entries.filter(([fieldId]) => fieldId !== "priority").length <= 2 &&
    entries.every(([fieldId, fieldValue]) =>
      fieldId === "priority"
        ? isRecord(fieldValue) &&
          hasOnlyKeys(fieldValue, ["id"]) &&
          typeof fieldValue.id === "string" &&
          /^\d{1,32}$/.test(fieldValue.id)
        : ISSUE_FIELD_PATTERN.test(fieldId) &&
          (fieldValue === null ||
            (typeof fieldValue === "string" &&
              fieldValue.length <= 64 &&
              DATE_VALUE_PATTERN.test(fieldValue))),
    )
  );
}

function validAssigneeBody(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["accountId", "name"])) {
    return false;
  }
  const entries = Object.entries(value);
  return (
    entries.length === 1 &&
    entries.every(
      ([key, fieldValue]) =>
        (key === "accountId" || key === "name") &&
        (fieldValue === null ||
          (typeof fieldValue === "string" &&
            fieldValue.length > 0 &&
            fieldValue.length <= 512)),
    )
  );
}

function validTransitionBody(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["transition"]) &&
    isRecord(value.transition) &&
    hasOnlyKeys(value.transition, ["id"]) &&
    typeof value.transition.id === "string" &&
    /^\d{1,32}$/.test(value.transition.id)
  );
}

function validIssueLinkBody(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["type", "inwardIssue", "outwardIssue"]) ||
    !isRecord(value.type) ||
    !hasOnlyKeys(value.type, ["name"]) ||
    typeof value.type.name !== "string" ||
    value.type.name.length === 0 ||
    value.type.name.length > 255
  ) {
    return false;
  }
  return (
    validIssueReference(value.inwardIssue) && validIssueReference(value.outwardIssue)
  );
}

function validBulkChangelogBody(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["issueIdsOrKeys", "fieldIds", "maxResults", "nextPageToken"])
  ) {
    return false;
  }
  const issueIds = value.issueIdsOrKeys;
  const fieldIds = value.fieldIds;
  const maxResults = value.maxResults;
  const nextPageToken = value.nextPageToken;
  return (
    Array.isArray(issueIds) &&
    issueIds.length > 0 &&
    issueIds.length <= 1_000 &&
    issueIds.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= 255,
    ) &&
    // fieldIds is optional in the Atlassian schema, and an empty array has no defined
    // meaning there, so callers omit it rather than send one.
    (fieldIds === undefined ||
      (Array.isArray(fieldIds) &&
        fieldIds.length <= 10 &&
        fieldIds.every(
          (item) => typeof item === "string" && item.length > 0 && item.length <= 512,
        ))) &&
    typeof maxResults === "number" &&
    Number.isInteger(maxResults) &&
    maxResults >= 1 &&
    maxResults <= 1_000 &&
    (nextPageToken === undefined ||
      (typeof nextPageToken === "string" &&
        nextPageToken.length > 0 &&
        nextPageToken.length <= 4_096))
  );
}

function validTimesheetSearchBody(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["jql", "fields", "maxResults", "nextPageToken"]) &&
    typeof value.jql === "string" &&
    value.jql.trim().length > 0 &&
    value.jql.length <= 10_000 &&
    Array.isArray(value.fields) &&
    (JSON.stringify(value.fields) === JSON.stringify(["summary", "project"]) ||
      JSON.stringify(value.fields) ===
        JSON.stringify(["summary", "project", "issuetype", "assignee", "parent"])) &&
    value.maxResults === 100 &&
    (value.nextPageToken === undefined ||
      (typeof value.nextPageToken === "string" &&
        value.nextPageToken.length > 0 &&
        value.nextPageToken.length <= 4096))
  );
}
function validPlainAdf(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "version", "content"]) &&
    value.type === "doc" &&
    value.version === 1 &&
    Array.isArray(value.content) &&
    value.content.length <= 2000 &&
    JSON.stringify(value).length <= 32_000 &&
    value.content.every(
      (paragraph: unknown) =>
        isRecord(paragraph) &&
        hasOnlyKeys(paragraph, ["type", "content"]) &&
        paragraph.type === "paragraph" &&
        Array.isArray(paragraph.content) &&
        paragraph.content.length <= 1 &&
        paragraph.content.every(
          (part: unknown) =>
            isRecord(part) &&
            hasOnlyKeys(part, ["type", "text"]) &&
            part.type === "text" &&
            typeof part.text === "string" &&
            part.text.length > 0,
        ),
    )
  );
}
function validWorklogBody(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["started", "timeSpentSeconds", "comment"]) &&
    typeof value.started === "string" &&
    isValidJiraTimestamp(value.started) &&
    value.started.includes("T") &&
    typeof value.timeSpentSeconds === "number" &&
    Number.isInteger(value.timeSpentSeconds) &&
    value.timeSpentSeconds > 0 &&
    value.timeSpentSeconds <= 2_147_483_647 &&
    (value.comment === undefined || validPlainAdf(value.comment))
  );
}
const CLOUD_WORKLOG_PATH = new RegExp(
  `^/rest/api/3/issue/${ISSUE_KEY_PATTERN}/worklog(?:/\\d{1,32})?$`,
);

const TEAM_PATH =
  /^\/gateway\/api\/public\/teams\/v1\/org\/[A-Za-z0-9-]{1,128}\/teams\/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
const teamMembersPath = (path: string) =>
  path.endsWith("/members") && TEAM_PATH.test(path.slice(0, -8));
function validTeamsGraphRequest(request: JiraTransportRequest): boolean {
  if (request.method !== "POST" || request.path !== "/gateway/api/graphql") return false;
  const body = request.body;
  if (
    !isRecord(body) ||
    !hasOnlyKeys(body, ["operationName", "query", "variables"]) ||
    !isRecord(body.variables)
  )
    return false;
  const variables = body.variables;
  if (
    body.operationName === "PowerViewTenantContext" &&
    body.query === POWER_VIEW_TEAM_CONTEXT_QUERY
  ) {
    try {
      return (
        hasOnlyKeys(variables, ["hostNames"]) &&
        Array.isArray(variables.hostNames) &&
        variables.hostNames.length === 1 &&
        variables.hostNames[0] === new URL(request.baseUrl).hostname
      );
    } catch {
      return false;
    }
  }
  return (
    body.operationName === "PowerViewMyTeams" &&
    body.query === POWER_VIEW_MY_TEAMS_QUERY &&
    hasOnlyKeys(variables, ["organizationId", "siteId", "memberId", "after"]) &&
    typeof variables.organizationId === "string" &&
    /^ari:cloud:platform::org\/[A-Za-z0-9-]{1,128}$/.test(variables.organizationId) &&
    typeof variables.siteId === "string" &&
    /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(
      variables.siteId,
    ) &&
    typeof variables.memberId === "string" &&
    variables.memberId.length > 0 &&
    variables.memberId.length <= 255 &&
    (variables.after == null ||
      (typeof variables.after === "string" &&
        variables.after.length > 0 &&
        variables.after.length <= 2048))
  );
}
function validTeamMembersBody(body: unknown): boolean {
  return (
    isRecord(body) &&
    hasOnlyKeys(body, ["first", "after"]) &&
    Number.isInteger(body.first) &&
    Number(body.first) >= 1 &&
    Number(body.first) <= 100 &&
    (body.after === undefined ||
      (typeof body.after === "string" &&
        body.after.length > 0 &&
        body.after.length <= 2048))
  );
}

function allowedQueryParameters(
  request: JiraTransportRequest,
): ReadonlySet<string> | undefined {
  if (request.method === "POST" && request.path === "/rest/api/3/changelog/bulkfetch") {
    return new Set();
  }
  if (CLOUD_WORKLOG_PATH.test(request.path) && request.method !== "GET")
    return new Set(["adjustEstimate"]);
  if (request.method !== "GET") {
    return new Set();
  }
  if (TEAM_PATH.test(request.path)) return new Set();
  if (
    request.path === "/rest/api/3/user" &&
    typeof request.query?.accountId === "string" &&
    request.query.accountId.length > 0 &&
    request.query.accountId.length <= 255
  )
    return new Set(["accountId"]);
  if (
    new RegExp(`^/rest/api/3/issue/${ISSUE_KEY_PATTERN}/worklog/\\d{1,32}$`).test(
      request.path,
    )
  )
    return new Set();
  if (new RegExp(`^/rest/api/3/issue/${ISSUE_KEY_PATTERN}$`).test(request.path))
    return new Set(["fields"]);

  const exactRoute = ALLOWED_READ_ROUTES.get(request.path);
  if (exactRoute) {
    return exactRoute;
  }

  if (
    new RegExp(`^/rest/api/[23]/issue/${ISSUE_KEY_PATTERN}/editmeta$`).test(
      request.path,
    ) ||
    new RegExp(`^/rest/api/[23]/issue/${ISSUE_KEY_PATTERN}/transitions$`).test(
      request.path,
    ) ||
    /^\/rest\/api\/[23]\/issueLinkType$/.test(request.path)
  ) {
    return new Set();
  }

  if (/^\/rest\/api\/[23]\/user\/assignable\/search$/.test(request.path)) {
    return new Set(["issueKey", "query", "username", "startAt", "maxResults"]);
  }

  if (/^\/rest\/api\/[23]\/project\/[A-Za-z0-9_-]{1,255}\/statuses$/.test(request.path)) {
    return new Set();
  }

  if (/^\/rest\/agile\/1\.0\/board\/\d+$/.test(request.path)) return new Set();
  if (/^\/rest\/agile\/1\.0\/board\/\d+\/configuration$/.test(request.path))
    return new Set();
  if (/^\/rest\/(?:agile|software)\/1\.0\/board\/\d+\/issue$/.test(request.path)) {
    return new Set([
      "startAt",
      "nextPageToken",
      "maxResults",
      "jql",
      "validateQuery",
      "fields",
      "expand",
    ]);
  }
  if (/^\/rest\/agile\/1\.0\/board\/\d+\/sprint$/.test(request.path)) {
    return new Set(["startAt", "maxResults", "state"]);
  }
  if (/^\/rest\/agile\/1\.0\/sprint\/\d+$/.test(request.path)) return new Set();
  if (
    /^\/rest\/(?:agile|software)\/1\.0\/board\/\d+\/sprint\/\d+\/issue$/.test(
      request.path,
    )
  ) {
    return new Set([
      "startAt",
      "nextPageToken",
      "maxResults",
      "jql",
      "validateQuery",
      "fields",
      "expand",
    ]);
  }
  if (
    new RegExp(`^/rest/api/[23]/issue/${ISSUE_KEY_PATTERN}/changelog$`).test(request.path)
  ) {
    return new Set(["startAt", "maxResults"]);
  }
  if (
    new RegExp(`^/rest/api/[23]/issue/${ISSUE_KEY_PATTERN}/worklog$`).test(request.path)
  ) {
    return new Set(["startAt", "maxResults", "startedAfter", "startedBefore", "expand"]);
  }

  return undefined;
}

function validMutationRequest(request: JiraTransportRequest): boolean {
  if (CLOUD_WORKLOG_PATH.test(request.path)) {
    if (request.query?.adjustEstimate !== "leave") return false;
    const detail = /\/\d+$/.test(request.path);
    if (request.method === "POST" && !detail) return validWorklogBody(request.body);
    if (request.method === "PUT" && detail) return validWorklogBody(request.body);
    if (request.method === "DELETE" && detail) return request.body === undefined;
    return false;
  }
  const issuePath = new RegExp(`^/rest/api/[23]/issue/${ISSUE_KEY_PATTERN}$`);
  const assigneePath = new RegExp(`^/rest/api/[23]/issue/${ISSUE_KEY_PATTERN}/assignee$`);
  const transitionsPath = new RegExp(
    `^/rest/api/[23]/issue/${ISSUE_KEY_PATTERN}/transitions$`,
  );

  if (request.method === "PUT" && issuePath.test(request.path)) {
    return validIssueUpdateBody(request.body);
  }
  if (request.method === "PUT" && assigneePath.test(request.path)) {
    return validAssigneeBody(request.body);
  }
  if (request.method === "POST" && transitionsPath.test(request.path)) {
    return validTransitionBody(request.body);
  }
  if (request.method === "POST" && /^\/rest\/api\/[23]\/issueLink$/.test(request.path)) {
    return validIssueLinkBody(request.body);
  }
  if (
    request.method === "DELETE" &&
    /^\/rest\/api\/[23]\/issueLink\/\d+$/.test(request.path)
  ) {
    return request.body === undefined;
  }
  return false;
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function normalizeJiraBaseUrl(input: string, allowLocalhost: boolean): string {
  const url = new URL(input);
  const isAllowedLocalHttp =
    allowLocalhost && url.protocol === "http:" && isLocalhost(url.hostname);

  if (url.protocol !== "https:" && !isAllowedLocalHttp) {
    throw new Error("Jira requests require HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The Jira base URL contains unsupported components.");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export function validatedJiraRequestUrl(
  request: JiraTransportRequest,
  activeBaseUrl: string,
  allowLocalhost: boolean,
): URL {
  const requestBaseUrl = normalizeJiraBaseUrl(request.baseUrl, allowLocalhost);
  const normalizedActiveBaseUrl = normalizeJiraBaseUrl(activeBaseUrl, allowLocalhost);
  const allowedQuery = allowedQueryParameters(request);
  const requestIsAllowed =
    request.method === "GET"
      ? request.body === undefined && allowedQuery !== undefined
      : request.method === "POST" && request.path === "/rest/api/3/changelog/bulkfetch"
        ? validBulkChangelogBody(request.body)
        : request.method === "POST" && request.path === "/rest/api/3/search/jql"
          ? validTimesheetSearchBody(request.body)
          : request.method === "POST" && teamMembersPath(request.path)
            ? validTeamMembersBody(request.body)
            : request.path === "/gateway/api/graphql"
              ? validTeamsGraphRequest(request)
              : validMutationRequest(request);

  if (
    !requestIsAllowed ||
    (request.method === "GET" &&
      new RegExp(`^/rest/api/3/issue/${ISSUE_KEY_PATTERN}$`).test(request.path) &&
      request.query?.fields !== "summary,project") ||
    requestBaseUrl !== normalizedActiveBaseUrl ||
    allowedQuery === undefined ||
    Object.keys(request.query ?? {}).some((parameter) => !allowedQuery.has(parameter))
  ) {
    throw new Error("The Jira request is outside the endpoint allowlist.");
  }

  const url = new URL(`${requestBaseUrl}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

export function sanitizedJiraRequestHeaders(
  request: JiraTransportRequest,
): Record<string, string> {
  const acceptHeader = Object.entries(request.headers ?? {}).find(
    ([name]) => name.toLowerCase() === "accept",
  )?.[1];
  return {
    Accept: acceptHeader ?? "application/json",
    ...(request.method === "GET"
      ? {}
      : {
          "Content-Type": "application/json",
          // Jira Data Center and some hardened Cloud configurations reject
          // browser-originated writes without this standard anti-CSRF marker.
          "X-Atlassian-Token": "no-check",
        }),
  };
}

export function isJiraReadRequest(request: JiraTransportRequest): boolean {
  return (
    request.method === "GET" ||
    (request.method === "POST" && request.path === "/rest/api/3/search/jql") ||
    (request.method === "POST" &&
      teamMembersPath(request.path) &&
      validTeamMembersBody(request.body)) ||
    validTeamsGraphRequest(request)
  );
}
