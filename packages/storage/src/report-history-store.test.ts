import { describe, expect, it } from "vitest";
import type { GeneratedReportSnapshot, ReportScope } from "@power-view/domain";
import {
  IndexedDbReportHistoryStore,
  MemoryReportHistoryStore,
  type ReportHistoryStore,
} from "./report-history-store";

/**
 * jsdom ships no IndexedDB, so the tests drive a minimal in-memory stand-in.
 * It models only what the store uses — versioned upgrades, multi-store
 * transactions, add/put/get/getAll/delete and a forward cursor — plus a read
 * counter per object store, which is what proves list() never touches the
 * snapshot payloads.
 */
type EventHandler = ((event: Event) => void) | null;

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
    return new FakeObjectStore(name, rows, this, this.database);
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

class FakeObjectStore {
  constructor(
    readonly name: string,
    private readonly rows: Map<string, Record<string, unknown>>,
    private readonly transaction: FakeTransaction,
    private readonly database: FakeDatabase,
  ) {}

  createIndex(): void {
    // Indexes are never read back by the store; nothing to model.
  }

  add(value: Record<string, unknown>): FakeRequest<undefined> {
    return this.transaction.enqueue(() => {
      const key = String(value.id);
      if (this.rows.has(key)) throw new Error(`Duplicate key ${key} in ${this.name}.`);
      this.rows.set(key, structuredClone(value));
      return undefined;
    });
  }

  put(value: Record<string, unknown>): FakeRequest<undefined> {
    return this.transaction.enqueue(() => {
      this.rows.set(String(value.id), structuredClone(value));
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
      this.database.countRead(this.name);
      const row = this.rows.get(key);
      return row ? structuredClone(row) : undefined;
    });
  }

  getAll(): FakeRequest<unknown[]> {
    return this.transaction.enqueue(() => {
      this.database.countRead(this.name);
      return [...this.sortedKeys()].map((key) => structuredClone(this.rows.get(key)));
    });
  }

  openCursor(): FakeRequest<{ value: unknown; continue: () => void } | null> {
    const keys = this.sortedKeys();
    let position = 0;
    const request = new FakeRequest<{ value: unknown; continue: () => void } | null>();
    const step = (): void => {
      this.transaction.enqueue(() => {
        if (position >= keys.length) return null;
        const key = keys[position]!;
        position += 1;
        this.database.countRead(this.name);
        return { value: structuredClone(this.rows.get(key)), continue: step };
      }, request);
    };
    step();
    return request;
  }

  private sortedKeys(): string[] {
    return [...this.rows.keys()].sort();
  }
}

class FakeDatabase {
  version = 0;
  readonly rows = new Map<string, Map<string, Record<string, unknown>>>();
  readonly reads = new Map<string, number>();
  private upgrade: FakeTransaction | null = null;

  get objectStoreNames(): { contains: (name: string) => boolean } {
    return { contains: (name: string) => this.rows.has(name) };
  }

  countRead(storeName: string): void {
    this.reads.set(storeName, (this.reads.get(storeName) ?? 0) + 1);
  }

  createObjectStore(name: string): FakeObjectStore {
    this.rows.set(name, new Map());
    if (!this.upgrade) throw new Error("createObjectStore outside an upgrade.");
    return this.upgrade.objectStore(name);
  }

  transaction(): FakeTransaction {
    return new FakeTransaction(this);
  }

  beginUpgrade(): FakeTransaction {
    this.upgrade = new FakeTransaction(this);
    return this.upgrade;
  }

  endUpgrade(): void {
    this.upgrade = null;
  }

  seed(storeName: string, records: readonly Record<string, unknown>[]): void {
    const rows = this.rows.get(storeName) ?? new Map<string, Record<string, unknown>>();
    for (const record of records) rows.set(String(record.id), structuredClone(record));
    this.rows.set(storeName, rows);
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
  ): FakeRequest<FakeDatabase> & {
    onupgradeneeded: EventHandler;
    transaction: FakeTransaction | null;
  } {
    const database = this.database(name);
    const request = new FakeRequest<FakeDatabase>() as FakeRequest<FakeDatabase> & {
      onupgradeneeded: EventHandler;
      transaction: FakeTransaction | null;
    };
    request.onupgradeneeded = null;
    request.transaction = null;
    request.result = database;
    queueMicrotask(() => {
      if (version <= database.version) {
        request.onsuccess?.(new Event("success"));
        return;
      }
      database.version = version;
      const upgrade = database.beginUpgrade();
      request.transaction = upgrade;
      upgrade.oncomplete = () => {
        database.endUpgrade();
        request.transaction = null;
        request.onsuccess?.(new Event("success"));
      };
      request.onupgradeneeded?.(new Event("upgradeneeded"));
      queueMicrotask(() => upgrade.settleIfIdle());
    });
    return request;
  }
}

