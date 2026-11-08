import type { Material } from "./material";

export interface RawQuestion {
  statement?: unknown;
  options?: unknown;
  correct_index?: unknown;
  explanation?: unknown;
  lesson?: unknown;
  page?: unknown;
}
export interface GenQuestion {
  statement: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  lessonId: string | null;
  page: number | null;
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Automatic structure check of a model-generated question before showing it: a stem, 4 distinct non-empty options, exactly one correct answer (0-3), an explanation,
 * and a page number accepted only if it really exists in the cited lesson's chunks (otherwise left empty instead of an invented page).
 */
export function validateGenerated(raw: RawQuestion[], mat: Pick<Material, "pages" | "lessons">): GenQuestion[] {
  const out: GenQuestion[] = [];
  for (const q of raw) {
    const statement = clean(q.statement, 600);
    const explanation = clean(q.explanation, 700);
    const opts = Array.isArray(q.options) ? q.options.map((o) => clean(o, 300)) : [];
    const ci = typeof q.correct_index === "number" ? q.correct_index : Number(q.correct_index);
    if (!statement || !explanation || opts.length !== 4 || opts.some((o) => !o)) continue;
    if (new Set(opts.map((o) => o.toLowerCase())).size !== 4) continue;
    if (!Number.isInteger(ci) || ci < 0 || ci > 3) continue;
    const li = Number(q.lesson);
    const lesson = mat.lessons.find((l) => l.index === li) ?? (mat.lessons.length === 1 ? mat.lessons[0] : null);
    const pg = Number(q.page);
    const page = lesson && Number.isInteger(pg) && mat.pages.get(lesson.index)?.has(pg) ? pg : null;
    out.push({ statement, options: opts, correctIndex: ci, explanation, lessonId: lesson?.id ?? null, page });
  }
  return out;
}
