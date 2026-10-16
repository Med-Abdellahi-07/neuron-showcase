import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, X, Minus } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { nowMs } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { ArenaRunner, type RunnerQuestion } from "@/components/arena-runner";
import { Rich } from "@/components/rich";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LETTERS = ["A", "B", "C", "D", "E", "F"];
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

interface ReviewItem {
  question_id: string;
  type: "mcq" | "written";
  difficulty: string;
  statement: string;
  options: string[] | null;
  correct_index: number | null;
  explanation: string | null;
  model_answer: string | null;
  answered: boolean;
  is_correct: boolean | null;
  selected_index: number | null;
  points: number | null;
  counted: boolean | null;
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  await requireUserId();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: attempt } = await supabase
    .from("attempts")
    .select("id, mode, question_ids, time_limit_seconds, started_at, finished_at, total, answered, correct, points")
    .eq("id", id)
    .maybeSingle();
  if (!attempt) notFound();

  const mode = attempt.mode as "free" | "ranked" | "review";
  const elapsed = (nowMs() - new Date(attempt.started_at).getTime()) / 1000;
  const expired = attempt.time_limit_seconds !== null && elapsed > attempt.time_limit_seconds + 5;
  const finished = !!attempt.finished_at || expired;

  // ───────── الملخص: بعد الانتهاء تُكشف الإجابات الصحيحة والشرح ─────────
  if (finished) {
    // انتهى الوقت دون إغلاق: أغلقها الآن كي تُكشف كل الأسئلة في المراجعة
    if (!attempt.finished_at) await supabase.rpc("finish_attempt", { p_attempt: id });
    const { data: review } = await supabase.rpc("attempt_review", { p_attempt: id });
    const items = (review ?? []) as ReviewItem[];
    const answered = items.filter((x) => x.answered).length;
    const correct = items.filter((x) => x.is_correct).length;
    const counted = items.filter((x) => x.counted);
    const countedPoints = counted.reduce((a, x) => a + Number(x.points ?? 0), 0);
    const wrong = items.filter((x) => x.answered && !x.is_correct).length;

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="page-title !mb-0">{t("arena.result.title")}</h1>
          <span className="badge">{t(`arena.mode.${mode}`)}</span>
        </div>

        <div className="card grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="tech text-3xl font-semibold text-accent" dir="ltr">{correct}/{attempt.total}</p>
            <p className="text-xs text-muted">{t("arena.result.correct")}</p>
          </div>
          <div>
            <p className="tech text-3xl font-semibold" dir="ltr">
              {mode === "ranked" ? fmt(countedPoints) : mode === "free" ? fmt(Number(attempt.points)) : "—"}
            </p>
            <p className="text-xs text-muted">{mode === "ranked" ? t("arena.result.rankedNote") : t("arena.result.points")}</p>
          </div>
          <div>
            <p className="tech text-3xl font-semibold" dir="ltr">{attempt.total - answered}</p>
            <p className="text-xs text-muted">{t("arena.result.unanswered")}</p>
          </div>
        </div>

        {mode === "ranked" && counted.length < answered && (
          <p className="text-xs text-muted">{t("arena.notCounted")} ({answered - counted.length})</p>
        )}
        {wrong > 0 && <p className="text-sm text-muted">{t("arena.result.mistakesSaved")}</p>}

        <ul className="space-y-3">
          {items.map((x, n) => (
            <li key={x.question_id} className="card space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span className="tech" dir="ltr">{n + 1}</span>
                <span className="flex items-center gap-2">
                  <span className="badge">{t(`diff.${x.difficulty as "easy"}`)}</span>
                  {!x.answered ? (
                    <Minus size={16} aria-label={t("arena.result.unanswered")} />
                  ) : x.is_correct ? (
                    <Check size={16} className="text-success" aria-label={t("practice.correct")} />
                  ) : (
                    <X size={16} className="text-danger" aria-label={t("practice.wrong")} />
                  )}
                </span>
              </div>
              <Rich>{x.statement}</Rich>
              {x.type === "mcq" && x.options && (
                <ul className="space-y-1.5 text-sm">
                  {x.options.map((opt, idx) => {
                    const right = idx === x.correct_index;
                    const mine = idx === x.selected_index;
                    return (
                      <li
                        key={idx}
                        className={`flex items-start gap-2 rounded-[var(--radius)] border p-2 ${
                          right ? "border-success bg-success/10" : mine ? "border-danger bg-danger/10" : "border-border"
                        }`}
                      >
                        <span className="tech shrink-0 text-xs" dir="ltr">{LETTERS[idx]}</span>
                        <span className="min-w-0 flex-1" dir="auto">{opt}</span>
                        {right && <span className="sr-only">{t("arena.result.correctAnswer")}</span>}
                        {mine && !right && <span className="sr-only">{t("arena.result.yourChoice")}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {x.type === "written" && x.model_answer && (
                <div>
                  <p className="label">{t("practice.modelAnswer")}</p>
                  <Rich>{x.model_answer}</Rich>
                </div>
              )}
              {x.explanation && (
                <div>
                  <p className="label">{t("practice.explanation")}</p>
                  <Rich>{x.explanation}</Rich>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <Link href="/practice" className="btn btn-primary">{t("arena.result.back")}</Link>
          {mode === "ranked" && <Link href="/practice/leaderboard" className="btn">{t("arena.result.ranking")}</Link>}
          {wrong > 0 && <Link href="/practice/mistakes" className="btn">{t("arena.tab.mistakes")}</Link>}
        </div>
      </div>
    );
  }

  // ───────── محاولة جارية ─────────
  const ids = attempt.question_ids as string[];
  const [{ data: qRows }, { data: ansRows }] = await Promise.all([
    supabase
      .from("questions")
      .select("id, type, difficulty, statement, options, model_answer")
      .in("id", ids),
    supabase.from("attempt_answers").select("question_id").eq("attempt_id", id),
  ]);
  const byId = new Map((qRows ?? []).map((r) => [r.id as string, r]));
  const questions: RunnerQuestion[] = ids
    .map((qid) => byId.get(qid))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({
      id: r.id as string,
      type: r.type as "mcq" | "written",
      difficulty: r.difficulty as "easy" | "medium" | "hard",
      statement: r.statement as string,
      options: r.options as string[] | null,
      // الحل النموذجي للمكتوب يلزم للمقارنة الذاتية؛ المكتوب لا يدخل الترتيب أصلاً
      model_answer: r.type === "written" ? (r.model_answer as string | null) : null,
    }));

  const answeredIds = new Set((ansRows ?? []).map((a) => a.question_id as string));
  const startIndex = Math.max(0, questions.findIndex((q) => !answeredIds.has(q.id)));
  const remaining =
    attempt.time_limit_seconds === null ? null : Math.max(0, Math.ceil(attempt.time_limit_seconds - elapsed));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="page-title !mb-0">{t(`arena.mode.${mode}`)}</h1>
        <Link href="/practice" className="text-sm text-accent hover:underline">{t("common.back")}</Link>
      </div>
      {mode === "free" && <p className="text-xs text-muted">{t("practice.free")}</p>}
      <ArenaRunner
        key={id}
        attemptId={id}
        mode={mode}
        questions={questions}
        startIndex={startIndex}
        remainingSeconds={remaining}
      />
    </div>
  );
}
