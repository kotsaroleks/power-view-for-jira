// Mirrors the service worker's RequestSemaphore ceiling
// (apps/extension/src/background/jira-request-handler.ts): a client-side pool wider than
// the semaphore would only queue behind it, so total in-flight depth stays 4.
export const MAX_CLIENT_CONCURRENCY = 4;

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The Jira request was aborted.", "AbortError");
}

/**
 * Runs `worker` over `items` with at most `limit` calls in flight, returning results in
 * input order. Rejects with the first failure (or the abort reason) and stops dispatching.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  // A single iterator shared by every worker is the hand-off point: each pull is atomic
  // because the pool is synchronous between awaits.
  const pending = items.entries();
  let stopped = false;

  const drain = async (): Promise<void> => {
    for (const [index, item] of pending) {
      if (stopped) return;
      if (signal?.aborted) {
        stopped = true;
        throw abortError(signal);
      }
      try {
        results[index] = await worker(item, index);
      } catch (cause) {
        stopped = true;
        throw cause;
      }
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => drain()));
  return results;
}
