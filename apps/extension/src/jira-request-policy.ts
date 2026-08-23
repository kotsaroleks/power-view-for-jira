import type { JiraTransportRequest } from "@power-view/extension-messaging";

const ALLOWED_READ_ROUTES = new Map<string, ReadonlySet<string>>([
  ["/rest/api/2/myself", new Set()],
  ["/rest/api/2/serverInfo", new Set()],
  ["/rest/api/2/project", new Set()],
  ["/rest/api/2/field", new Set()],
  ["/rest/api/2/status", new Set()],
  [
    "/rest/api/2/search",
    new Set(["jql", "startAt", "maxResults", "fields", "validateQuery"]),
  ],
  ["/rest/api/3/myself", new Set()],
  ["/rest/api/3/serverInfo", new Set()],
  ["/rest/api/3/field", new Set()],
  ["/rest/api/3/status", new Set()],
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

function validDateUpdateBody(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["fields"]) || !isRecord(value.fields)) {
    return false;
  }
  const entries = Object.entries(value.fields);
  return (
    entries.length > 0 &&
    entries.length <= 2 &&
    entries.every(
      ([fieldId, fieldValue]) =>
        ISSUE_FIELD_PATTERN.test(fieldId) &&
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

function allowedQueryParameters(
  request: JiraTransportRequest,
): ReadonlySet<string> | undefined {
  if (request.method === "POST" && request.path === "/rest/api/3/changelog/bulkfetch") {
    return new Set();
  }
  if (request.method !== "GET") {
    return new Set();
  }

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
  const issuePath = new RegExp(`^/rest/api/[23]/issue/${ISSUE_KEY_PATTERN}$`);
  const assigneePath = new RegExp(`^/rest/api/[23]/issue/${ISSUE_KEY_PATTERN}/assignee$`);
  const transitionsPath = new RegExp(
    `^/rest/api/[23]/issue/${ISSUE_KEY_PATTERN}/transitions$`,
  );

  if (request.method === "PUT" && issuePath.test(request.path)) {
    return validDateUpdateBody(request.body);
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
        : validMutationRequest(request);

  if (
    !requestIsAllowed ||
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
