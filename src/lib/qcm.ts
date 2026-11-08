/** Pure logic for QCM download (tested directly with node --test). No environment dependency. */

export const QCM_MAX = 50;
export const QCM_COUNTS = [10, 20, 30, QCM_MAX] as const; // The last one means "all", capped at 50.
export const QCM_PER_TABLE = 10; // Rows per table on the answers page.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
const int = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) || n < 1 ? null : Math.min(n, 999);
};

export interface QcmParams {
  subjectCode: string;
  lesson: string | null;
  from: number | null;
  to: number | null;
  difficulty: "easy" | "medium" | "hard" | null;
  count: number;
  shuffle: boolean;
  explain: boolean;
}

/** Reads the URL parameters and clamps them to valid values (the server re-validates inside SQL too). */
export function parseQcmParams(sp: SP): QcmParams {
  const diff = one(sp.difficulty);
  const rawCount = parseInt(one(sp.count), 10);
  const lesson = UUID_RE.test(one(sp.lesson)) ? one(sp.lesson) : null;
  const from = int(one(sp.from));
  const to = int(one(sp.to));
  return {
    subjectCode: one(sp.subject).slice(0, 30),
    lesson,
    from: lesson ? null : from,
    to: lesson ? null : to,
    difficulty: diff === "easy" || diff === "medium" || diff === "hard" ? diff : null,
    count: Number.isNaN(rawCount) ? 20 : Math.min(Math.max(rawCount, 1), QCM_MAX),
    shuffle: one(sp.shuffle) === "1",
    explain: one(sp.explain) === "1",
  };
}

/** Option index -> letter (0 -> A). */
export const optionLetter = (i: number) => String.fromCharCode(65 + i);

/** Splits a list of question numbers into tables of `size` rows (for answers in several columns). */
export function chunk<T>(items: T[], size = QCM_PER_TABLE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Label for the lesson range: ar/fr/en are passed in as ready-made strings from the dictionary. */
export function scopeLabel(
  p: { lessonLabel: string | null; from: number | null; to: number | null },
  words: { all: string; lessons: string; lesson: string }
): string {
  if (p.lessonLabel) return `${words.lesson} ${p.lessonLabel}`;
  if (p.from !== null || p.to !== null) return `${words.lessons} ${p.from ?? 1}–${p.to ?? "…"}`;
  return words.all;
}
