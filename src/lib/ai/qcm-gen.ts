import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJson } from "@/lib/ai";
import { LANG_NAME, type SessionLang } from "@/lib/ai/lang";
import type { Material } from "@/lib/ai/material";
import { validateGenerated, type GenQuestion, type RawQuestion } from "@/lib/ai/qcm-validate";

import { CHUNK, PARALLEL, type Difficulty } from "@/lib/ai/qcm-count";
export { DIFFS, parseCount, splitCount, type Difficulty } from "@/lib/ai/qcm-count";
import { splitCount } from "@/lib/ai/qcm-count";
const DIFF_RULE: Record<Difficulty, string> = {
  easy: "EASY: direct recall of definitions and basic facts.",
  medium: "MEDIUM: understanding and simple application; plausible distractors.",
  hard: "HARD: multi-step reasoning, subtle distinctions, close distractors.",
};

function systemPrompt(o: { lang: SessionLang; difficulty: Difficulty; avoid: string; text: string; portion?: [number, number] }): string {
  return [
    "You are Neuron. Write multiple-choice questions (QCM) ONLY from the COURSE EXTRACTS below; each must be answerable from them.",
    `LANGUAGE: write the questions in ${LANG_NAME[o.lang]}. Technical terms stay in French as in the course. MATH: write every formula and symbol in LaTeX between dollar signs ($...$), never raw LaTeX without dollars.`,
    DIFF_RULE[o.difficulty],
    `Return ONLY JSON: {"questions":[{"statement":"...","options":["A","B","C","D"],"correct_index":0,"explanation":"why the answer is right, 1-3 sentences","lesson":1,"page":3}]}`,
    "Rules: exactly 4 options, exactly ONE correct (correct_index 0-3, vary its position), no 'all of the above', explanation required, 'lesson' = the [L#] number and 'page' = a page number that appears in the extract tags for that lesson.",
    o.portion ? `COVERAGE: this is batch ${o.portion[0]} of ${o.portion[1]}; prefer topics from portion ${o.portion[0]} of ${o.portion[1]} of the extracts (by order) so batches do not overlap.` : "",
    o.avoid ? `Do NOT repeat these earlier questions:\n${o.avoid}` : "",
    "COURSE EXTRACTS:\n" + o.text,
  ].filter(Boolean).join("\n\n");
}

async function oneBatch(need: number, sys: string, mat: Pick<Material, "pages" | "lessons">): Promise<GenQuestion[]> {
  const { data } = await generateJson<{ questions?: RawQuestion[] }>({
    system: sys,
    messages: [{ role: "user", text: `Write ${need} questions.` }],
    maxTokens: Math.min(6000, 600 + need * 330),
    temperature: 0.6,
  }).catch(() => ({ data: { questions: [] } as { questions?: RawQuestion[] } }));
  return validateGenerated(data.questions ?? [], mat);
}

/**
 * Generates `count` valid questions (1..50) from lesson material: parallel batches of <=10 questions, then one top-up round for the shortfall.
 * Returns what was produced (may be fewer than count); the caller decides the minimum acceptable.
 */
export async function generateQuestions(o: {
  mat: Pick<Material, "text" | "pages" | "lessons">;
  count: number;
  difficulty: Difficulty;
  lang: SessionLang;
  avoid: string;
}): Promise<GenQuestion[]> {
  const parts = splitCount(o.count);
  const good: GenQuestion[] = [];
  const seen = new Set<string>();
  const add = (list: GenQuestion[]) => {
    for (const g of list) {
      const k = g.statement.toLowerCase();
      if (!seen.has(k) && good.length < o.count) { seen.add(k); good.push(g); }
    }
  };
  for (let i = 0; i < parts.length; i += PARALLEL) {
    const slice = parts.slice(i, i + PARALLEL);
    const res = await Promise.all(
      slice.map((n, j) => oneBatch(n, systemPrompt({ ...o, text: o.mat.text, portion: parts.length > 1 ? [i + j + 1, parts.length] : undefined }), o.mat))
    );
    res.forEach(add);
  }
  // Top up the shortfall (a batch may fail or invalid questions may be dropped).
  if (good.length < o.count) {
    const need = Math.min(o.count - good.length, CHUNK * 2);
    const avoid = [o.avoid, ...good.slice(-15).map((g) => `- ${g.statement.slice(0, 120)}`)].filter(Boolean).join("\n");
    add(await oneBatch(need, systemPrompt({ ...o, text: o.mat.text, avoid }), o.mat));
  }
  return good;
}

/** Questions already generated for this student in the same subject (to avoid repeats). */
export async function recentStatements(supabase: SupabaseClient, subjectId: string): Promise<string> {
  const { data } = await supabase.from("ai_questions").select("statement").eq("subject_id", subjectId).order("created_at", { ascending: false }).limit(25);
  return (data ?? []).map((p) => `- ${String(p.statement).slice(0, 120)}`).join("\n");
}
