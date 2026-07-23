import {
  extensionResponseSchema,
  type ExtensionRequest,
  type ExtensionResponse,
} from "./schemas";

export interface ExtensionRuntime {
  sendMessage(message: unknown): Promise<unknown>;
}

export class InvalidExtensionResponseError extends Error {
  constructor() {
    super("The extension returned a malformed response.");
    this.name = "InvalidExtensionResponseError";
  }
}

export async function sendExtensionRequest(
  runtime: ExtensionRuntime,
  request: ExtensionRequest,
): Promise<ExtensionResponse> {
  const rawResponse: unknown = await runtime.sendMessage(request);
  const parsedResponse = extensionResponseSchema.safeParse(rawResponse);

  if (!parsedResponse.success) {
    throw new InvalidExtensionResponseError();
  }

  return parsedResponse.data;
}
