"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, X } from "lucide-react";
import { Rich } from "@/components/rich";
import { useT } from "@/lib/i18n/client";
import { answerQuestion, finishAttempt, type AnswerResult } from "@/app/actions/arena";
import { gradeWrittenAnswer } from "@/app/actions/ai-grade";

export interface RunnerQuestion {
  id: string;
  type: "mcq" | "written";
  difficulty: "easy" | "medium" | "hard";
  statement: string;
  options: string[] | null;
  /** يُرسل فقط في التدريب الحر والمراجعة (المكتوب لا يدخل الترتيب أبداً) */
  model_answer: string | null;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

function clock(totalSeconds: number) {
  const s = Math.max(0, totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ArenaRunner({
  attemptId,
  mode,
  questions,
  startIndex,
  remainingSeconds,
}: {
  attemptId: string;
  mode: "free" | "ranked" | "review";
  questions: RunnerQuestion[];
  startIndex: number;
  remainingSeconds: number | null;
}) {
  const { t } = useT();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const ranked = mode === "ranked";

  const [i, setI] = useState(startIndex);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [showModel, setShowModel] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState<{ score: number; feedback: string; missing: string[] } | null>(null);
  const [left, setLeft] = useState<number | null>(remainingSeconds);
  const shownAt = useRef(0);
  const deadline = useRef<number | null>(null);
  const finishing = useRef(false);

  const q = questions[i];
  const last = i + 1 >= questions.length;

  function refreshToSummary() {
    startTransition(() => router.refresh());
  }

  // العدّاد: الخادم هو المرجع في قبول الإجابات، وهذا للعرض ولإنهاء المحاولة تلقائياً
  useEffect(() => {
    shownAt.current = Date.now();
    if (remainingSeconds === null) return;
    deadline.current = Date.now() + remainingSeconds * 1000;
    const tick = () => {
      const s = Math.max(0, Math.ceil(((deadline.current as number) - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0 && !finishing.current) {
        finishing.current = true;
        finishAttempt(attemptId).finally(refreshToSummary);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, remainingSeconds]);

  function advance() {
    setPicked(null);
    setResult(null);
    setShowModel(false);
    setText("");
    setGrade(null);
    setError(null);
    shownAt.current = Date.now();
    if (last) return refreshToSummary();
    setI((x) => x + 1);
  }

  async function submit(payload: { selected?: number; selfCorrect?: boolean }) {
    setBusy(true);
    setError(null);
    const res = await answerQuestion({
      attemptId,
      questionId: q.id,
      ...payload,
      clientMs: ranked ? null : Date.now() - shownAt.current,
    });
    setBusy(false);
    if (!res.ok) {
      if (res.error === "expired" || res.error === "finished") return refreshToSummary();
      return setError(t("arena.errorRetry"));
    }
    // الاختبار المصنّف: لا حل أثناءه، ننتقل مباشرة للسؤال التالي
    if (ranked) {
      if (res.result.finished || last) return refreshToSummary();
      setPicked(null);
      shownAt.current = Date.now();
      setI((x) => x + 1);
      return;
    }
    setResult(res.result);
  }

  async function aiGrade() {
    setBusy(true);
    setError(null);
    const res = await gradeWrittenAnswer({ attemptId, questionId: q.id, answer: text, clientMs: Date.now() - shownAt.current });
    setBusy(false);
    if (!res.ok) {
      if (res.error === "expired" || res.error === "finished") return refreshToSummary();
      return setError(res.error === "busy" ? t("chat.busy") : t("grade.unavailable"));
    }
    setGrade({ score: res.score, feedback: res.feedback, missing: res.missing });
    setShowModel(true);
    setResult(res.result);
  }

  if (!q) return null;
  const isMcq = q.type === "mcq";
  const urgent = left !== null && left <= 60;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="tech" dir="ltr">
          {i + 1} / {questions.length}
        </span>
        <div className="flex items-center gap-2">
          {left !== null && (
            <span
              className={`tech inline-flex items-center gap-1 ${urgent ? "font-semibold text-danger" : ""}`}
              dir="ltr"
              role="timer"
              aria-label={t("arena.timeLeft")}
            >
              <Clock size={14} aria-hidden /> {clock(left)}
            </span>
          )}
          <span className="badge">{t(`diff.${q.difficulty}`)}</span>
        </div>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={i + 1}
        aria-valuemin={1}
        aria-valuemax={questions.length}
      >
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((i + 1) / questions.length) * 100}%` }} />
      </div>

      <div className="card space-y-4">
        <Rich>{q.statement}</Rich>

        {isMcq && q.options && (
          <ul className="space-y-2" role="radiogroup" aria-label={t("arena.question")}>
            {q.options.map((opt, idx) => {
              const isPicked = picked === idx;
              const isRight = !!result && idx === result.correct_index;
              const isWrong = !!result && isPicked && idx !== result.correct_index;
              return (
                <li key={idx}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isPicked}
                    disabled={!!result || busy}
                    onClick={() => setPicked(idx)}
                    className={`flex w-full items-start gap-3 rounded-[var(--radius)] border p-3 text-start text-sm transition-colors ${
                      isRight
                        ? "border-success bg-success/10"
                        : isWrong
                          ? "border-danger bg-danger/10"
                          : isPicked
                            ? "border-accent bg-accent-soft"
                            : "border-border hover:bg-surface-2"
                    }`}
                  >
                    <span className="tech flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs" dir="ltr">
                      {LETTERS[idx]}
                    </span>
                    <span className="min-w-0 flex-1" dir="auto">{opt}</span>
                    {isRight && <Check size={18} className="shrink-0 text-success" aria-hidden />}
                    {isWrong && <X size={18} className="shrink-0 text-danger" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!isMcq && (
          <div className="space-y-2">
            <label className="label" htmlFor="written">{t("practice.yourAnswer")}</label>
            <textarea
              id="written"
              className="input min-h-32"
              dir="auto"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={showModel}
            />
          </div>
        )}
      </div>

      {ranked && <p className="text-xs text-muted">{t("arena.noFeedback")}</p>}

      {result && isMcq && (
        <div role="status" className={`card space-y-2 text-sm ${result.is_correct ? "border-success" : "border-danger"}`}>
          <p className={`font-semibold ${result.is_correct ? "text-success" : "text-danger"}`}>
            {result.is_correct ? t("practice.correct") : t("practice.wrong")}
            {Number(result.points) > 0 && mode === "free" && (
              <span className="tech ms-2 font-normal" dir="ltr">
                +{fmt(Number(result.points))} {t("arena.points")}
                {Number(result.bonus) > 0 && ` (${t("arena.speedBonus")} +${fmt(Number(result.bonus))})`}
              </span>
            )}
          </p>
          {result.explanation && (
            <div>
              <p className="label">{t("practice.explanation")}</p>
              <Rich>{result.explanation}</Rich>
            </div>
          )}
        </div>
      )}

      {!isMcq && showModel && (
        <div className="card space-y-2 border-accent">
          <p className="label">{t("practice.modelAnswer")}</p>
          <Rich>{q.model_answer ?? ""}</Rich>
          {result?.explanation && (
            <>
              <p className="label">{t("practice.explanation")}</p>
              <Rich>{result.explanation}</Rich>
            </>
          )}
        </div>
      )}

      {grade && (
        <div role="status" className="card space-y-2 text-sm">
          <p className="tech font-semibold" dir="ltr">{t("grade.score")}: {grade.score}/100</p>
          <p dir="auto">{grade.feedback}</p>
          {grade.missing.length > 0 && (
            <ul className="list-disc ps-5 text-muted" dir="auto">
              {grade.missing.map((m, k) => <li key={k}>{m}</li>)}
            </ul>
          )}
          <p className="text-[11px] text-muted">{t("grade.aiNote")}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {isMcq && !result && (
          <button type="button" className="btn btn-primary" disabled={picked === null || busy} aria-busy={busy} onClick={() => submit({ selected: picked as number })}>
            {ranked ? (last ? t("arena.finish") : t("arena.next")) : t("arena.confirm")}
          </button>
        )}
        {!isMcq && !showModel && (
          <>
            <button type="button" className="btn" onClick={() => setShowModel(true)}>
              {t("practice.showAnswer")}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} aria-busy={busy} onClick={aiGrade}>
              {busy ? t("grade.grading") : t("grade.cta")}
            </button>
          </>
        )}
        {!isMcq && showModel && !result && !grade && (
          <div className="flex w-full flex-col gap-2 sm:w-auto">
            <p className="text-xs text-muted">{t("arena.selfJudge")}</p>
            <div className="flex gap-2">
              <button type="button" className="btn" disabled={busy} onClick={() => submit({ selfCorrect: false })}>
                {t("arena.iMissed")}
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit({ selfCorrect: true })}>
                {t("arena.iGotIt")}
              </button>
            </div>
          </div>
        )}
        {result && (
          <button type="button" className="btn btn-primary" onClick={advance}>
            {last ? t("arena.finish") : t("arena.next")}
          </button>
        )}
      </div>
    </div>
  );
}
