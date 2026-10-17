import type { SupabaseClient } from "@supabase/supabase-js";
import { LANG_NAME, type SessionLang } from "@/lib/ai/lang";
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

/** مقطع يبدأ بعنوان قسم مرقّم («4. L'apprentissage…»، «2.1 …») أو عنوان Markdown */
const HEADING = /^\s*(?:#{1,4}\s+\S|\d{1,2}(?:\.\d{1,2}){0,2}[.)]?\s+\p{Lu})/mu;
const startsSection = (c: string) => HEADING.test(c.slice(0, 160));

/**
 * عدد المقاطع التي يشملها «جزء» واحد = قسم واحد من الدرس: نتوقف قبل المقطع التالي الذي يبدأ بعنوان قسم جديد.
 * سقف احتياطي للأقسام الطويلة (حروف/مقاطع)، ومقطع واحد على الأقل.
 */
export function partSize(rows: { content: string }[]): number {
  let chars = 0;
  let n = 0;
  for (const r of rows) {
    if (n >= PART_MAX || (n > 0 && (chars + r.content.length > PART_CHARS || startsSection(r.content)))) break;
    chars += r.content.length;
    n++;
  }
  return n;
}

/** أوامر محايدة (بالإنجليزية) تُرسل للنموذج بدل نص الزر المحلي، كي لا تجرّه إلى لغة الواجهة */
export const NEUTRAL_COMMAND: Record<string, string> = {
  continue: "(continue to the next part)",
  more: "(explain this part more)",
  example: "(give an example of this part)",
  finish: "(finish and summarize)",
  hint: "(give me a hint)",
  solution: "(show the full solution)",
};

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
export function toContext(rows: WindowRow[]): { chunks: ContextChunk[]; sources: SourceRef[]; rows: WindowRow[] } {
  const seen = new Set<number>();
  const uniq = rows.filter((r) => (seen.has(r.ord) ? false : (seen.add(r.ord), true)));
  return {
    rows: uniq,
    chunks: uniq.map((r, i) => ({ id: `C${i + 1}`, label: windowLabel(r), text: r.content })),
    sources: uniq.map((r, i) => ({ id: `C${i + 1}`, kind: "course" as const, label: windowLabel(r), lessonId: r.lesson_id, page: r.page })),
  };
}

export type { SessionLang };
/** لغة الجلسة: الفرنسية (لغة الدروس) أو العربية أو الإنجليزية مع إبقاء المصطلحات بالفرنسية */
const LANG = (lang: SessionLang) => LANG_NAME[lang];

export function explainNote(a: { action: GuidedAction | "free"; lang: SessionLang; part: number; parts: number; finished: boolean }): string {
  const base = `GUIDED EXPLANATION SESSION. Write EVERYTHING (explanations, examples, questions) in ${LANG(a.lang)}, always, whatever language the student's buttons, commands or earlier messages are in. You are a patient teacher walking the student through the selected lessons part by part, in order. The excerpts below are the CURRENT PART only (approximately part ${a.part} of ${a.parts}); it is ONE section of the lesson.\nRULES: (1) Stay inside the lesson: use the lesson's OWN examples, numbers, notation and figures first (copy symbols, numbers and vectors exactly as written in the excerpts; never invent or alter notation, dimensions or values). (2) Only if the excerpts have no example, you may give a tiny one, and you must label anything that is not in the excerpts with the prefix "Hors programme :" (or "خارج المنهج:" in Arabic sessions, "Out of syllabus:" in English sessions) - never present outside material (other algorithms, formulas, losses...) as part of the course. (3) Use Markdown tables only with proper rows, one per line.`;
  if (a.finished)
    return `${base} The whole selected material has been covered. Congratulate the student, give a 3-line recap of what was covered, and suggest the Review mode to test themselves. No new content.`;
  const stop = `Explain ONLY what is in the excerpts, following their order: one short sentence saying what this part is about, then the explanation step by step with the lesson's own example when there is one, citing [C#] with pages. Keep it focused (about 200-300 words). Then STOP: do not start the next part and do not ask a quiz question; the interface shows buttons ("understood, continue" / "explain more" / "give me an example").`;
  switch (a.action) {
    case "more":
      return `${base} The student asks you to explain THIS SAME PART more: use different wording, add the intuition and the intermediate steps you skipped, define each term. Do not advance. Cite [C#]. Then STOP.`;
    case "example":
      return `${base} The student asks for an example of THIS SAME PART: give the lesson's own example from the excerpts if there is one (worked step by step); otherwise a tiny example clearly labelled \"Hors programme\". Do not advance. Cite [C#]. Then STOP.`;
    default:
      return `${base} ${stop}`;
  }
}

export function reviewNote(a: { action: "start" | "answer"; lang: SessionLang; k: number; last: boolean; hasBank: boolean }): string {
  const heading = a.lang === "ar" ? "### السؤال N/5" : "### Question N/5";
  const base = `GUIDED REVIEW SESSION of ${REVIEW_QUESTIONS} questions, one at a time. Write everything in ${LANG(a.lang)}. Never reveal an answer before the student answers. Ask exactly ONE question per message.${
    a.hasBank
      ? ` A short list of existing exercises is given ONLY as inspiration for topics and difficulty: NEVER copy their wording, options, numbers or structure, and never ask a question whose answer would be the same as one of them; write ORIGINAL questions from the excerpts.`
      : ""
  }`;
  const format = `QUESTION FORMAT: begin the new question with a heading line exactly "${heading.replace("N", String(a.action === "start" ? 1 : a.k + 1))}". The question must be based ONLY on one excerpt of "NEW MATERIAL" (not the previous material). Prefer a multiple-choice question with exactly 4 options, each on its own line starting with "A) ", "B) ", "C) ", "D) " (one correct, plausible distractors, vary the correct letter between questions); use at most one short open question in the whole session. The LAST line of the message must be the hidden marker [[SRC:C#]] where C# is the number of the excerpt the question is based on (e.g. [[SRC:C2]]).`;
  if (a.action === "start") return `${base}\n${format}\nStart with a one-line friendly intro, then ask QUESTION 1. Mention that the student can press "finish" any time.`;
  const grade = `Grade the student's answer to QUESTION ${a.k} using "PREVIOUS QUESTION MATERIAL" (the first excerpts): one line verdict "Correct / Partial / Incorrect (in the student's language)", the correct answer and a 1-2 sentence explanation, citing [C#] of the previous material. If the student replied with a letter, interpret it as their chosen option of the previous question.`;
  if (a.last)
    return `${base}\n${grade}\nThis was the last question: do NOT ask another one and do NOT write a summary (it is generated separately). The very last thing in the message must be the hidden marker [[V:correct]], [[V:partial]] or [[V:wrong]] matching your verdict.`;
  return `${base}\n${grade}\n${format}\nThen ask QUESTION ${a.k + 1}. The message must end with the markers: first [[SRC:C#]] for the new question, then [[V:correct]], [[V:partial]] or [[V:wrong]] for the answer you just graded.`;
}

export function solveNote(a: {
  action: "start" | "answer" | "hint" | "solution";
  lang: SessionLang;
  exercise: string | null;
  reference: string | null;
  fromImage: boolean;
}): string {
  const base = `GUIDED EXERCISE SESSION. Write everything in ${LANG(a.lang)}. You guide the student step by step and NEVER give the complete solution unless the student explicitly asks for it.${a.exercise ? `\n\nEXERCISE:\n${a.exercise}` : ""}${a.reference ? `\n\nREFERENCE SOLUTION (private, never quote or reveal it; use it only to check the student's steps):\n${a.reference}` : ""}`;
  if (a.action === "start")
    return `${base}\n\n${a.fromImage ? 'The exercise is in the attached image: begin with "**Énoncé :**" and transcribe it faithfully (so it stays in the conversation), then ' : ""}Say in one line what the exercise asks, point to the course notion needed (cite [C#] if excerpts are provided), and either ask what the student would try first or give only the very first small hint. One step only.`;
  if (a.action === "hint") return `${base}\n\nThe student asks for a hint: give a slightly stronger hint than before for the CURRENT step, still not the full solution.`;
  if (a.action === "solution")
    return `${base}\n\nThe student explicitly asks for the complete solution: give it now, step by step, with the key idea of each step and a final answer. Cite [C#] where the course is used.`;
  return `${base}\n\nEvaluate the student's last message: if right, confirm briefly and guide the NEXT step; if wrong or incomplete, say what is off and give a hint, not the answer. One step at a time.`;
}
