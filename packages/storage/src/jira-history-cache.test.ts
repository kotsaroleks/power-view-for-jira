import { describe, expect, it } from "vitest";
import {
  IndexedDbJiraHistoryCache,
  isFreshCacheRecord,
  jiraHistoryCacheKey,
  MAX_CACHE_RECORD_AGE_MS,
  MemoryJiraHistoryCache,
  type JiraHistoryCache,
  type JiraHistoryCacheRecord,
} from "./jira-history-cache";

/**
 * jsdom ships no IndexedDB, so these tests drive a minimal stand-in modelling only what
 * the cache uses — versioned upgrades, get/put/delete and an ascending key cursor over
 * the `fetchedAt` index — plus a transaction counter, which is what proves the bulk
 * operations do not degenerate into a transaction per key.
 */
type EventHandler = ((event: Event) => void) | null;

interface Row {
  key: string;
  fetchedAt: string;
  [field: string]: unknown;
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: EventHandler = null;
  onerror: EventHandler = null;
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: EventHandler = null;
  onerror: EventHandler = null;
  onabort: EventHandler = null;
  private pending = 0;
  private finished = false;

  constructor(private readonly database: FakeDatabase) {}

  objectStore(name: string): FakeObjectStore {
    const rows = this.database.rows.get(name);
    if (!rows) throw new Error(`No object store named ${name}.`);
    return new FakeObjectStore(name, rows, this);
  }

  enqueue<T>(work: () => T, request = new FakeRequest<T>()): FakeRequest<T> {
    this.pending += 1;
    queueMicrotask(() => {
      if (this.finished) return;
      let failure: Error | undefined;
      try {
        request.result = work();
      } catch (cause) {
        failure = cause instanceof Error ? cause : new Error(String(cause));
      }
      this.pending -= 1;
      if (failure) {
        request.error = failure as unknown as DOMException;
        this.error = failure as unknown as DOMException;
        request.onerror?.(new Event("error"));
        this.finish("abort");
        return;
      }
      request.onsuccess?.(new Event("success"));
      this.settleIfIdle();
    });
    return request;
  }

  settleIfIdle(): void {
    if (!this.finished && this.pending === 0) this.finish("complete");
  }

  private finish(kind: "complete" | "abort"): void {
    if (this.finished) return;
    this.finished = true;
    if (kind === "complete") this.oncomplete?.(new Event("complete"));
    else this.onabort?.(new Event("abort"));
  }
}

interface FakeKeyCursor {
  key: string;
  primaryKey: string;
  continue: () => void;
}

class FakeObjectStore {
  constructor(
    readonly name: string,
    private readonly rows: Map<string, Row>,
    private readonly transaction: FakeTransaction,
  ) {}

  createIndex(): void {
    // The only index is fetchedAt, derived on the fly by index().
  }

  put(value: Row): FakeRequest<undefined> {
    return this.transaction.enqueue(() => {
      this.rows.set(value.key, structuredClone(value));
      return undefined;
    });
  }

  delete(key: string): FakeRequest<undefined> {
    return this.transaction.enqueue(() => {
      this.rows.delete(key);
      return undefined;
    });
  }

  get(key: string): FakeRequest<unknown> {
    return this.transaction.enqueue(() => {
      const row = this.rows.get(key);
      return row ? structuredClone(row) : undefined;
    });
  }

  index(name: string): { openKeyCursor: () => FakeRequest<FakeKeyCursor | null> } {
    if (name !== "fetchedAt") throw new Error(`No index named ${name}.`);
    return { openKeyCursor: () => this.openKeyCursor() };
  }

  private openKeyCursor(): FakeRequest<FakeKeyCursor | null> {
    const request = new FakeRequest<FakeKeyCursor | null>();
    let ordered: Array<[string, string]> | undefined;
    let position = 0;
    const step = (): void => {
      this.transaction.enqueue(() => {
        // Built on first read, not at open time: writes queued ahead of the cursor in the
        // same transaction have landed by then, exactly as a real index would see them.
        ordered ??= [...this.rows.values()]
          .map((row): [string, string] => [row.fetchedAt, row.key])
          .sort(
            (left, right) =>
              left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]),
          );
        const entry = ordered[position];
        if (!entry) return null;
        position += 1;
        return { key: entry[0], primaryKey: entry[1], continue: step };
      }, request);
    };
    step();
    return request;
  }
}

class FakeDatabase {
  version = 0;
  transactions = 0;
  readonly rows = new Map<string, Map<string, Row>>();
  private upgrade: FakeTransaction | null = null;

  get objectStoreNames(): { contains: (name: string) => boolean } {
    return { contains: (name: string) => this.rows.has(name) };
  }

  createObjectStore(name: string): FakeObjectStore {
    this.rows.set(name, new Map());
    if (!this.upgrade) throw new Error("createObjectStore outside an upgrade.");
    return this.upgrade.objectStore(name);
  }

  transaction(): FakeTransaction {
    this.transactions += 1;
    return new FakeTransaction(this);
  }

  beginUpgrade(): FakeTransaction {
    this.upgrade = new FakeTransaction(this);
    return this.upgrade;
  }

  endUpgrade(): void {
    this.upgrade = null;
  }
}

class FakeIndexedDb {
  readonly databases = new Map<string, FakeDatabase>();

  database(name: string): FakeDatabase {
    const existing = this.databases.get(name);
    if (existing) return existing;
    const created = new FakeDatabase();
    this.databases.set(name, created);
    return created;
  }

