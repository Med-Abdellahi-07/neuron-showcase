export const DIFFS = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFS)[number];

/** Size of one batch and the maximum number of parallel batches (balances request time against provider limits). */
export const CHUNK = 10;
export const PARALLEL = 5;

/** An integer between lo and hi, or null (rejects strings and fractions). */
export function parseCount(v: unknown, lo: number, hi: number): number | null {
  const s = String(v ?? "").trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= lo && n <= hi ? n : null;
}

/** Splits the requested count into batches <= CHUNK: 25 -> [9,8,8]. */
export function splitCount(count: number): number[] {
  const parts = Math.ceil(count / CHUNK);
  const base = Math.floor(count / parts);
  const extra = count % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

