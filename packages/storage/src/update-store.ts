import type { UpdateCheckResult } from "@power-view/update-checker";
import { z } from "zod";

import type { StorageArea } from "./context-store";

const TOKEN_KEY = "update:token";
const TOKEN_HINT_KEY = "update:token-hint";
const CHECK_RESULT_KEY = "update:check-result";

const tokenSchema = z.string().min(1);
const tokenHintSchema = z.string().min(1);

const updateCheckResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum([
      "up-to-date",
      "update-available",
      "token-missing",
      "token-invalid",
      "check-failed",
    ]),
    checkedAt: z.iso.datetime(),
    latestCommitSha: z.string().min(1).optional(),
    currentCommitSha: z.string().min(1).optional(),
    errorMessage: z.string().min(1).optional(),
  })
  .strict();

function tokenHint(token: string): string {
  return token.length <= 4 ? token : `…${token.slice(-4)}`;
}

export class UpdateStore {
  constructor(private readonly storage: StorageArea) {}

  async saveToken(token: string): Promise<void> {
    await this.storage.set({
      [TOKEN_KEY]: token,
      [TOKEN_HINT_KEY]: tokenHint(token),
    });
  }

  async getToken(): Promise<string | undefined> {
    const result = await this.storage.get(TOKEN_KEY);
    const parsed = tokenSchema.safeParse(result[TOKEN_KEY]);
    return parsed.success ? parsed.data : undefined;
  }

  async getTokenHint(): Promise<string | undefined> {
    const result = await this.storage.get(TOKEN_HINT_KEY);
    const parsed = tokenHintSchema.safeParse(result[TOKEN_HINT_KEY]);
    return parsed.success ? parsed.data : undefined;
  }

  async clearToken(): Promise<void> {
    await this.storage.remove([TOKEN_KEY, TOKEN_HINT_KEY, CHECK_RESULT_KEY]);
  }

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