  open(
    name: string,
    version: number,
  ): FakeRequest<FakeDatabase> & { onupgradeneeded: EventHandler } {
    const database = this.database(name);
    const request = new FakeRequest<FakeDatabase>() as FakeRequest<FakeDatabase> & {
      onupgradeneeded: EventHandler;
    };
    request.onupgradeneeded = null;
    request.result = database;
    queueMicrotask(() => {
      if (version <= database.version) {
        request.onsuccess?.(new Event("success"));
        return;
      }
      database.version = version;
      const upgrade = database.beginUpgrade();
      upgrade.oncomplete = () => {
        database.endUpgrade();
        request.onsuccess?.(new Event("success"));
      };
      request.onupgradeneeded?.(new Event("upgradeneeded"));
      queueMicrotask(() => upgrade.settleIfIdle());
    });
    return request;
  }
}

const baseUrl = "https://example.atlassian.net";

function record(
  issueId: string,
  overrides: Partial<JiraHistoryCacheRecord<string>> = {},
): JiraHistoryCacheRecord<string> {
  return {
    key: jiraHistoryCacheKey(baseUrl, issueId),
    issueId,
    issueUpdatedAt: "2026-08-01T00:00:00.000Z",
    fetchedAt: new Date().toISOString(),
    fingerprint: "fp",
    entries: [`entry-${issueId}`],
    ...overrides,
  };
}

function makeIndexedDbCache(factory: FakeIndexedDb): JiraHistoryCache {
  return new IndexedDbJiraHistoryCache(
    factory as unknown as IDBFactory,
    "power-view-jira-cache",
  );
}

const caches: Array<[string, () => JiraHistoryCache]> = [
  ["MemoryJiraHistoryCache", () => new MemoryJiraHistoryCache()],
  ["IndexedDbJiraHistoryCache", () => makeIndexedDbCache(new FakeIndexedDb())],
];

describe.each(caches)("%s", (_name, create) => {
  it("round-trips records and reports only the keys it holds", async () => {
    const cache = create();
    await cache.putMany("changelogs", [record("1"), record("2")]);

    const records = await cache.getMany<string>("changelogs", [
      jiraHistoryCacheKey(baseUrl, "1"),
      jiraHistoryCacheKey(baseUrl, "missing"),
    ]);

    expect(records.map((item) => item.issueId)).toEqual(["1"]);
    expect(records[0]?.entries).toEqual(["entry-1"]);
  });

  it("keeps the two stores apart", async () => {
    const cache = create();
    await cache.putMany("changelogs", [record("1")]);

    expect(await cache.getMany("worklogs", [jiraHistoryCacheKey(baseUrl, "1")])).toEqual(
      [],
    );
  });

  it("stores an issue that produced no entries so it can hit next time", async () => {
    const cache = create();
    await cache.putMany("changelogs", [record("1", { entries: [] })]);

    const [stored] = await cache.getMany<string>("changelogs", [
      jiraHistoryCacheKey(baseUrl, "1"),
    ]);

    expect(stored?.entries).toEqual([]);
  });

  it("drops records past the age threshold on the next write", async () => {
    const cache = create();
    const aged = new Date(Date.now() - MAX_CACHE_RECORD_AGE_MS - 60_000).toISOString();
    await cache.putMany("changelogs", [
      record("old", { fetchedAt: aged }),
      record("fresh"),
    ]);

    // Eviction runs on write, so it takes a second write to observe it.
    await cache.putMany("changelogs", [record("new")]);

    const records = await cache.getMany<string>("changelogs", [
      jiraHistoryCacheKey(baseUrl, "old"),
      jiraHistoryCacheKey(baseUrl, "fresh"),
      jiraHistoryCacheKey(baseUrl, "new"),
    ]);
    expect(records.map((item) => item.issueId)).toEqual(["fresh", "new"]);
  });
});

describe("IndexedDbJiraHistoryCache", () => {
  it("reads and writes a whole batch over one transaction each", async () => {
    const factory = new FakeIndexedDb();
    const cache = makeIndexedDbCache(factory);
    const database = factory.database("power-view-jira-cache");

    await cache.putMany(
      "changelogs",
      Array.from({ length: 25 }, (_, index) => record(String(index))),
    );
    expect(database.transactions).toBe(1);

    await cache.getMany(
      "changelogs",
      Array.from({ length: 25 }, (_, index) =>
        jiraHistoryCacheKey(baseUrl, String(index)),
      ),
    );
    expect(database.transactions).toBe(2);
  });

  it("touches no transaction for an empty batch", async () => {
    const factory = new FakeIndexedDb();
    const cache = makeIndexedDbCache(factory);

    expect(await cache.getMany("changelogs", [])).toEqual([]);
    await cache.putMany("changelogs", []);

    expect(factory.database("power-view-jira-cache").transactions).toBe(0);
  });
});

describe("isFreshCacheRecord", () => {
  it("hits only when both the issue and the request fingerprint are unchanged", () => {
    const cached = record("1");

    expect(isFreshCacheRecord(cached, "2026-08-01T00:00:00.000Z", "fp")).toBe(true);
    expect(isFreshCacheRecord(cached, "2026-08-02T00:00:00.000Z", "fp")).toBe(false);
    expect(isFreshCacheRecord(cached, "2026-08-01T00:00:00.000Z", "other")).toBe(false);
  });

  it("never hits for an issue with no updatedAt, which can never be validated", () => {
    expect(isFreshCacheRecord(record("1"), undefined, "fp")).toBe(false);
  });

  it("misses when there is no record at all", () => {
    expect(isFreshCacheRecord(undefined, "2026-08-01T00:00:00.000Z", "fp")).toBe(false);
  });
});