function makeSnapshot(
  overrides: Partial<{
    id: string;
    generatedAt: string;
    baseUrl: string;
    boardId: string;
    boardName: string;
    type: "daily" | "weekly" | "sprint";
    sprintId: string;
    sprintName: string;
    scope: ReportScope;
    assignee: { id: string; displayName: string };
    periodStart: string;
    periodEnd: string;
    complete: boolean;
    issueCount: number;
  }> = {},
): GeneratedReportSnapshot {
  const {
    id = "report-1",
    generatedAt = "2026-01-01T00:00:00.000Z",
    baseUrl = "https://example.atlassian.net",
    boardId = "10",
    boardName = "Alpha",
    type = "daily",
    sprintId,
    sprintName,
    scope = { kind: "team" },
    assignee,
    periodStart = "2026-01-01T00:00:00.000Z",
    periodEnd = "2026-01-02T00:00:00.000Z",
    complete = true,
    issueCount = 3,
  } = overrides;
  const issues = Array.from({ length: issueCount }, (_, index) => ({
    id: `${index}`,
    key: `AL-${index}`,
    browseUrl: `${baseUrl}/browse/AL-${index}`,
    summary: "x".repeat(64),
    issueType: { id: "1", name: "Task" },
    status: { id: "3", name: "In Progress" },
    ...(assignee && index === 0 ? { assignee } : {}),
    sprintIds: [],
  }));
  return {
    schemaVersion: 1,
    id,
    generatedAt,
    generatorVersion: "0.2.1",
    jira: { baseUrl, deploymentType: "cloud" },
    request: {
      type,
      boardId,
      ...(sprintId ? { sprintId } : {}),
      scope,
      period: {
        timeZone: "Europe/Kyiv",
        start: periodStart,
        end: periodEnd,
        dataCutoff: periodEnd,
      },
    },
    board: { id: boardId, name: boardName, type: "scrum", projectKeys: ["AL"] },
    ...(sprintName ? { sprint: { id: sprintId ?? "77", name: sprintName, state: "active" } } : {}),
    statusMapping: {
      schemaVersion: 1,
      jiraBaseUrl: baseUrl,
      boardId,
      completedStatusIds: ["6"],
      completedStatusNames: ["Done"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    issues,
    changes: [],
    worklogs: [],
    result: {
      executiveSummary: {
        totalIssues: issueCount,
        completedIssues: 0,
        incompleteIssues: issueCount,
        createdIssues: 0,
        completedDuringPeriod: 0,
        reopenedDuringPeriod: 0,
        totalTimeSpentSeconds: 0,
        worklogSeconds: 0,
        unassignedIssues: issueCount,
      },
      people: [],
      unassigned: { issues: [], changes: [] },
      activity: [],
    },
    completeness: { complete, issueCount, truncated: false, warnings: [] },
  };
}

function makeIndexedDbStore(factory: FakeIndexedDb): ReportHistoryStore {
  return new IndexedDbReportHistoryStore(
    factory as unknown as IDBFactory,
    "power-view-reporting",
  );
}

const stores: Array<[string, () => ReportHistoryStore]> = [
  ["MemoryReportHistoryStore", () => new MemoryReportHistoryStore()],
  ["IndexedDbReportHistoryStore", () => makeIndexedDbStore(new FakeIndexedDb())],
];

describe.each(stores)("%s", (_name, create) => {
  it("lists newest first and round-trips the saved snapshot", async () => {
    const store = create();
    await store.save(makeSnapshot({ id: "a", generatedAt: "2026-01-01T00:00:00.000Z" }));
    await store.save(makeSnapshot({ id: "b", generatedAt: "2026-03-01T00:00:00.000Z" }));

    expect(await store.list()).toEqual([
      {
        id: "b",
        generatedAt: "2026-03-01T00:00:00.000Z",
        type: "daily",
        boardId: "10",
        boardName: "Alpha",
        scope: { kind: "team" },
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-01-02T00:00:00.000Z",
        complete: true,
      },
      {
        id: "a",
        generatedAt: "2026-01-01T00:00:00.000Z",
        type: "daily",
        boardId: "10",
        boardName: "Alpha",
        scope: { kind: "team" },
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-01-02T00:00:00.000Z",
        complete: true,
      },
    ]);
    expect((await store.get("a"))?.issues).toHaveLength(3);
  });

  it("filters by base url, board, type and sprint", async () => {
    const store = create();
    await store.save(makeSnapshot({ id: "a" }));
    await store.save(
      makeSnapshot({ id: "b", baseUrl: "https://other.atlassian.net", boardId: "20" }),
    );
    await store.save(makeSnapshot({ id: "c", type: "sprint", sprintId: "77" }));

    expect((await store.list({ boardId: "20" })).map((item) => item.id)).toEqual(["b"]);
    expect(
      (await store.list({ jiraBaseUrl: "https://example.atlassian.net" })).map(
        (item) => item.id,
      ),
    ).toEqual(["a", "c"]);
    expect((await store.list({ type: "sprint" })).map((item) => item.id)).toEqual(["c"]);
    expect((await store.list({ sprintId: "77" })).map((item) => item.id)).toEqual(["c"]);
  });

  it("drops deleted reports from the list", async () => {
    const store = create();
    await store.save(makeSnapshot({ id: "a" }));
    await store.save(makeSnapshot({ id: "b", generatedAt: "2026-02-01T00:00:00.000Z" }));

    await store.delete("a");

    expect((await store.list()).map((item) => item.id)).toEqual(["b"]);
    expect(await store.get("a")).toBeUndefined();
  });

  it("reflects distinct scope and period across reports for the same board/type", async () => {
    const store = create();
    await store.save(makeSnapshot({ id: "team-report", scope: { kind: "team" } }));
    await store.save(
      makeSnapshot({
        id: "assignee-report",
        generatedAt: "2026-02-01T00:00:00.000Z",
        scope: { kind: "assignee", userId: "u1" },
        assignee: { id: "u1", displayName: "Ada Lovelace" },
        periodStart: "2026-02-01T00:00:00.000Z",
        periodEnd: "2026-02-08T00:00:00.000Z",
      }),
    );

    const items = await store.list();
    expect(items).toHaveLength(2);
    const assigneeItem = items.find((item) => item.id === "assignee-report");
    const teamItem = items.find((item) => item.id === "team-report");
    expect(assigneeItem?.scope).toEqual({ kind: "assignee", userId: "u1" });
    expect(assigneeItem?.periodStart).toBe("2026-02-01T00:00:00.000Z");
    expect(assigneeItem?.periodEnd).toBe("2026-02-08T00:00:00.000Z");
    expect(teamItem?.scope).toEqual({ kind: "team" });
    expect(teamItem?.periodStart).toBe("2026-01-01T00:00:00.000Z");
  });

  it("resolves assigneeName from the matching issue for an assignee-scoped report", async () => {
    const store = create();
    await store.save(
      makeSnapshot({
        id: "assignee-report",
        scope: { kind: "assignee", userId: "u1" },
        assignee: { id: "u1", displayName: "Ada Lovelace" },
      }),
    );

    const [item] = await store.list();
    expect(item?.assigneeName).toBe("Ada Lovelace");
  });

  it("includes sprintName for a sprint report", async () => {
    const store = create();
    await store.save(
      makeSnapshot({ id: "sprint-report", type: "sprint", sprintId: "77", sprintName: "Sprint 42" }),
    );

    const [item] = await store.list();
    expect(item?.sprintName).toBe("Sprint 42");
  });
});

describe("IndexedDbReportHistoryStore", () => {
  it("backfills the index for snapshots written under the previous version", async () => {
    const factory = new FakeIndexedDb();
    const legacy = factory.database("power-view-reporting");
    legacy.version = 1;
    legacy.seed("reportSnapshots", [
      makeSnapshot({ id: "old-a", generatedAt: "2026-01-01T00:00:00.000Z" }),
      makeSnapshot({
        id: "old-b",
        generatedAt: "2026-02-01T00:00:00.000Z",
        boardName: "Beta",
        type: "sprint",
        sprintId: "77",
        complete: false,
      }),
    ] as unknown as Record<string, unknown>[]);

    const store = makeIndexedDbStore(factory);

    expect(await store.list()).toEqual([
      {
        id: "old-b",
        generatedAt: "2026-02-01T00:00:00.000Z",
        type: "sprint",
        boardId: "10",
        boardName: "Beta",
        sprintId: "77",
        scope: { kind: "team" },
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-01-02T00:00:00.000Z",
        complete: false,
      },
      {
        id: "old-a",
        generatedAt: "2026-01-01T00:00:00.000Z",
        type: "daily",
        boardId: "10",
        boardName: "Alpha",
        scope: { kind: "team" },
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-01-02T00:00:00.000Z",
        complete: true,
      },
    ]);
    // The upgrade must not have destroyed the payloads it walked.
    expect((await store.get("old-b"))?.issues).toHaveLength(3);
  });

  it("re-backfills index rows already present under the previous schema (v2 -> v3)", async () => {
    const factory = new FakeIndexedDb();
    const legacy = factory.database("power-view-reporting");
    legacy.version = 2;
    const snapshot = makeSnapshot({
      id: "old-c",
      generatedAt: "2026-03-01T00:00:00.000Z",
      boardName: "Gamma",
      scope: { kind: "assignee", userId: "u1" },
      assignee: { id: "u1", displayName: "Ada Lovelace" },
      periodStart: "2026-03-01T00:00:00.000Z",
      periodEnd: "2026-03-08T00:00:00.000Z",
    });
    legacy.seed("reportSnapshots", [snapshot] as unknown as Record<string, unknown>[]);
    // Old-shape index row: predates scope/period/assigneeName fields entirely.
    legacy.seed("reportIndex", [
      {
        id: "old-c",
        jiraBaseUrl: "https://example.atlassian.net",
        item: {
          id: "old-c",
          generatedAt: "2026-03-01T00:00:00.000Z",
          type: "daily",
          boardId: "10",
          boardName: "Gamma",
          complete: true,
        },
      },
    ]);

    const store = makeIndexedDbStore(factory);

    expect(await store.list()).toEqual([
      {
        id: "old-c",
        generatedAt: "2026-03-01T00:00:00.000Z",
        type: "daily",
        boardId: "10",
        boardName: "Gamma",
        scope: { kind: "assignee", userId: "u1" },
        assigneeName: "Ada Lovelace",
        periodStart: "2026-03-01T00:00:00.000Z",
        periodEnd: "2026-03-08T00:00:00.000Z",
        complete: true,
      },
    ]);
  });

  it("keeps the index in sync with the snapshot store on save and delete", async () => {
    const factory = new FakeIndexedDb();
    const store = makeIndexedDbStore(factory);
    await store.save(makeSnapshot({ id: "a" }));
    await store.save(makeSnapshot({ id: "b" }));

    const database = factory.database("power-view-reporting");
    expect([...database.rows.get("reportIndex")!.keys()]).toEqual(["a", "b"]);

    await store.delete("a");

    expect([...database.rows.get("reportSnapshots")!.keys()]).toEqual(["b"]);
    expect([...database.rows.get("reportIndex")!.keys()]).toEqual(["b"]);
  });

  it("leaves both stores untouched when a duplicate id is saved", async () => {
    const factory = new FakeIndexedDb();
    const store = makeIndexedDbStore(factory);
    await store.save(makeSnapshot({ id: "a", boardName: "Alpha" }));

    await expect(
      store.save(makeSnapshot({ id: "a", boardName: "Renamed" })),
    ).rejects.toThrow();

    const database = factory.database("power-view-reporting");
    expect(database.rows.get("reportIndex")!.size).toBe(1);
    expect((await store.list())[0]?.boardName).toBe("Alpha");
  });

  it("does not read the snapshot payloads when listing", async () => {
    const factory = new FakeIndexedDb();
    const store = makeIndexedDbStore(factory);
    await store.save(makeSnapshot({ id: "a", issueCount: 500 }));
    await store.save(makeSnapshot({ id: "b", issueCount: 500 }));

    const database = factory.database("power-view-reporting");
    database.reads.clear();

    await store.list();
    await store.list({ boardId: "10" });

    expect(database.reads.get("reportSnapshots") ?? 0).toBe(0);
    expect(database.reads.get("reportIndex")).toBe(2);

    // …but get() still returns the whole thing.
    expect((await store.get("a"))?.issues).toHaveLength(500);
    expect(database.reads.get("reportSnapshots")).toBe(1);
  });
});
