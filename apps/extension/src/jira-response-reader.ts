// 20 MiB accommodates paginated issue/history batches while bounding transport memory.
export const MAX_JIRA_RESPONSE_BYTES = 20 * 1024 * 1024;

/** Counts actual decoded-body bytes; Content-Length is only an early rejection hint. */
export async function readBoundedJiraResponse(response: Response): Promise<string> {
  const limit = 20 * 1024 * 1024;
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new Error("Jira response exceeds the 20 MiB limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Jira response exceeds the 20 MiB limit.");
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    reader.releaseLock();
  }
}
