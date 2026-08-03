export type AppErrorCode =
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED"
  | "HOST_PERMISSION_MISSING"
  | "JIRA_NOT_DETECTED"
  | "UNSUPPORTED_DEPLOYMENT"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "INVALID_RESPONSE"
  | "INVALID_JQL"
  | "FIELD_MAPPING_REQUIRED"
  | "TOO_MANY_ISSUES"
  | "BOARD_NOT_FOUND"
  | "SPRINT_NOT_FOUND"
  | "STATUS_MAPPING_REQUIRED"
  | "STATUS_MAPPING_STALE"
  | "REPORT_GENERATION_CANCELLED"
  | "REPORT_STORAGE_QUOTA_EXCEEDED"
  | "PDF_GENERATION_FAILED"
  | "UNKNOWN";

export interface SerializableAppError {
  code: AppErrorCode;
  message: string;
  details?: string;
  retryable: boolean;
  httpStatus?: number;
  correlationId?: string;
}
