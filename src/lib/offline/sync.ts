import { getOwner, getSnapshot, listOutbox, removeFromOutbox, saveSnapshot, setOwner, wipeAll } from "./db";
import type { OfflineSnapshot } from "./types";

/** يحفظ لقطة الجدول؛ إن تغيّر صاحب الجهاز تُمسح كل البيانات القديمة أولًا. */
export async function syncSnapshot(): Promise<OfflineSnapshot | null> {
  const r = await fetch("/api/offline-snapshot", { cache: "no-store", credentials: "same-origin" });
  if (!r.ok) return null;
  const snap = (await r.json()) as OfflineSnapshot;
  const owner = await getOwner();
  if (owner && owner !== snap.userId) await wipeAll();
  await setOwner(snap.userId);
  await saveSnapshot(snap);
  return snap;
}

/** يرسل النتائج المعلّقة؛ ما عولج يُحذف من الصندوق. */
export async function flushOutbox(): Promise<number> {
  const items = await listOutbox();
  if (!items.length) return 0;
  const r = await fetch("/api/offline-scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ scores: items }),
  });
  if (!r.ok) return 0;
  const { saved } = (await r.json()) as { saved: string[] };
  for (const id of saved) await removeFromOutbox(id);
  return saved.length;
}

export { getSnapshot };
