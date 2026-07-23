import type { AppErrorCode } from "./errors";
import type { JiraDeploymentType } from "./jira-context";

export interface RequestDiagnostic {
  endpoint: "myself" | "server-info" | "projects" | "fields" | "issues" | "unknown";
  durationMs: number;
  retryCount: number;
  completedAt: string;
  transport?: "service-worker" | "jira-page-bridge" | "jira-main-world";
  failureStage?: "request" | "bridge-unavailable" | "response";
  httpStatus?: number;
  errorCode?: AppErrorCode;
}

export interface DiagnosticsSnapshot {
  extensionVersion: string;
  browserVersion: string;
  jiraBaseUrl?: string;
  deploymentType?: JiraDeploymentType;
  lastSuccessfulConnectionAt?: string;
  lastRequest?: RequestDiagnostic;
  lastErrorCode?: AppErrorCode;
  cacheStatus: "not-configured" | "ready" | "error";
  loadedIssueCount: number;
  contextTabStatus?: "ready" | "missing" | "closed" | "origin-mismatch";
  hostPermissionGranted?: boolean;
}
