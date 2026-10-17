"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Rich } from "@/components/rich";
import { useT } from "@/lib/i18n/client";
import { answerDuel, loadDuelQuestions, type DuelQuestion } from "@/app/actions/duel";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * جلسة Duel: سؤال واحد في كل مرة بلا أي كشف للصحة أثناء اللعب (حتى لا تتسرّب الإجابات).
 * تُحسب السرعة في الخادم. عند الانتهاء تُحدَّث الصفحة لتعرض الانتظار أو المقارنة.
 */
export function DuelRunner({ duelId, total }: { duelId: string; total: number }) {
  const { t } = useT();
  const router = useRouter();
  const [questions, setQuestions] = useState<DuelQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  const todo = questions?.filter((q) => !q.done) ?? [];
  const current = todo[0];
  const doneCount = total - todo.length;

  function start() {
    startTransition(async () => {
      const r = await loadDuelQuestions(duelId);
      if (!r.ok) {
        if (r.error === "finished" || r.error === "expired") router.refresh();
        else setError(t("duel.err.load"));
        return;
      }
      setQuestions(r.questions);
    });
  }

  function choose(i: number) {
    if (!current || busy.current) return;
    busy.current = true;
    setPicked(i);
    startTransition(async () => {
      const r = await answerDuel({ duelId, questionId: current.id, selected: i });
      busy.current = false;
      setPicked(null);
      if (!r.ok) {
        setError(t("duel.err.answer"));
        return;
      }
      setError(null);
      setQuestions((qs) => (qs ?? []).map((q) => (q.id === current.id ? { ...q, done: true } : q)));
      if (r.finished) router.refresh();
    });
  }

  if (!questions)
    return (
      <div className="card space-y-3 text-center">
        <p className="text-sm text-muted">{t("duel.readyHelp")}</p>
        <button type="button" className="btn btn-primary w-full" onClick={start} disabled={pending}>
          {t("duel.begin")}
        </button>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    );

  if (!current)
    return <p className="card text-center text-sm text-muted" role="status">{t("duel.saving")}</p>;

  const pct = Math.round((doneCount / total) * 100);
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="tech" dir="ltr">{doneCount + 1} / {total}</span>
          <span>{t("duel.noFeedback")}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="card space-y-4" key={current.id}>
        <Rich>{current.statement}</Rich>
        <ul className="space-y-2">
          {current.options.map((o, i) => (
            <li key={i}>
              <button
                type="button"
                disabled={pending}
                onClick={() => choose(i)}
                className={`flex min-h-12 w-full items-start gap-3 rounded-[var(--radius)] border p-3 text-start text-sm transition-colors ${
                  picked === i ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"
                }`}
              >
                <span className="tech mt-0.5 shrink-0 font-semibold text-accent" dir="ltr">{LETTERS[i]}</span>
                <span className="min-w-0" dir="auto"><Rich>{o}</Rich></span>
              </button>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
