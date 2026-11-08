/** Stable color for a sender's name (from a name hash) taken from a palette readable on both light and dark backgrounds. */
const COLORS = ["#6D3BF5", "#C2410C", "#0F766E", "#BE185D", "#1D4ED8", "#7C3AED", "#B45309", "#047857"];
export function nameColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** Merges the "latest" window with older manually loaded messages without duplicates, ordered by id. */
export function mergeMessages<T extends { id: number }>(older: T[], latest: T[]): T[] {
  const seen = new Set(latest.map((m) => m.id));
  const first = latest.length ? latest[0].id : Infinity;
  return [...older.filter((m) => !seen.has(m.id) && m.id < first), ...latest];
}

/** Local day key for the date separator. */
export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
