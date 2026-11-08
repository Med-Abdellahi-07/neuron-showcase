"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { flushAiStats } from "@/lib/ai/stats";
import { asSessionLang } from "@/lib/ai/lang";
import { loadMaterial } from "@/lib/ai/material";
import { refundPoints, spendErrorCode, spendPoints } from "@/lib/ai/points";
import { DIFFS, generateQuestions, parseCount, recentStatements, type Difficulty } from "@/lib/ai/qcm-gen";
import type { FormState } from "@/app/actions/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["cm", "td", "tp"];
const MINUTES = [0, 5, 10, 15, 20, 30, 45, 60];
const MAX_QCM_LESSONS = 10;

/**
 * Personal QCM: new questions generated from the chosen lessons' text for that student only (3 points), with no effect on the ranking.
 * Structure is validated automatically before saving, with a second attempt if too few valid questions come back.
 */
export async function generateQcm(_prev: FormState, fd: FormData): Promise<FormState> {
  const { t } = await getT();
  const userId = await getUserId();
  if (!userId) return { error: t("common.error") };
  const subjectId = String(fd.get("subject") ?? "");
  const kind = String(fd.get("kind") ?? "");
  const lessonIds = [...new Set(fd.getAll("lesson").map(String).filter((x) => UUID_RE.test(x)))];
  const count = parseCount(fd.get("count"), 1, 50);
  const difficulty = String(fd.get("difficulty") ?? "") as Difficulty;
  const minutes = Number(fd.get("minutes") ?? 0);
  const lang = asSessionLang(fd.get("lang"));
  if (!UUID_RE.test(subjectId) || count === null || !DIFFS.includes(difficulty) || !MINUTES.includes(minutes) || (kind && !KINDS.includes(kind)))
    return { error: t("common.error") };
  if (!lessonIds.length || lessonIds.length > MAX_QCM_LESSONS) return { error: lessonIds.length ? t("sum.tooMany").replace("{max}", String(MAX_QCM_LESSONS)) : t("sum.pickLessons") };

  const supabase = await createClient();
  // Lessons must belong to the chosen subject (and kind, if given) and be readable by the student (RLS).
  const { data: ls } = await supabase.from("lessons").select("id, subject_id, kind").in("id", lessonIds);
  if ((ls ?? []).length !== lessonIds.length || (ls ?? []).some((l) => l.subject_id !== subjectId || (kind && l.kind !== kind)))
    return { error: t("common.error") };

  const spent = await spendPoints(supabase, "qcm");
  if (!spent.ok) return { error: t(`ai.err.${spendErrorCode(spent)}`) };

  let setId: string | null = null;
  try {
    const mat = await loadMaterial(supabase, lessonIds, 24_000);
    if (!mat?.text) { await refundPoints(spent.ledgerId); return { error: t("ai.err.noMaterial") }; }

    // Do not repeat what was already generated for the same subject.
    const good = await generateQuestions({ mat, count, difficulty, lang, avoid: await recentStatements(supabase, subjectId) });
    // Accept slightly fewer than requested (80%) but never fewer than one question, and store the actual count.
    if (good.length < Math.max(1, Math.ceil(count * 0.8))) throw new Error("too_few_valid");

    const { data: coh } = await supabase.from("profiles").select("cohort_id").eq("id", userId).maybeSingle();
    const { data: set, error } = await supabase
      .from("ai_qcm_sets")
      .insert({ user_id: userId, cohort_id: coh?.cohort_id, subject_id: subjectId, kind: kind || null, lesson_ids: lessonIds, question_count: good.length, difficulty })
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
  redirect(`/assistant/qcm/${setId}${minutes ? `?t=${minutes}` : ""}`);
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
