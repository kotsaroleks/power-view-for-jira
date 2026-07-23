import type { SerializableAppError } from "@power-view/domain";

export class JiraClientError extends Error {
  constructor(readonly appError: SerializableAppError) {
    super(appError.message);
    this.name = "JiraClientError";
  }
}

export function isJiraClientError(error: unknown): error is JiraClientError {
  return error instanceof JiraClientError;
}
