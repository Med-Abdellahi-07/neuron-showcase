"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { generateJson } from "@/lib/ai";
import { flushAiStats } from "@/lib/ai/stats";
import { asSessionLang, LANG_NAME } from "@/lib/ai/lang";
import { loadMaterial } from "@/lib/ai/material";
import { refundPoints, spendErrorCode, spendPoints } from "@/lib/ai/points";
import { validateGenerated, type GenQuestion, type RawQuestion } from "@/lib/ai/qcm-validate";
import type { FormState } from "@/app/actions/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTS = [5, 10, 20];
const DIFFS = ["easy", "medium", "hard"];
const KINDS = ["cm", "td", "tp"];
const DIFF_RULE: Record<string, string> = {
  easy: "EASY: direct recall of definitions and basic facts.",
  medium: "MEDIUM: understanding and simple application; plausible distractors.",
  hard: "HARD: multi-step reasoning, subtle distinctions, close distractors.",
};

/**
 * QCM شخصي: أسئلة جديدة تُولَّد من نص الدروس المختارة للطالب وحده (3 نقاط)، بلا أي أثر على الترتيب المصنّف.
 * تحقق آلي من البنية قبل الحفظ، ومحاولة ثانية إن لم يصل العدد الكافي من الأسئلة الصالحة.
 */
export async function generateQcm(_prev: FormState, fd: FormData): Promise<FormState> {
  const { t } = await getT();
  const userId = await getUserId();
  if (!userId) return { error: t("common.error") };
  const subjectId = String(fd.get("subject") ?? "");
  const kind = String(fd.get("kind") ?? "");
  const lessonIds = [...new Set(fd.getAll("lesson").map(String).filter((x) => UUID_RE.test(x)))];
  const count = Number(fd.get("count"));
  const difficulty = String(fd.get("difficulty") ?? "");
  const lang = asSessionLang(fd.get("lang"));
  if (!UUID_RE.test(subjectId) || !COUNTS.includes(count) || !DIFFS.includes(difficulty) || (kind && !KINDS.includes(kind)))
    return { error: t("common.error") };
  if (!lessonIds.length || lessonIds.length > 6) return { error: lessonIds.length ? t("sum.tooMany").replace("{max}", "6") : t("sum.pickLessons") };

  const supabase = await createClient();
  // الدروس يجب أن تكون من المادة المختارة (ومن النوع إن حُدّد) وأن يقرأها الطالب (RLS)
  const { data: ls } = await supabase.from("lessons").select("id, subject_id, kind").in("id", lessonIds);
  if ((ls ?? []).length !== lessonIds.length || (ls ?? []).some((l) => l.subject_id !== subjectId || (kind && l.kind !== kind)))
    return { error: t("common.error") };

  const spent = await spendPoints(supabase, "qcm");
  if (!spent.ok) return { error: t(`ai.err.${spendErrorCode(spent)}`) };

  let setId: string | null = null;
  try {
    const mat = await loadMaterial(supabase, lessonIds, 22_000);
    if (!mat?.text) { await refundPoints(spent.ledgerId); return { error: t("ai.err.noMaterial") }; }

    // لا نكرر ما سبق أن ولّدناه له في المادة نفسها
    const { data: prev } = await supabase.from("ai_questions").select("statement").eq("subject_id", subjectId).order("created_at", { ascending: false }).limit(25);
    const avoid = (prev ?? []).map((p) => `- ${String(p.statement).slice(0, 120)}`).join("\n");

    const system = [
      "You are Neuron. Write multiple-choice questions (QCM) ONLY from the COURSE EXTRACTS below; each must be answerable from them.",
      `LANGUAGE: write the questions in ${LANG_NAME[lang]}. Technical terms stay in French as in the course. Math in LaTeX ($...$).`,
      DIFF_RULE[difficulty],
      `Return ONLY JSON: {"questions":[{"statement":"...","options":["A","B","C","D"],"correct_index":0,"explanation":"why the answer is right, 1-3 sentences","lesson":1,"page":3}]}`,
      "Rules: exactly 4 options, exactly ONE correct (correct_index 0-3, vary its position), no 'all of the above', explanation required, 'lesson' = the [L#] number and 'page' = a page number that appears in the extract tags for that lesson.",
      avoid ? `Do NOT repeat these earlier questions:\n${avoid}` : "",
      "COURSE EXTRACTS:\n" + mat.text,
    ].filter(Boolean).join("\n\n");

    let good: GenQuestion[] = [];
    for (let attempt = 0; attempt < 2 && good.length < Math.ceil(count * 0.8); attempt++) {
      const need = count - good.length;
      const { data } = await generateJson<{ questions?: RawQuestion[] }>({
        system,
        messages: [{ role: "user", text: `Write ${need} questions.` }],
        maxTokens: Math.min(6000, 600 + need * 330),
        temperature: 0.6,
      }).catch(() => ({ data: { questions: [] } as { questions?: RawQuestion[] } }));
      const seen = new Set(good.map((g) => g.statement.toLowerCase()));
      for (const g of validateGenerated(data.questions ?? [], mat)) if (!seen.has(g.statement.toLowerCase())) good.push(g);
    }
    good = good.slice(0, count);
    if (good.length < Math.min(3, count)) throw new Error("too_few_valid");

    const { data: coh } = await supabase.from("profiles").select("cohort_id").eq("id", userId).maybeSingle();
    const { data: set, error } = await supabase
      .from("ai_qcm_sets")
      .insert({ user_id: userId, cohort_id: coh?.cohort_id, subject_id: subjectId, kind: kind || null, lesson_ids: lessonIds, question_count: count, difficulty })
      .select("id").single();
    if (error || !set) throw new Error(error?.message ?? "set_failed");
    setId = set.id as string;
    const rows = good.map((g) => ({
      set_id: setId, user_id: userId, subject_id: subjectId, lesson_id: g.lessonId, page: g.page,
      statement: g.statement, options: g.options, correct_index: g.correctIndex, explanation: g.explanation,
    }));
    const { error: e2 } = await supabase.from("ai_questions").insert(rows);
    if (e2) throw new Error(e2.message);
  } catch (e) {
    console.error("generateQcm failed:", e instanceof Error ? e.message : e);
    if (setId) await supabase.from("ai_qcm_sets").delete().eq("id", setId);
    await refundPoints(spent.ledgerId);
    await flushAiStats(supabase);
    return { error: t("ai.err.unavailable") };
  }
  await flushAiStats(supabase);
  revalidatePath("/assistant/qcm");
  redirect(`/assistant/qcm/${setId}`);
}

