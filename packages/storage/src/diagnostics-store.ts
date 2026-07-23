import type { AppErrorCode, RequestDiagnostic } from "@power-view/domain";
import { requestDiagnosticSchema } from "@power-view/extension-messaging";
import { z } from "zod";

import type { StorageArea } from "./context-store";

const DIAGNOSTICS_KEY = "diagnostics:state";

const diagnosticsStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    lastSuccessfulConnectionAt: z.iso.datetime().optional(),
    lastRequest: requestDiagnosticSchema.optional(),
    lastErrorCode: z
      .enum([
        "AUTH_REQUIRED",
        "PERMISSION_DENIED",
        "HOST_PERMISSION_MISSING",
        "JIRA_NOT_DETECTED",
        "UNSUPPORTED_DEPLOYMENT",
        "NETWORK_ERROR",
        "TIMEOUT",
        "RATE_LIMITED",
        "INVALID_RESPONSE",
        "INVALID_JQL",
        "FIELD_MAPPING_REQUIRED",
        "TOO_MANY_ISSUES",
        "UNKNOWN",
      ])
      .optional(),
    cacheStatus: z.enum(["ready", "error"]).optional(),
    loadedIssueCount: z.number().int().nonnegative().max(5_000).optional(),
  })
  .strict();

export interface DiagnosticsState {
  lastSuccessfulConnectionAt?: string;
  lastRequest?: RequestDiagnostic;
  lastErrorCode?: AppErrorCode;
  cacheStatus?: "ready" | "error";
  loadedIssueCount?: number;
}

export class DiagnosticsStore {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly storage: StorageArea) {}

  recordRequest(
    request: RequestDiagnostic,
    options: { connectionSucceeded?: boolean } = {},
  ): Promise<void> {
    const write = this.writes.then(async () => {
      const current = await this.read();
      const value = diagnosticsStateSchema.parse({
        schemaVersion: 1,
        ...current,
        lastRequest: request,
        ...(request.errorCode ? { lastErrorCode: request.errorCode } : {}),
        ...(options.connectionSucceeded
          ? { lastSuccessfulConnectionAt: request.completedAt }
          : {}),
      });
      await this.storage.set({ [DIAGNOSTICS_KEY]: value });
    });

    this.writes = write.catch(() => undefined);
    return write;
  }

  async getState(): Promise<DiagnosticsState> {
    await this.writes;
    return this.read();
  }

  recordIssueLoad(
    loadedIssueCount: number,
    cacheStatus: "ready" | "error",
  ): Promise<void> {
    const write = this.writes.then(async () => {
      const current = await this.read();
      const value = diagnosticsStateSchema.parse({
        schemaVersion: 1,
        ...current,
        loadedIssueCount,
        cacheStatus,
      });
      await this.storage.set({ [DIAGNOSTICS_KEY]: value });
    });

    this.writes = write.catch(() => undefined);
    return write;
  }

  private async read(): Promise<DiagnosticsState> {
    const result = await this.storage.get(DIAGNOSTICS_KEY);
    const parsed = diagnosticsStateSchema.safeParse(result[DIAGNOSTICS_KEY]);
    if (!parsed.success) {
      return {};
    }

    return {
      ...(parsed.data.lastSuccessfulConnectionAt
        ? { lastSuccessfulConnectionAt: parsed.data.lastSuccessfulConnectionAt }
        : {}),
      ...(parsed.data.lastRequest ? { lastRequest: parsed.data.lastRequest } : {}),
      ...(parsed.data.lastErrorCode ? { lastErrorCode: parsed.data.lastErrorCode } : {}),
      ...(parsed.data.cacheStatus ? { cacheStatus: parsed.data.cacheStatus } : {}),
      ...(parsed.data.loadedIssueCount === undefined
        ? {}
        : { loadedIssueCount: parsed.data.loadedIssueCount }),
    };
  }
}
