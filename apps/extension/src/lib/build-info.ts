export interface BuildInfo {
  schemaVersion: 1;
  commitSha: string | null;
  commitShaShort: string | null;
  repoOwner: string | null;
  repoName: string | null;
  builtAt: string;
  gitAvailable: boolean;
}

const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function nullableString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function isBuildInfo(value: unknown): value is BuildInfo {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    nullableString(candidate.commitSha) &&
    nullableString(candidate.commitShaShort) &&
    nullableString(candidate.repoOwner) &&
    nullableString(candidate.repoName) &&
    typeof candidate.builtAt === "string" &&
    ISO_DATETIME_PATTERN.test(candidate.builtAt) &&
    typeof candidate.gitAvailable === "boolean" &&
    Object.keys(candidate).length === 7
  );
}

export async function getBuildInfo(
  fetchImpl: typeof fetch = fetch,
): Promise<BuildInfo | undefined> {
  try {
    const response = await fetchImpl(chrome.runtime.getURL("build-info.json"));
    if (!response.ok) {
      return undefined;
    }
    const parsed: unknown = await response.json();
    return isBuildInfo(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
