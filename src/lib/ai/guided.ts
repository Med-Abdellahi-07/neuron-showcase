import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContextChunk, SourceRef } from "./prompts";

export type GuidedAction = "start" | "continue" | "more" | "example" | "finish" | "hint" | "solution";
export const GUIDED_ACTIONS: GuidedAction[] = ["start", "continue", "more", "example", "finish", "hint", "solution"];

export const REVIEW_QUESTIONS = 5;
const PART_CHARS = 5000;
const PART_MAX = 8;

export interface WindowRow {
  ord: number;
  total: number;
  lesson_id: string;
  page: number;
  content: string;
  lesson_kind: string;
  lesson_number: number;
  lesson_title: string;
  subject_code: string;
}

export const windowLabel = (r: WindowRow) => `${r.lesson_kind.toUpperCase()} ${r.lesson_number} — ${r.lesson_title} (p. ${r.page})`;

/** عدد المقاطع التي يشملها «جزء» واحد: يتراكم حتى ~5000 حرف (مقطع واحد على الأقل). */
export function partSize(rows: { content: string }[]): number {
  let chars = 0;
  let n = 0;
  for (const r of rows) {
    if (n >= PART_MAX || (n > 0 && chars + r.content.length > PART_CHARS)) break;
    chars += r.content.length;
    n++;
  }
  return n;
}

/** مواضع أسئلة المراجعة: موزعة بالتساوي على نطاق المقاطع. السؤال k (من 1) */
export function reviewPosition(k: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.floor(((k - 1) * total) / REVIEW_QUESTIONS));
}

export async function fetchWindow(
  supabase: SupabaseClient,
  scope: { subjectId: string | null; lessonIds: string[] },
  start: number,
  limit: number
): Promise<WindowRow[]> {
  const { data, error } = await supabase.rpc("lesson_window", {
    p_subject: scope.subjectId,
    p_lessons: scope.lessonIds,
    p_start: start,
    p_limit: limit,
  });
  if (error) throw new Error(`lesson_window: ${error.message}`);
  return (data ?? []) as WindowRow[];
}

/** يحوّل صفوف النافذة إلى سياق ومراجع (C1..) بلا تكرار */
export function toContext(rows: WindowRow[]): { chunks: ContextChunk[]; sources: SourceRef[] } {
  const seen = new Set<number>();
  const uniq = rows.filter((r) => (seen.has(r.ord) ? false : (seen.add(r.ord), true)));
  return {
    chunks: uniq.map((r, i) => ({ id: `C${i + 1}`, label: windowLabel(r), text: r.content })),
    sources: uniq.map((r, i) => ({ id: `C${i + 1}`, kind: "course" as const, label: windowLabel(r), lessonId: r.lesson_id, page: r.page })),
  };
}

const LANG = (locale: string) => (locale === "fr" ? "French" : "Arabic (keep technical terms in French as in the course)");

export function explainNote(a: { action: GuidedAction | "free"; locale: string; part: number; parts: number; finished: boolean }): string {
  const base = `GUIDED EXPLANATION SESSION. Reply language: the student's last message language; if there is none, ${LANG(a.locale)}. You are a patient teacher walking the student through the selected lessons part by part, in order. The excerpts below are the CURRENT PART only (approximately part ${a.part} of ${a.parts}).`;
  if (a.finished)
    return `${base} The whole selected material has been covered. Congratulate the student, give a 3-line recap of what was covered, and suggest the Review mode to test themselves. No new content.`;
  const stop = `Explain ONLY what is in the excerpts, following their order: one short sentence saying what this part is about, then the explanation step by step with a small concrete example when it helps, citing [C#] with pages. Keep it focused (about 250-350 words). Then STOP: do not start the next part and do not ask a quiz question; the interface shows buttons ("understood, continue" / "explain more" / "give me an example").`;
  switch (a.action) {
    case "more":
      return `${base} The student asks you to explain THIS SAME PART more: use different wording, add the intuition and the intermediate steps you skipped, define each term. Do not advance. Cite [C#]. Then STOP.`;
    case "example":
      return `${base} The student asks for an example of THIS SAME PART: give one concrete worked example (numbers or short code if relevant), step by step, tied to the excerpts. Do not advance. Cite [C#]. Then STOP.`;
    default:
      return `${base} ${stop}`;
  }
}

export function reviewNote(a: { action: "start" | "answer" | "finish"; locale: string; k: number; last: boolean; hasBank: boolean }): string {
  const base = `GUIDED REVIEW SESSION of ${REVIEW_QUESTIONS} questions, one at a time. Reply language: the student's language; at the very start use ${LANG(a.locale)}. Questions come from the course excerpts${a.hasBank ? " (a bank of existing exercises is provided: adapt one of them when it fits the material, never invent facts)" : ""}. Never reveal an answer before the student answers. Ask exactly ONE question per message.`;
  if (a.action === "start")
    return `${base} Start with a one-line friendly intro, then ask QUESTION 1 about the section "NEW MATERIAL". Mention that they can press "finish" any time.`;
  if (a.action === "finish")
    return `${base} The student finished. Write the final summary now (no new question) with two sections: "✅ Maîtrisé / ما أتقنته" and "🔁 À revoir / يحتاج مراجعة", based on how the student answered in this conversation, listing for each weak point the lesson and page to revisit with [C#] citations from the excerpts. Be encouraging and concise.`;
  if (a.last)
    return `${base} Grade the student's answer to QUESTION ${a.k} using "PREVIOUS QUESTION MATERIAL" (verdict ✅/⚠/❌, the correct answer briefly, cite [C#]). Then write the final summary (no new question) with two sections: "✅ Maîtrisé / ما أتقنته" and "🔁 À revoir / يحتاج مراجعة" covering all ${REVIEW_QUESTIONS} questions, giving the lesson and page to revisit with [C#] citations.`;
  return `${base} Grade the student's answer to QUESTION ${a.k} using "PREVIOUS QUESTION MATERIAL" (verdict ✅/⚠/❌, the correct answer briefly, cite [C#]). Then ask QUESTION ${a.k + 1} about "NEW MATERIAL". Exactly one new question.`;
}

export function solveNote(a: {
  action: "start" | "answer" | "hint" | "solution";
  locale: string;
  exercise: string | null;
  reference: string | null;
  fromImage: boolean;
}): string {
  const base = `GUIDED EXERCISE SESSION. Reply language: the student's language; at the very start use ${LANG(a.locale)}. You guide the student step by step and NEVER give the complete solution unless the student explicitly asks for it.${a.exercise ? `\n\nEXERCISE:\n${a.exercise}` : ""}${a.reference ? `\n\nREFERENCE SOLUTION (private, never quote or reveal it; use it only to check the student's steps):\n${a.reference}` : ""}`;
  if (a.action === "start")
    return `${base}\n\n${a.fromImage ? 'The exercise is in the attached image: begin with "**Énoncé :**" and transcribe it faithfully (so it stays in the conversation), then ' : ""}Say in one line what the exercise asks, point to the course notion needed (cite [C#] if excerpts are provided), and either ask what the student would try first or give only the very first small hint. One step only.`;
  if (a.action === "hint") return `${base}\n\nThe student asks for a hint: give a slightly stronger hint than before for the CURRENT step, still not the full solution.`;
  if (a.action === "solution")
    return `${base}\n\nThe student explicitly asks for the complete solution: give it now, step by step, with the key idea of each step and a final answer. Cite [C#] where the course is used.`;
  return `${base}\n\nEvaluate the student's last message: if right, confirm briefly and guide the NEXT step; if wrong or incomplete, say what is off and give a hint, not the answer. One step at a time.`;
}
