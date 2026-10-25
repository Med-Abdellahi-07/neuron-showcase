import type { OfflinePack, OfflineScore } from "./types";

const DB = "neuron-offline";
const PACKS = "packs";
const SCORES = "scores";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PACKS)) db.createObjectStore(PACKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SCORES)) db.createObjectStore(SCORES, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const savePack = (p: OfflinePack) => run(PACKS, "readwrite", (s) => s.put(p));
export const getPack = (id: string) => run<OfflinePack | undefined>(PACKS, "readonly", (s) => s.get(id));
export const listPacks = () => run<OfflinePack[]>(PACKS, "readonly", (s) => s.getAll());
export const removePack = (id: string) => run(PACKS, "readwrite", (s) => s.delete(id));
export const addScore = (x: OfflineScore) => run(SCORES, "readwrite", (s) => s.add(x));
export const listScores = () => run<OfflineScore[]>(SCORES, "readonly", (s) => s.getAll());

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
