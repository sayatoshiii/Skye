import type { RoomId, RoomSummary, UserId } from "./types";

export type SyncSnapshot = {
  version: number;
  filter: string | null;
  since: string;
  rooms: Record<RoomId, RoomSummary>;
  account: { type: string; content?: Record<string, unknown> }[];
};

const VERSION = 1;
const STORE = "snapshots";

const open = () =>
  new Promise<IDBDatabase>((done, fail) => {
    const request = indexedDB.open("skye-sync", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });

const run = <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) =>
  open().then(
    (db) =>
      new Promise<T>((done, fail) => {
        const request = act(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => (done(request.result), db.close());
        request.onerror = () => (fail(request.error), db.close());
      }),
  );

export const readSnapshot = (userId: UserId, filter: string | null) =>
  typeof indexedDB === "undefined"
    ? Promise.resolve(null)
    : run<SyncSnapshot | undefined>("readonly", (store) => store.get(userId))
        .then((found) => (found?.version === VERSION && found.filter === filter ? found : null))
        .catch(() => null);

export const writeSnapshot = (userId: UserId, snapshot: Omit<SyncSnapshot, "version">) =>
  typeof indexedDB === "undefined" ? Promise.resolve() : run("readwrite", (store) => store.put({ ...snapshot, version: VERSION }, userId)).then(() => undefined, () => undefined);

export const clearSnapshot = (userId?: UserId) =>
  typeof indexedDB === "undefined" ? Promise.resolve() : run("readwrite", (store) => (userId ? store.delete(userId) : store.clear())).then(() => undefined, () => undefined);
