import type { UpdateCheckResult, UpdateCheckStatus } from "@power-view/update-checker";

import type { StorageArea } from "./context-store";

const CHECK_RESULT_KEY = "update:check-result";

const VALID_STATUSES: readonly UpdateCheckStatus[] = [
  "up-to-date",
  "update-available",
  "check-failed",
];

const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function optionalNonEmptyString(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function isUpdateCheckResult(value: unknown): value is UpdateCheckResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.status === "string" &&
    (VALID_STATUSES as readonly string[]).includes(candidate.status) &&
    typeof candidate.checkedAt === "string" &&
    ISO_DATETIME_PATTERN.test(candidate.checkedAt) &&
    optionalNonEmptyString(candidate.latestCommitSha) &&
    optionalNonEmptyString(candidate.currentCommitSha) &&
    optionalNonEmptyString(candidate.errorMessage)
  );
}

export class UpdateStore {
  constructor(private readonly storage: StorageArea) {}

  async saveCheckResult(checkResult: UpdateCheckResult): Promise<void> {
    await this.storage.set({ [CHECK_RESULT_KEY]: checkResult });
  }

  async getCheckResult(): Promise<UpdateCheckResult | undefined> {
    const result = await this.storage.get(CHECK_RESULT_KEY);
    const candidate = result[CHECK_RESULT_KEY];
    return isUpdateCheckResult(candidate) ? candidate : undefined;
  }
}
