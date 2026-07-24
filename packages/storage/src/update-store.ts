import type { UpdateCheckResult } from "@power-view/update-checker";
import { z } from "zod";

import type { StorageArea } from "./context-store";

const CHECK_RESULT_KEY = "update:check-result";

const updateCheckResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["up-to-date", "update-available", "check-failed"]),
    checkedAt: z.iso.datetime(),
    latestCommitSha: z.string().min(1).optional(),
    currentCommitSha: z.string().min(1).optional(),
    errorMessage: z.string().min(1).optional(),
  })
  .strict();

export class UpdateStore {
  constructor(private readonly storage: StorageArea) {}

  async saveCheckResult(checkResult: UpdateCheckResult): Promise<void> {
    await this.storage.set({ [CHECK_RESULT_KEY]: checkResult });
  }

  async getCheckResult(): Promise<UpdateCheckResult | undefined> {
    const result = await this.storage.get(CHECK_RESULT_KEY);
    const parsed = updateCheckResultSchema.safeParse(result[CHECK_RESULT_KEY]);
    if (!parsed.success) {
      return undefined;
    }

    return {
      schemaVersion: parsed.data.schemaVersion,
      status: parsed.data.status,
      checkedAt: parsed.data.checkedAt,
      ...(parsed.data.latestCommitSha
        ? { latestCommitSha: parsed.data.latestCommitSha }
        : {}),
      ...(parsed.data.currentCommitSha
        ? { currentCommitSha: parsed.data.currentCommitSha }
        : {}),
      ...(parsed.data.errorMessage ? { errorMessage: parsed.data.errorMessage } : {}),
    };
  }
}
