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
  | "UNKNOWN";

export interface SerializableAppError {
  code: AppErrorCode;
  message: string;
  details?: string;
  retryable: boolean;
  httpStatus?: number;
  correlationId?: string;
}
