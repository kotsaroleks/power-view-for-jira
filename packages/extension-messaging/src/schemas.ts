import type {
  DiagnosticsSnapshot,
  JiraPageContext,
  RequestDiagnostic,
  SerializableAppError,
} from "@power-view/domain";
import { z } from "zod";

import { isExactHttpsOriginPattern } from "./origin-permission";

const rawJiraPageContextSchema = z
  .object({
    baseUrl: z.url().max(2048),
    pageUrl: z.url().max(20_000),
    detectedAt: z.iso.datetime(),
    deploymentType: z.enum(["cloud", "data-center", "server", "unknown"]),
    projectKey: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
    projectId: z.string().regex(/^\d+$/).optional(),
    issueKey: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*-\d+$/)
      .optional(),
    boardId: z.string().regex(/^\d+$/).optional(),
    sprintId: z.string().regex(/^\d+$/).optional(),
    filterId: z.string().regex(/^\d+$/).optional(),
    jql: z.string().min(1).max(10_000).optional(),
    detectionSources: z
      .array(z.enum(["url", "meta", "dom", "page-state", "user-input"]))
      .min(1),
  })
  .strict();

export const jiraPageContextSchema = rawJiraPageContextSchema.transform(
  (context): JiraPageContext => ({
    baseUrl: context.baseUrl,
    pageUrl: context.pageUrl,
    detectedAt: context.detectedAt,
    deploymentType: context.deploymentType,
    ...(context.projectKey ? { projectKey: context.projectKey } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.issueKey ? { issueKey: context.issueKey } : {}),
    ...(context.boardId ? { boardId: context.boardId } : {}),
    ...(context.sprintId ? { sprintId: context.sprintId } : {}),
    ...(context.filterId ? { filterId: context.filterId } : {}),
    ...(context.jql ? { jql: context.jql } : {}),
    detectionSources: context.detectionSources,
  }),
);

const rawAppErrorSchema = z
  .object({
    code: z.enum([
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
    ]),
    message: z.string().min(1),
    details: z.string().optional(),
    retryable: z.boolean(),
    httpStatus: z.number().int().optional(),
    correlationId: z.string().optional(),
  })
  .strict();

export const appErrorSchema = rawAppErrorSchema.transform(
  (error): SerializableAppError => ({
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.details ? { details: error.details } : {}),
    ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
    ...(error.correlationId ? { correlationId: error.correlationId } : {}),
  }),
);

const requestIdSchema = z.string().uuid();

const queryValueSchema = z.union([z.string().max(20_000), z.number(), z.boolean()]);

export const jiraTransportRequestSchema = z
  .object({
    baseUrl: z.url().max(2048),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]),
    path: z.string().startsWith("/rest/api/").max(512),
    query: z.record(z.string().max(128), queryValueSchema).optional(),
    headers: z.record(z.string().max(128), z.string().max(2048)).optional(),
    body: z.record(z.string().max(128), z.unknown()).optional(),
  })
  .strict();

const rawRequestDiagnosticSchema = z
  .object({
    endpoint: z.enum([
      "myself",
      "server-info",
      "projects",
      "fields",
      "issues",
      "unknown",
    ]),
    durationMs: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    completedAt: z.iso.datetime(),
    transport: z
      .enum(["service-worker", "jira-page-bridge", "jira-main-world"])
      .optional(),
    failureStage: z.enum(["request", "bridge-unavailable", "response"]).optional(),
    httpStatus: z.number().int().optional(),
    errorCode: rawAppErrorSchema.shape.code.optional(),
  })
  .strict();

export const requestDiagnosticSchema = rawRequestDiagnosticSchema.transform(
  (diagnostic): RequestDiagnostic => ({
    endpoint: diagnostic.endpoint,
    durationMs: diagnostic.durationMs,
    retryCount: diagnostic.retryCount,
    completedAt: diagnostic.completedAt,
    ...(diagnostic.transport ? { transport: diagnostic.transport } : {}),
    ...(diagnostic.failureStage ? { failureStage: diagnostic.failureStage } : {}),
    ...(diagnostic.httpStatus === undefined ? {} : { httpStatus: diagnostic.httpStatus }),
    ...(diagnostic.errorCode ? { errorCode: diagnostic.errorCode } : {}),
  }),
);

