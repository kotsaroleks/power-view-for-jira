import type { JiraTransportRequest } from "@power-view/extension-messaging";
import type { z } from "zod";

export interface JiraTransport {
  request<TResponse>(
    request: JiraTransportRequest,
    schema: z.ZodType<TResponse>,
    signal?: AbortSignal,
  ): Promise<TResponse>;
}
