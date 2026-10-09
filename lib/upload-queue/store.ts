import { QUEUE_DATABASE, QUEUE_STORE, nextClaimable, type QueuedUpload } from "./record";

/**
 * OPS-3: where queued uploads are kept.
 *
 * IndexedDB, because it holds files and survives the tab closing, and because
 * the service worker can read it too. Taking an item to send is one readwrite
 * transaction, and IndexedDB runs those one at a time across every tab and
 * worker of the origin, so two senders can never both take the same item.
 *
 * Written against raw requests and callbacks rather than promises inside the
 * transaction: older Safari commits a transaction the moment control passes
 * through a promise, which would split the read from the write.
 */

export interface QueueStore {
  all(): Promise<QueuedUpload[]>;
  get(id: string): Promise<QueuedUpload | null>;
  put(item: QueuedUpload): Promise<void>;
  /** Reads, changes and writes one item in a single step. Null if it has gone. */
  update(id: string, change: (item: QueuedUpload) => Partial<QueuedUpload>): Promise<QueuedUpload | null>;
  remove(id: string): Promise<void>;
  /** Takes the next item there is to send, if any, holding it until `until`. */
  claimNext(by: string, now: number, until: number): Promise<QueuedUpload | null>;
  /** False when nothing here outlives the page. */
  readonly durable: boolean;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function settled(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("The queue could not be saved."));
  });
}

export function openQueueDatabase(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error("This browser cannot keep files."));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(QUEUE_DATABASE, 1);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(QUEUE_STORE)) database.createObjectStore(QUEUE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const database = request.result;
      // A newer version of this code opening the database elsewhere: step aside.
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The upload queue is open in an older tab."));
  });
}

export class IdbQueueStore implements QueueStore {
  readonly durable = true;
  constructor(private readonly database: IDBDatabase) {}

  private store(mode: IDBTransactionMode) {
    const transaction = this.database.transaction(QUEUE_STORE, mode);
    return { transaction, store: transaction.objectStore(QUEUE_STORE) };
  }

  async all(): Promise<QueuedUpload[]> {
    return done(this.store("readonly").store.getAll() as IDBRequest<QueuedUpload[]>);
  }

  async get(id: string): Promise<QueuedUpload | null> {
    return ((await done(this.store("readonly").store.get(id))) as QueuedUpload | undefined) ?? null;
  }

  async put(item: QueuedUpload): Promise<void> {
    const { transaction, store } = this.store("readwrite");
    store.put(item);
    await settled(transaction);
  }

  async update(id: string, change: (item: QueuedUpload) => Partial<QueuedUpload>): Promise<QueuedUpload | null> {
    const { transaction, store } = this.store("readwrite");
    let result: QueuedUpload | null = null;
    const read = store.get(id);
    read.onsuccess = () => {
      const current = read.result as QueuedUpload | undefined;
      if (!current) return;
      result = { ...current, ...change(current) };
      store.put(result);
    };
    await settled(transaction);
    return result;
  }

  async remove(id: string): Promise<void> {
    const { transaction, store } = this.store("readwrite");
    store.delete(id);
    await settled(transaction);
  }

  async claimNext(by: string, now: number, until: number): Promise<QueuedUpload | null> {
    const { transaction, store } = this.store("readwrite");
    let claimed: QueuedUpload | null = null;
    const read = store.getAll();
    read.onsuccess = () => {
      const next = nextClaimable(read.result as QueuedUpload[], now);
      if (!next) return;
      claimed = { ...next, claim: { by, until } };
      store.put(claimed);
    };
    await settled(transaction);
    return claimed;
  }
}

/** For a browser that will not keep files: the queue lasts as long as the page. */
export class MemoryQueueStore implements QueueStore {
  readonly durable = false;
  private readonly items = new Map<string, QueuedUpload>();

  async all() {
    return [...this.items.values()];
  }
  async get(id: string) {
    return this.items.get(id) ?? null;
  }
  async put(item: QueuedUpload) {
    this.items.set(item.id, item);
  }
  async update(id: string, change: (item: QueuedUpload) => Partial<QueuedUpload>) {
    const current = this.items.get(id);
    if (!current) return null;
    const next = { ...current, ...change(current) };
    this.items.set(id, next);
    return next;
  }
  async remove(id: string) {
    this.items.delete(id);
  }
  async claimNext(by: string, now: number, until: number) {
    const next = nextClaimable([...this.items.values()], now);
    if (!next) return null;
    const claimed = { ...next, claim: { by, until } };
    this.items.set(next.id, claimed);
    return claimed;
  }
  has(id: string) {
    return this.items.has(id);
  }
}

/**
 * The page's store: IndexedDB, with memory behind it for any file the device
 * has no room to keep (a long video on a full phone) or when the browser
 * keeps nothing at all. Those are sent first, being the ones a closed tab
 * would lose, and the tray says to keep the page open until they go.
 */
export class PageQueueStore implements QueueStore {
  readonly durable: boolean;
  private readonly memory = new MemoryQueueStore();

  constructor(private readonly disk: QueueStore | null) {
    this.durable = Boolean(disk);
  }

  /** Kept only in this page, so lost if it closes before sending. */
  isVolatile(id: string): boolean {
    return this.memory.has(id);
  }

  async all() {
    const kept = this.disk ? await this.disk.all() : [];
    return [...(await this.memory.all()), ...kept];
  }

  async get(id: string) {
    return (await this.memory.get(id)) ?? (this.disk ? await this.disk.get(id) : null);
  }

  async put(item: QueuedUpload) {
    if (this.memory.has(item.id) || !this.disk) return this.memory.put(item);
    try {
      await this.disk.put(item);
    } catch {
      await this.memory.put(item);
    }
  }

  async update(id: string, change: (item: QueuedUpload) => Partial<QueuedUpload>) {
    if (this.memory.has(id)) return this.memory.update(id, change);
    if (!this.disk) return null;
    try {
      return await this.disk.update(id, change);
    } catch {
      // No room to write the change (a prepared copy can be larger than the
      // original). Carry on in memory rather than lose the item.
      const current = await this.disk.get(id);
      if (!current) return null;
      const next = { ...current, ...change(current) };
      await this.memory.put(next);
      await this.disk.remove(id).catch(() => {});
      return next;
    }
  }

  async remove(id: string) {
    await this.memory.remove(id);
    if (this.disk) await this.disk.remove(id);
  }

  async claimNext(by: string, now: number, until: number) {
    return (await this.memory.claimNext(by, now, until)) ?? (this.disk ? this.disk.claimNext(by, now, until) : null);
  }
}