const rawDiagnosticsSnapshotSchema = z
  .object({
    extensionVersion: z.string().min(1).max(64),
    browserVersion: z.string().min(1).max(128),
    jiraBaseUrl: z.url().max(2048).optional(),
    deploymentType: z.enum(["cloud", "data-center", "server", "unknown"]).optional(),
    lastSuccessfulConnectionAt: z.iso.datetime().optional(),
    lastRequest: requestDiagnosticSchema.optional(),
    lastErrorCode: rawAppErrorSchema.shape.code.optional(),
    cacheStatus: z.enum(["not-configured", "ready", "error"]),
    loadedIssueCount: z.number().int().nonnegative(),
    contextTabStatus: z
      .enum(["ready", "missing", "closed", "origin-mismatch"])
      .optional(),
    hostPermissionGranted: z.boolean().optional(),
  })
  .strict();

export const diagnosticsSnapshotSchema = rawDiagnosticsSnapshotSchema.transform(
  (snapshot): DiagnosticsSnapshot => ({
    extensionVersion: snapshot.extensionVersion,
    browserVersion: snapshot.browserVersion,
    cacheStatus: snapshot.cacheStatus,
    loadedIssueCount: snapshot.loadedIssueCount,
    ...(snapshot.contextTabStatus ? { contextTabStatus: snapshot.contextTabStatus } : {}),
    ...(snapshot.hostPermissionGranted === undefined
      ? {}
      : { hostPermissionGranted: snapshot.hostPermissionGranted }),
    ...(snapshot.jiraBaseUrl ? { jiraBaseUrl: snapshot.jiraBaseUrl } : {}),
    ...(snapshot.deploymentType ? { deploymentType: snapshot.deploymentType } : {}),
    ...(snapshot.lastSuccessfulConnectionAt
      ? { lastSuccessfulConnectionAt: snapshot.lastSuccessfulConnectionAt }
      : {}),
    ...(snapshot.lastRequest ? { lastRequest: snapshot.lastRequest } : {}),
    ...(snapshot.lastErrorCode ? { lastErrorCode: snapshot.lastErrorCode } : {}),
  }),
);

export const extensionRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CONTEXT_GET"), requestId: requestIdSchema }).strict(),
  z
    .object({
      type: z.literal("CONTEXT_REFRESH"),
      requestId: requestIdSchema,
      tabId: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("CONTEXT_UPDATE"),
      requestId: requestIdSchema,
      context: jiraPageContextSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("POWER_VIEW_OPEN"),
      requestId: requestIdSchema,
      context: jiraPageContextSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("HOST_PERMISSION_REQUEST"),
      requestId: requestIdSchema,
      originPattern: z.string().refine(isExactHttpsOriginPattern, {
        message: "An exact HTTPS origin pattern is required.",
      }),
    })
    .strict(),
  z
    .object({
      type: z.literal("JIRA_REQUEST"),
      requestId: requestIdSchema,
      payload: jiraTransportRequestSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("JIRA_REQUEST_CANCEL"),
      requestId: requestIdSchema,
      targetRequestId: requestIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("ISSUE_LOAD_REPORT"),
      requestId: requestIdSchema,
      loadedIssueCount: z.number().int().nonnegative().max(5_000),
      cacheStatus: z.enum(["ready", "error"]),
    })
    .strict(),
  z.object({ type: z.literal("DIAGNOSTICS_GET"), requestId: requestIdSchema }).strict(),
]);

export const extensionResponseSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ACK"),
      requestId: requestIdSchema,
      ok: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("CONTEXT_RESULT"),
      requestId: requestIdSchema,
      ok: z.literal(true),
      context: jiraPageContextSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("POWER_VIEW_OPENED"),
      requestId: requestIdSchema,
      ok: z.literal(true),
      tabId: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("HOST_PERMISSION_RESULT"),
      requestId: requestIdSchema,
      ok: z.literal(true),
      granted: z.boolean(),
      originPattern: z.string().refine(isExactHttpsOriginPattern),
    })
    .strict(),
  z
    .object({
      type: z.literal("JIRA_RESPONSE"),
      requestId: requestIdSchema,
      ok: z.literal(true),
      status: z.number().int(),
      data: z.unknown(),
      durationMs: z.number().int().nonnegative(),
      retryCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("DIAGNOSTICS_RESULT"),
      requestId: requestIdSchema,
      ok: z.literal(true),
      diagnostics: diagnosticsSnapshotSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("ERROR"),
      requestId: requestIdSchema.optional(),
      ok: z.literal(false),
      error: appErrorSchema,
    })
    .strict(),
]);

export type ExtensionRequest = z.infer<typeof extensionRequestSchema>;
export type ExtensionResponse = z.infer<typeof extensionResponseSchema>;
export type JiraTransportRequest = z.infer<typeof jiraTransportRequestSchema>;
