import type {
  ContextDetectionSource,
  JiraDeploymentType,
  JiraPageContext,
} from "@power-view/domain";

const ISSUE_KEY_PATTERN = /\b([A-Z][A-Z0-9_]*-\d+)\b/i;
const PROJECT_PATH_PATTERNS = [
  /\/jira\/software\/(?:c\/)?projects\/([A-Z][A-Z0-9_]*)/i,
  /\/projects\/([A-Z][A-Z0-9_]*)/i,
  /\/plugins\/servlet\/project-config\/([A-Z][A-Z0-9_]*)/i,
] as const;
const BOARD_PATH_PATTERN = /\/boards\/(\d+)/i;

export interface JiraPageSnapshot {
  pageUrl: string;
  metadata: Readonly<Record<string, string | undefined>>;
}

function firstMatch(value: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(value)?.[1];
    if (match) {
      return match;
    }
  }

  return undefined;
}

function optionalValue(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizedMatch(value: string | undefined, pattern: RegExp): string | undefined {
  return value && pattern.test(value) ? value.toUpperCase() : undefined;
}

function numericValue(value: string | undefined): string | undefined {
  return value && /^\d+$/.test(value) ? value : undefined;
}

function sameOriginBaseUrl(pageUrl: URL, rawBaseUrl?: string): string | undefined {
  if (!rawBaseUrl) {
    return undefined;
  }

  try {
    const baseUrl = new URL(rawBaseUrl, pageUrl.origin);
    if (baseUrl.origin !== pageUrl.origin) {
      return undefined;
    }

    baseUrl.search = "";
    baseUrl.hash = "";
    return baseUrl.href.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function deploymentType(
  pageUrl: URL,
  metadata: JiraPageSnapshot["metadata"],
): JiraDeploymentType {
  if (pageUrl.hostname.toLowerCase().endsWith(".atlassian.net")) {
    return "cloud";
  }

  const declaredType = metadata["ajs-deployment-type"]?.toLowerCase();
  if (declaredType === "data-center" || declaredType === "datacenter") {
    return "data-center";
  }
  if (declaredType === "server") {
    return "server";
  }

  return "unknown";
}

export function detectJiraContext(
  snapshot: JiraPageSnapshot,
  detectedAt = new Date(),
): JiraPageContext | undefined {
  let pageUrl: URL;

  try {
    pageUrl = new URL(snapshot.pageUrl);
  } catch {
    return undefined;
  }

  const isLocalDevelopment =
    pageUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(pageUrl.hostname);
  if (pageUrl.protocol !== "https:" && !isLocalDevelopment) {
    return undefined;
  }

  const issueKey = normalizedMatch(
    optionalValue(
      snapshot.metadata["ajs-issue-key"] ??
        pageUrl.searchParams.get("issueKey") ??
        pageUrl.pathname.match(ISSUE_KEY_PATTERN)?.[1],
    ),
    /^[A-Z][A-Z0-9_]*-\d+$/i,
  );
  const projectKey = normalizedMatch(
    optionalValue(
      snapshot.metadata["ajs-project-key"] ??
        pageUrl.searchParams.get("projectKey") ??
        firstMatch(pageUrl.pathname, PROJECT_PATH_PATTERNS) ??
        issueKey?.split("-")[0],
    ),
    /^[A-Z][A-Z0-9_]*$/i,
  );
  const projectId = numericValue(
    optionalValue(
      snapshot.metadata["ajs-project-id"] ?? pageUrl.searchParams.get("projectId"),
    ),
  );
  const boardId = numericValue(
    optionalValue(
      pageUrl.pathname.match(BOARD_PATH_PATTERN)?.[1] ??
        pageUrl.searchParams.get("rapidView") ??
        pageUrl.searchParams.get("boardId"),
    ),
  );
  const sprintId = numericValue(
    optionalValue(
      pageUrl.searchParams.get("sprint") ?? pageUrl.searchParams.get("sprintId"),
    ),
  );
  const filterId = numericValue(
    optionalValue(
      pageUrl.searchParams.get("filter") ?? pageUrl.searchParams.get("filterId"),
    ),
  );
  const jqlCandidate = optionalValue(pageUrl.searchParams.get("jql"));
  const jql = jqlCandidate && jqlCandidate.length <= 10_000 ? jqlCandidate : undefined;
  const metadataBaseUrl = sameOriginBaseUrl(pageUrl, snapshot.metadata["ajs-base-url"]);

  const hasMetadataSignal = Boolean(
    metadataBaseUrl ||
    snapshot.metadata["ajs-version-number"] ||
    snapshot.metadata["ajs-project-key"] ||
    snapshot.metadata["ajs-issue-key"],
  );
  const hasUrlSignal = Boolean(
    pageUrl.hostname.toLowerCase().endsWith(".atlassian.net") ||
    issueKey ||
    projectKey ||
    boardId ||
    filterId ||
    jql,
  );

  if (!hasMetadataSignal && !hasUrlSignal) {
    return undefined;
  }

  const detectionSources: ContextDetectionSource[] = [];
  if (hasUrlSignal) {
    detectionSources.push("url");
  }
  if (hasMetadataSignal) {
    detectionSources.push("meta");
  }

  return {
    baseUrl: metadataBaseUrl ?? pageUrl.origin,
    pageUrl: pageUrl.href,
    detectedAt: detectedAt.toISOString(),
    deploymentType: deploymentType(pageUrl, snapshot.metadata),
    ...(projectKey ? { projectKey } : {}),
    ...(projectId ? { projectId } : {}),
    ...(issueKey ? { issueKey } : {}),
    ...(boardId ? { boardId } : {}),
    ...(sprintId ? { sprintId } : {}),
    ...(filterId ? { filterId } : {}),
    ...(jql ? { jql } : {}),
    detectionSources,
  };
}
