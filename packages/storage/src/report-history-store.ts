import type { GeneratedReportSnapshot, ReportType } from "@power-view/domain";

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
  complete: boolean;
}

export interface ReportHistoryStore {
  save(snapshot: GeneratedReportSnapshot): Promise<void>;
  get(id: string): Promise<GeneratedReportSnapshot | undefined>;
  list(filter?: ReportHistoryFilter): Promise<ReportHistoryItem[]>;
  delete(id: string): Promise<void>;
}

function toHistoryItem(snapshot: GeneratedReportSnapshot): ReportHistoryItem {
  return {
    id: snapshot.id,
    generatedAt: snapshot.generatedAt,
    type: snapshot.request.type,
    boardId: snapshot.request.boardId,
    boardName: snapshot.board.name,
    ...(snapshot.request.sprintId ? { sprintId: snapshot.request.sprintId } : {}),
    complete: snapshot.completeness.complete,
  };
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
    return Promise.resolve(
      [...this.snapshots.values()]
        .filter(
          (snapshot) =>
            (!filter.jiraBaseUrl || snapshot.jira.baseUrl === filter.jiraBaseUrl) &&
            (!filter.boardId || snapshot.request.boardId === filter.boardId) &&
            (!filter.type || snapshot.request.type === filter.type) &&
            (!filter.sprintId || snapshot.request.sprintId === filter.sprintId),
        )
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
        .map(toHistoryItem),
    );
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
    const database = await this.open();
    await this.transaction(database, "readwrite", (store) => {
      return store.add(structuredClone(snapshot));
    });
  }

  async get(id: string): Promise<GeneratedReportSnapshot | undefined> {
    const database = await this.open();
    return this.transaction<GeneratedReportSnapshot | undefined>(
      database,
      "readonly",
      (store) => store.get(id) as IndexedDbRequest<GeneratedReportSnapshot | undefined>,
    );
  }

  async list(filter: ReportHistoryFilter = {}): Promise<ReportHistoryItem[]> {
    const database = await this.open();
    const snapshots = await this.transaction<GeneratedReportSnapshot[]>(
      database,
      "readonly",
      (store) => store.getAll(),
    );
    return snapshots
      .filter(
        (snapshot) =>
          (!filter.jiraBaseUrl || snapshot.jira.baseUrl === filter.jiraBaseUrl) &&
          (!filter.boardId || snapshot.request.boardId === filter.boardId) &&
          (!filter.type || snapshot.request.type === filter.type) &&
          (!filter.sprintId || snapshot.request.sprintId === filter.sprintId),
      )
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
      .map(toHistoryItem);
  }

  async delete(id: string): Promise<void> {
    const database = await this.open();
    await this.transaction(database, "readwrite", (store) => store.delete(id));
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("reportSnapshots")) {
          const store = database.createObjectStore("reportSnapshots", { keyPath: "id" });
          store.createIndex("generatedAt", "generatedAt", { unique: false });
          store.createIndex("boardIdGeneratedAt", ["request.boardId", "generatedAt"], {
            unique: false,
          });
          store.createIndex("type", "request.type", { unique: false });
          store.createIndex("sprintId", "request.sprintId", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open report history."));
    });
    return this.databasePromise;
  }

  private transaction<T = undefined>(
    database: IDBDatabase,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IndexedDbRequest<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("reportSnapshots", mode);
      const request = operation(transaction.objectStore("reportSnapshots"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Report history operation failed."));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Report history transaction failed."));
    });
  }
}