export async function answerAiQuestion(questionId: string, selected: number): Promise<{ ok: boolean; correct?: boolean; correctIndex?: number; explanation?: string }> {
  if (!UUID_RE.test(questionId) || !Number.isInteger(selected) || selected < 0 || selected > 3 || !(await getUserId())) return { ok: false };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_answer_question", { p_question: questionId, p_selected: selected });
  if (error || !data) return { ok: false };
  const r = data as { correct: boolean; correct_index: number; explanation: string };
  return { ok: true, correct: r.correct, correctIndex: r.correct_index, explanation: r.explanation };
}

export async function reportAiQuestion(fd: FormData): Promise<void> {
  const id = String(fd.get("id") ?? "");
  const note = String(fd.get("note") ?? "").slice(0, 300);
  if (!UUID_RE.test(id) || !(await getUserId())) return;
  const supabase = await createClient();
  await supabase.rpc("ai_report_question", { p_question: id, p_note: note });
  revalidatePath("/assistant/qcm", "layout");
}

export async function deleteQcmSet(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id) || !(await getUserId())) return;
  const supabase = await createClient();
  await supabase.from("ai_qcm_sets").delete().eq("id", id);
  revalidatePath("/assistant/qcm");
}

export async function resolveAiReport(fd: FormData): Promise<void> {
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.rpc("ai_resolve_report", { p_question: id });
  revalidatePath("/admin", "layout");
}
