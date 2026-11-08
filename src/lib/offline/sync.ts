import { getOwner, getSnapshot, listOutbox, removeFromOutbox, saveSnapshot, setOwner, wipeAll } from "./db";
import type { OfflineSnapshot } from "./types";

/** Saves the timetable snapshot; if the device owner changed, all old data is wiped first. */
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

/** Sends pending results; whatever was handled is removed from the outbox. */
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
