import type { GeneratedReportSnapshot, ReportScope, ReportType } from "@power-view/domain";

export interface ReportHistoryFilter {
  jiraBaseUrl?: string;
  boardId?: string;
  type?: ReportType;
  sprintId?: string;
}

export interface ReportHistoryItem {
  id: string;
  generatedAt: string;
  type: ReportType;
  boardId: string;
  boardName: string;
  sprintId?: string;
  sprintName?: string;
  scope: ReportScope;
  assigneeName?: string;
  periodStart: string;
  periodEnd: string;
  complete: boolean;
}

export interface ReportHistoryStore {
  save(snapshot: GeneratedReportSnapshot): Promise<void>;
  get(id: string): Promise<GeneratedReportSnapshot | undefined>;
  list(filter?: ReportHistoryFilter): Promise<ReportHistoryItem[]>;
  delete(id: string): Promise<void>;
}

const SNAPSHOT_STORE = "reportSnapshots";
const INDEX_STORE = "reportIndex";

// v1 held snapshots only; v2 adds the header-only index store that list() reads;
// v3 widens ReportHistoryItem with period/scope/sprintName/assigneeName and
// unconditionally re-backfills the index store on every version bump so it stays fresh.
const DATABASE_VERSION = 3;

/**
 * The header fields `list()` needs, kept beside the snapshot so the history list
 * never has to deserialize issues/changes/worklogs. `jiraBaseUrl` lives outside
 * `item` because it is a filter key but not part of the returned row.
 */
interface ReportIndexRecord {
  id: string;
  jiraBaseUrl: string;
  item: ReportHistoryItem;
}

function toHistoryItem(snapshot: GeneratedReportSnapshot): ReportHistoryItem {
  const scope = snapshot.request.scope;
  const assigneeName =
    scope.kind === "assignee"
      ? snapshot.issues.find((issue) => issue.assignee?.id === scope.userId)?.assignee
          ?.displayName
      : undefined;
  return {
    id: snapshot.id,
    generatedAt: snapshot.generatedAt,
    type: snapshot.request.type,
    boardId: snapshot.request.boardId,
    boardName: snapshot.board.name,
    ...(snapshot.request.sprintId ? { sprintId: snapshot.request.sprintId } : {}),
    ...(snapshot.sprint?.name ? { sprintName: snapshot.sprint.name } : {}),
    scope,
    ...(assigneeName ? { assigneeName } : {}),
    periodStart: snapshot.request.period.start,
    periodEnd: snapshot.request.period.end,
    complete: snapshot.completeness.complete,
  };
}

function toIndexRecord(snapshot: GeneratedReportSnapshot): ReportIndexRecord {
  return {
    id: snapshot.id,
    jiraBaseUrl: snapshot.jira.baseUrl,
    item: toHistoryItem(snapshot),
  };
}

function matchesFilter(record: ReportIndexRecord, filter: ReportHistoryFilter): boolean {
  return (
    (!filter.jiraBaseUrl || record.jiraBaseUrl === filter.jiraBaseUrl) &&
    (!filter.boardId || record.item.boardId === filter.boardId) &&
    (!filter.type || record.item.type === filter.type) &&
    (!filter.sprintId || record.item.sprintId === filter.sprintId)
  );
}

function toHistoryItems(
  records: readonly ReportIndexRecord[],
  filter: ReportHistoryFilter,
): ReportHistoryItem[] {
  return records
    .filter((record) => matchesFilter(record, filter))
    .sort((left, right) => right.item.generatedAt.localeCompare(left.item.generatedAt))
    .map((record) => record.item);
}

export class MemoryReportHistoryStore implements ReportHistoryStore {
  private readonly snapshots = new Map<string, GeneratedReportSnapshot>();

  save(snapshot: GeneratedReportSnapshot): Promise<void> {
    if (this.snapshots.has(snapshot.id)) {
      throw new Error("A report snapshot with this id already exists.");
    }
    this.snapshots.set(snapshot.id, structuredClone(snapshot));
    return Promise.resolve();
  }

  get(id: string): Promise<GeneratedReportSnapshot | undefined> {
    const snapshot = this.snapshots.get(id);
    return Promise.resolve(snapshot ? structuredClone(snapshot) : undefined);
  }

  list(filter: ReportHistoryFilter = {}): Promise<ReportHistoryItem[]> {
    const records = [...this.snapshots.values()].map(toIndexRecord);
    return Promise.resolve(toHistoryItems(records, filter));
  }

  delete(id: string): Promise<void> {
    this.snapshots.delete(id);
    return Promise.resolve();
  }
}

interface IndexedDbRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export class IndexedDbReportHistoryStore implements ReportHistoryStore {
  private databasePromise?: Promise<IDBDatabase>;

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly databaseName = "power-view-reporting",
  ) {}

  async save(snapshot: GeneratedReportSnapshot): Promise<void> {
    const record = toIndexRecord(snapshot);
    await this.write((snapshots, index) => {
      snapshots.add(structuredClone(snapshot));
      index.add(record);
    });
  }

  async get(id: string): Promise<GeneratedReportSnapshot | undefined> {
    return this.read<GeneratedReportSnapshot | undefined>(
      SNAPSHOT_STORE,
      (store) => store.get(id) as IndexedDbRequest<GeneratedReportSnapshot | undefined>,
    );
  }

  async list(filter: ReportHistoryFilter = {}): Promise<ReportHistoryItem[]> {
    const records = await this.read<ReportIndexRecord[]>(INDEX_STORE, (store) =>
      store.getAll(),
    );
    return toHistoryItems(records, filter);
  }

  async delete(id: string): Promise<void> {
    await this.write((snapshots, index) => {
      snapshots.delete(id);
      index.delete(id);
    });
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        const upgrade = request.transaction;
        if (!upgrade) {
          reject(new Error("Could not upgrade report history."));
          return;
        }
        if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
          const store = database.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
          store.createIndex("generatedAt", "generatedAt", { unique: false });
          store.createIndex("boardIdGeneratedAt", ["request.boardId", "generatedAt"], {
            unique: false,
          });
          store.createIndex("type", "request.type", { unique: false });
          store.createIndex("sprintId", "request.sprintId", { unique: false });
        }
        const index = database.objectStoreNames.contains(INDEX_STORE)
          ? upgrade.objectStore(INDEX_STORE)
          : database.createObjectStore(INDEX_STORE, { keyPath: "id" });
        // Re-derive every index row from its snapshot on every version bump — not just
        // when the store is first created. This keeps rows written under an older
        // ReportHistoryItem shape in sync with schema additions, without needing to
        // special-case each future field. The open request only resolves after this
        // transaction commits, so list() can never observe a half-backfilled index.
        const cursorRequest = upgrade.objectStore(SNAPSHOT_STORE).openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          index.put(toIndexRecord(cursor.value as GeneratedReportSnapshot));
          cursor.continue();
        };
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open report history."));
    });
    return this.databasePromise;
  }

  private async read<T>(
    storeName: string,
    operation: (store: IDBObjectStore) => IndexedDbRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Report history operation failed."));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Report history transaction failed."));
    });
  }

  /** Snapshot and index rows are written together so the two can never diverge. */
  private async write(
    operation: (snapshots: IDBObjectStore, index: IDBObjectStore) => void,
  ): Promise<void> {
    const database = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [SNAPSHOT_STORE, INDEX_STORE],
        "readwrite",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Report history transaction failed."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Report history transaction failed."));
      operation(
        transaction.objectStore(SNAPSHOT_STORE),
        transaction.objectStore(INDEX_STORE),
      );
    });
  }
}
