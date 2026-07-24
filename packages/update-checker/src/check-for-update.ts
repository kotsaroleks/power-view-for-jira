import { z } from "zod";

export type UpdateCheckStatus = "up-to-date" | "update-available" | "check-failed";

export interface UpdateCheckResult {
  schemaVersion: 1;
  status: UpdateCheckStatus;
  checkedAt: string;
  latestCommitSha?: string;
  currentCommitSha?: string;
  errorMessage?: string;
}

export interface CheckForUpdateInput {
  owner: string;
  repo: string;
  branch: string;
  currentCommitSha: string | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const commitResponseSchema = z.object({ sha: z.string().min(1) });

function result(
  status: UpdateCheckStatus,
  checkedAt: string,
  extra: Partial<
    Pick<UpdateCheckResult, "latestCommitSha" | "currentCommitSha" | "errorMessage">
  > = {},
): UpdateCheckResult {
  return {
    schemaVersion: 1,
    status,
    checkedAt,
    ...extra,
  };
}

export async function checkForUpdate(
  input: CheckForUpdateInput,
): Promise<UpdateCheckResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => new Date());
  const checkedAt = now().toISOString();

  if (input.currentCommitSha === null) {
    return result("check-failed", checkedAt, {
      errorMessage: "Build has no embedded commit info; rebuild to enable update checks.",
    });
  }

  const currentCommitSha = input.currentCommitSha;
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/commits/${input.branch}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    return result("check-failed", checkedAt, {
      currentCommitSha,
      errorMessage: "Power View could not reach GitHub.",
    });
  }

  if (!response.ok) {
    return result("check-failed", checkedAt, {
      currentCommitSha,
      errorMessage: `GitHub returned an unexpected status (${response.status}).`,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return result("check-failed", checkedAt, {
      currentCommitSha,
      errorMessage: "GitHub returned a response Power View could not parse.",
    });
  }

  const parsed = commitResponseSchema.safeParse(body);
  if (!parsed.success) {
    return result("check-failed", checkedAt, {
      currentCommitSha,
      errorMessage: "GitHub returned an unexpected response shape.",
    });
  }

  const latestCommitSha = parsed.data.sha;
  return result(
    latestCommitSha === currentCommitSha ? "up-to-date" : "update-available",
    checkedAt,
    { currentCommitSha, latestCommitSha },
  );
}
