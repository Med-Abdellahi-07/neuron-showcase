"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";
import { getSubjectByCode } from "@/lib/data";
import { featureEnabled } from "@/lib/spaces";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN_ERRORS = ["no_questions", "not_enough_questions"];

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (fd: FormData, k: string) => {
  const n = parseInt(str(fd, k), 10);
  return Number.isNaN(n) ? null : n;
};

function backWithError(message: string | undefined, lesson?: string): never {
  const code = KNOWN_ERRORS.find((e) => message?.includes(e)) ?? "generic";
  const qs = new URLSearchParams({ err: code });
  if (lesson) qs.set("lesson", lesson);
  redirect(`/practice?${qs}`);
}

/** تدريب حر أو اختبار مصنّف: تُختار الأسئلة وتُنشأ المحاولة في قاعدة البيانات، ثم ينتقل الطالب إليها. */
export async function startAttempt(fd: FormData) {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const mode = str(fd, "mode") === "ranked" ? "ranked" : "free";
  if (mode === "ranked" && !(await featureEnabled("arena"))) redirect("/practice");
  const lessonRaw = str(fd, "lesson");
  const lesson = UUID_RE.test(lessonRaw) ? lessonRaw : null;
  const subjectCode = str(fd, "subject");
  const subject = subjectCode ? ((await getSubjectByCode(subjectCode)) ?? undefined) : undefined; // يشمل المواد المتبقية من L1
  const type = ["mcq", "written"].includes(str(fd, "type")) ? str(fd, "type") : "mixed";
  const difficulty = ["easy", "medium", "hard"].includes(str(fd, "difficulty")) ? str(fd, "difficulty") : null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_attempt", {
    p_mode: mode,
    p_subject: subject?.id ?? null,
    p_lesson: mode === "free" ? lesson : null,
    p_from: mode === "free" ? int(fd, "from") : null,
    p_to: mode === "free" ? int(fd, "to") : null,
    p_difficulty: mode === "free" ? difficulty : null,
    p_type: mode === "free" ? type : "mcq",
    p_count: mode === "free" ? (int(fd, "count") ?? 10) : 20,
    p_minutes: mode === "free" ? (int(fd, "minutes") ?? 0) : 20,
  });
  if (error || !data) {
    console.error("start_attempt failed:", error?.message);
    backWithError(error?.message, lesson ?? undefined);
  }
  redirect(`/practice/run/${data}`);
}

/** جلسة مراجعة الأسئلة المستحقة اليوم. */
export async function startReview() {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  if (!(await featureEnabled("review"))) redirect("/practice");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_attempt", { p_mode: "review", p_count: 15 });
  if (error || !data) {
    console.error("start_attempt(review) failed:", error?.message);
    redirect("/practice/mistakes");
  }
  redirect(`/practice/run/${data}`);
}

export interface AnswerResult {
  is_correct: boolean;
  correct_index: number | null;
  explanation: string | null;
  model_answer: string | null;
  points: number;
  base: number;
  bonus: number;
  counted: boolean;
  elapsed_ms: number;
  finished: boolean;
  repeat: boolean;
}

export type AnswerResponse = { ok: true; result: AnswerResult } | { ok: false; error: "expired" | "finished" | "failed" };

/** يُصحَّح السؤال وتُحسب نقاطه في قاعدة البيانات؛ المتصفح لا يحدد الصحة ولا النقاط. */
export async function answerQuestion(input: {
  attemptId: string;
  questionId: string;
  selected?: number | null;
  selfCorrect?: boolean | null;
  clientMs?: number | null;
}): Promise<AnswerResponse> {
  if (!UUID_RE.test(input.attemptId) || !UUID_RE.test(input.questionId)) return { ok: false, error: "failed" };
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "failed" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_answer", {
    p_attempt: input.attemptId,
    p_question: input.questionId,
    p_selected: input.selected ?? null,
    p_self_correct: input.selfCorrect ?? null,
    p_client_ms: input.clientMs != null && Number.isFinite(input.clientMs) ? Math.max(0, Math.round(input.clientMs)) : null,
  });
  if (error || !data) {
    const m = error?.message ?? "";
    if (m.includes("attempt_expired")) return { ok: false, error: "expired" };
    if (m.includes("attempt_finished")) return { ok: false, error: "finished" };
    console.error("submit_answer failed:", m);
    return { ok: false, error: "failed" };
  }
  return { ok: true, result: data as AnswerResult };
}

/** إنهاء المحاولة (مثلاً عند انتهاء الوقت). */
export async function finishAttempt(attemptId: string): Promise<boolean> {
  if (!UUID_RE.test(attemptId)) return false;
  const userId = await getUserId();
  if (!userId) return false;
  const supabase = await createClient();
  const { error } = await supabase.rpc("finish_attempt", { p_attempt: attemptId });
  if (error) console.error("finish_attempt failed:", error.message);
  return !error;
}
