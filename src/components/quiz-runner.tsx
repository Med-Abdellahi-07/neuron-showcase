"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Rich } from "@/components/rich";
import { useT } from "@/lib/i18n/client";

export interface QuizQuestion {
  id: string;
  type: "mcq" | "written";
  difficulty: "easy" | "medium" | "hard";
  statement: string;
  options: string[] | null;
  correct_index: number | null;
  model_answer: string | null;
  explanation: string | null;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function QuizRunner({ questions }: { questions: QuizQuestion[] }) {
  const { t } = useT();
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [text, setText] = useState("");
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const q = questions[i];
  const mcqTotal = questions.filter((x) => x.type === "mcq").length;

  function next() {
    if (i + 1 >= questions.length) return setDone(true);
    setI(i + 1);
    setPicked(null);
    setRevealed(false);
    setText("");
  }

  function check() {
    if (picked === null) return;
    setRevealed(true);
    if (picked === q.correct_index) setScore((s) => s + 1);
  }

  function reset() {
    setI(0);
    setPicked(null);
    setRevealed(false);
    setText("");
    setScore(0);
    setDone(false);
  }

  if (done) {
    return (
      <div className="card space-y-4 text-center">
        <h2 className="tech text-lg font-semibold">{t("practice.result")}</h2>
        {mcqTotal > 0 && (
          <p className="tech text-4xl font-semibold text-accent" dir="ltr">
            {score}/{mcqTotal}
          </p>
        )}
        <button type="button" onClick={reset} className="btn btn-primary">
          {t("practice.retry")}
        </button>
      </div>
    );
  }

  const isMcq = q.type === "mcq";
  const correct = isMcq && picked === q.correct_index;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="tech" dir="ltr">
          {i + 1} / {questions.length}
        </span>
        <span className="badge">{t(`diff.${q.difficulty}`)}</span>
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
          <ul className="space-y-2" role="radiogroup" aria-label={t("practice.question")}>
            {q.options.map((opt, idx) => {
              const isPicked = picked === idx;
              const isRight = revealed && idx === q.correct_index;
              const isWrong = revealed && isPicked && idx !== q.correct_index;
              return (
                <li key={idx}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isPicked}
                    disabled={revealed}
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
            <textarea id="written" className="input min-h-32" dir="auto" value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-xs text-muted">{t("practice.writtenNote")}</p>
          </div>
        )}
      </div>

      {revealed && isMcq && (
        <div role="status" className={`card text-sm ${correct ? "border-success" : "border-danger"}`}>
          <p className={`font-semibold ${correct ? "text-success" : "text-danger"}`}>
            {correct ? t("practice.correct") : t("practice.wrong")}
          </p>
          {q.explanation && (
            <div className="mt-2">
              <p className="label">{t("practice.explanation")}</p>
              <Rich>{q.explanation}</Rich>
            </div>
          )}
        </div>
      )}

      {revealed && !isMcq && (
        <div className="card space-y-2 border-accent">
          <p className="label">{t("practice.modelAnswer")}</p>
          <Rich>{q.model_answer ?? ""}</Rich>
          {q.explanation && (
            <>
              <p className="label">{t("practice.explanation")}</p>
              <Rich>{q.explanation}</Rich>
            </>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {isMcq && !revealed && (
          <button type="button" className="btn btn-primary" disabled={picked === null} onClick={check}>
            {t("practice.check")}
          </button>
        )}
        {!isMcq && !revealed && (
          <button type="button" className="btn btn-primary" onClick={() => setRevealed(true)}>
            {t("practice.showAnswer")}
          </button>
        )}
        {revealed && (
          <button type="button" className="btn btn-primary" onClick={next}>
            {i + 1 >= questions.length ? t("practice.finish") : t("practice.next")}
          </button>
        )}
      </div>
    </div>
  );
}
