import type { OfflinePack, OfflineScore, OfflineSnapshot, OutboxScore, RecentLesson } from "./types";

const DB = "neuron-offline";
const VERSION = 2;
const PACKS = "packs";
const SCORES = "scores";
const SNAPSHOT = "snapshot";
const RECENT = "recent";
const OUTBOX = "outbox";
const META = "meta";
const STORES = [PACKS, SCORES, SNAPSHOT, RECENT, OUTBOX, META];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PACKS)) db.createObjectStore(PACKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SCORES)) db.createObjectStore(SCORES, { autoIncrement: true });
      if (!db.objectStoreNames.contains(SNAPSHOT)) db.createObjectStore(SNAPSHOT);
      if (!db.objectStoreNames.contains(RECENT)) db.createObjectStore(RECENT, { keyPath: "id" });
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "clientId" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
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

/** نتيجة QCM محلية: تُحفظ في السجل المحلي وفي صندوق الإرسال حتى تصل للخادم */
export async function addScore(x: OfflineScore): Promise<void> {
  await run(SCORES, "readwrite", (s) => s.add(x));
  const queued: OutboxScore = { ...x, clientId: crypto.randomUUID() };
  await run(OUTBOX, "readwrite", (s) => s.put(queued));
}
export const listScores = () => run<OfflineScore[]>(SCORES, "readonly", (s) => s.getAll());
export const listOutbox = () => run<OutboxScore[]>(OUTBOX, "readonly", (s) => s.getAll());
export const removeFromOutbox = (clientId: string) => run(OUTBOX, "readwrite", (s) => s.delete(clientId));

export const saveSnapshot = (x: OfflineSnapshot) => run(SNAPSHOT, "readwrite", (s) => s.put(x, "main"));
export const getSnapshot = () => run<OfflineSnapshot | undefined>(SNAPSHOT, "readonly", (s) => s.get("main"));

/** صاحب البيانات على هذا الجهاز: آخر مستخدم سجّل دخوله */
export const getOwner = () => run<string | undefined>(META, "readonly", (s) => s.get("owner"));
export const setOwner = (userId: string) => run(META, "readwrite", (s) => s.put(userId, "owner"));

const RECENT_MAX = 10;
export async function addRecent(l: Omit<RecentLesson, "at">): Promise<void> {
  await run(RECENT, "readwrite", (s) => s.put({ ...l, at: Date.now() }));
  const all = (await run<RecentLesson[]>(RECENT, "readonly", (s) => s.getAll())).sort((a, b) => b.at - a.at);
  for (const old of all.slice(RECENT_MAX)) await run(RECENT, "readwrite", (s) => s.delete(old.id));
}
export const listRecent = async () => (await run<RecentLesson[]>(RECENT, "readonly", (s) => s.getAll())).sort((a, b) => b.at - a.at);

/** يمسح كل بيانات المستخدم من الجهاز (الخروج أو تبديل الحساب). قشرة التطبيق العامة (كود فقط) تبقى. */
export async function wipeAll(): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES, "readwrite");
      for (const s of STORES) tx.objectStore(s).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  try {
    for (const k of await caches.keys()) if (k.startsWith("neuron-data")) await caches.delete(k);
  } catch {
    /* الكاش غير متاح */
  }
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
