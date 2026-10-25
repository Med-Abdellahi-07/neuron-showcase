export const DIFFS = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFS)[number];

/** حجم الدفعة الواحدة وأقصى عدد دفعات متوازية (يوازن بين زمن الطلب وحدود المزوّدين) */
export const CHUNK = 10;
export const PARALLEL = 5;

/** عدد صحيح بين lo وhi أو null (يرفض النصوص والكسور) */
export function parseCount(v: unknown, lo: number, hi: number): number | null {
  const s = String(v ?? "").trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= lo && n <= hi ? n : null;
}

/** يقسم العدد المطلوب إلى دفعات ≤ CHUNK: 25 → [9,8,8] */
export function splitCount(count: number): number[] {
  const parts = Math.ceil(count / CHUNK);
  const base = Math.floor(count / parts);
  const extra = count % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

