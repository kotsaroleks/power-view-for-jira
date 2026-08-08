import type { ReportChangeEvent, ReportWorklog } from "@power-view/domain";

export type JiraHistoryCacheStoreName = "changelogs" | "worklogs";

/**
 * One issue's history as it was last fetched.
 *
 * `issueUpdatedAt` is the validity key: Jira bumps an issue's `updated` timestamp for
 * every changelog entry and every worklog edit, so identical `updatedAt` means identical
 * history — no TTL, no guessing. `fingerprint` covers everything *else* the stored
 * entries depend on (see `isFreshCacheRecord`).
 */
export interface JiraHistoryCacheRecord<TEntry> {
  key: string;
  issueId: string;
  issueUpdatedAt: string;
  fetchedAt: string;
  fingerprint: string;
  entries: TEntry[];
}

export type ChangelogCacheRecord = JiraHistoryCacheRecord<ReportChangeEvent>;
export type WorklogCacheRecord = JiraHistoryCacheRecord<ReportWorklog>;

export interface JiraHistoryCache {
  /** Reads every key over a single transaction; missing keys are simply absent. */
  getMany<TEntry>(
    storeName: JiraHistoryCacheStoreName,
    keys: readonly string[],
  ): Promise<Array<JiraHistoryCacheRecord<TEntry>>>;
  /** Writes every record — and evicts aged ones — over a single transaction. */
  putMany<TEntry>(
    storeName: JiraHistoryCacheStoreName,
    records: readonly JiraHistoryCacheRecord<TEntry>[],
  ): Promise<void>;
}

const DATABASE_NAME = "power-view-jira-cache";
const DATABASE_VERSION = 1;
const STORE_NAMES: readonly JiraHistoryCacheStoreName[] = ["changelogs", "worklogs"];
const FETCHED_AT_INDEX = "fetchedAt";

/** A month of untouched history is dead weight; the issue itself is long gone from view. */
export const MAX_CACHE_RECORD_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function jiraHistoryCacheKey(baseUrl: string, issueId: string): string {
  return `${baseUrl}|${issueId}`;
}

/**
 * A record is usable only if the issue has not moved since it was written *and* the
 * request that produced the entries was shaped the same way. `updatedAt` is optional on
 * `ReportingIssueSnapshot`; an issue without one can never be validated, so it always
 * misses rather than risking stale history.
 */
export function isFreshCacheRecord(
  record: JiraHistoryCacheRecord<unknown> | undefined,
  issueUpdatedAt: string | undefined,
  fingerprint: string,
): boolean {
  return (
    record !== undefined &&
    issueUpdatedAt !== undefined &&
    record.issueUpdatedAt === issueUpdatedAt &&
    record.fingerprint === fingerprint
  );
}

function isExpired(record: JiraHistoryCacheRecord<unknown>, now: number): boolean {
  const fetchedAt = new Date(record.fetchedAt).getTime();
  // An unparseable timestamp cannot be aged out by date maths, so treat it as expired.
  return !Number.isFinite(fetchedAt) || now - fetchedAt > MAX_CACHE_RECORD_AGE_MS;
}

export class MemoryJiraHistoryCache implements JiraHistoryCache {
  private readonly stores = new Map<
    JiraHistoryCacheStoreName,
    Map<string, JiraHistoryCacheRecord<unknown>>
  >();

  getMany<TEntry>(
    storeName: JiraHistoryCacheStoreName,
    keys: readonly string[],
  ): Promise<Array<JiraHistoryCacheRecord<TEntry>>> {
    const store = this.store(storeName);
    const records = keys.flatMap((key) => {
      const record = store.get(key);
      return record
        ? [structuredClone(record) as JiraHistoryCacheRecord<TEntry>]
        : ([] as Array<JiraHistoryCacheRecord<TEntry>>);
    });
    return Promise.resolve(records);
  }

  putMany<TEntry>(
    storeName: JiraHistoryCacheStoreName,
    records: readonly JiraHistoryCacheRecord<TEntry>[],
  ): Promise<void> {
    if (records.length === 0) return Promise.resolve();
    const store = this.store(storeName);
    for (const record of records) store.set(record.key, structuredClone(record));
    const now = Date.now();
    for (const [key, record] of store) if (isExpired(record, now)) store.delete(key);
    return Promise.resolve();
  }

  private store(
    storeName: JiraHistoryCacheStoreName,
  ): Map<string, JiraHistoryCacheRecord<unknown>> {
    const existing = this.stores.get(storeName);
    if (existing) return existing;
    const created = new Map<string, JiraHistoryCacheRecord<unknown>>();
    this.stores.set(storeName, created);
    return created;
  }
}

export class IndexedDbJiraHistoryCache implements JiraHistoryCache {
  private databasePromise?: Promise<IDBDatabase>;

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly databaseName = DATABASE_NAME,
  ) {}

  async getMany<TEntry>(
    storeName: JiraHistoryCacheStoreName,
    keys: readonly string[],
  ): Promise<Array<JiraHistoryCacheRecord<TEntry>>> {
    if (keys.length === 0) return [];
    const database = await this.open();
    return new Promise<Array<JiraHistoryCacheRecord<TEntry>>>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const records: Array<JiraHistoryCacheRecord<TEntry>> = [];
      // One transaction for the whole batch — a transaction per key would reintroduce
      // the very serialization this cache exists to remove.
      for (const key of keys) {
        const request = store.get(key);
        request.onsuccess = () => {
          const record = request.result as JiraHistoryCacheRecord<TEntry> | undefined;
          if (record) records.push(record);
        };
      }
      transaction.oncomplete = () => resolve(records);
      transaction.onerror = () => reject(this.transactionError(transaction));
      transaction.onabort = () => reject(this.transactionError(transaction));
    });
  }

  async putMany<TEntry>(
    storeName: JiraHistoryCacheStoreName,
    records: readonly JiraHistoryCacheRecord<TEntry>[],
  ): Promise<void> {
    if (records.length === 0) return;
    const database = await this.open();
    const cutoff = new Date(Date.now() - MAX_CACHE_RECORD_AGE_MS).toISOString();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      for (const record of records) store.put(record);
      // Eviction rides the same transaction. A *key* cursor over the fetchedAt index
      // never materializes a record payload, and the index is ascending, so the walk
      // stops at the first record still inside the window.
      const cursorRequest = store.index(FETCHED_AT_INDEX).openKeyCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        // Keys are the ISO `fetchedAt` strings; anything else is not ours to age out.
        if (!cursor || typeof cursor.key !== "string" || cursor.key >= cutoff) return;
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(this.transactionError(transaction));
      transaction.onabort = () => reject(this.transactionError(transaction));
    });
  }

  private transactionError(transaction: IDBTransaction): Error {
    return transaction.error ?? new Error("Jira history cache transaction failed.");
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const storeName of STORE_NAMES) {
          if (database.objectStoreNames.contains(storeName)) continue;
          const store = database.createObjectStore(storeName, { keyPath: "key" });
          store.createIndex(FETCHED_AT_INDEX, FETCHED_AT_INDEX, { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open the Jira history cache."));
    });
    return this.databasePromise;
  }
}
