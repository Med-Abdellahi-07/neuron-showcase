"use client";

import { useEffect, useState, useTransition } from "react";
import { Bot, Flag, Timer } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/components/rich";
import { answerAiQuestion, reportAiQuestion } from "@/app/actions/ai-qcm";

export interface AiQ {
  id: string;
  statement: string;
  options: string[];
  page: number | null;
  lesson: string | null;
  /** إن كان قد أُجيب عنه من قبل (عند إعادة فتح المجموعة) */
  selected: number | null;
  correctIndex: number | null; // يُرسل فقط للأسئلة المُجاب عنها
  explanation: string | null;
  reported: boolean;
}
type Res = { selected: number; correctIndex: number; explanation: string };

/** تشغيل أسئلة QCM المولّدة: التصحيح في الخادم (الإجابة الصحيحة لا تصل المتصفح قبل الإجابة) */
export function AiQcmRunner({ questions, minutes = 0, setId = "" }: { questions: AiQ[]; minutes?: number; setId?: string }) {
  const { t } = useT();
  const [res, setRes] = useState<Record<string, Res>>(() =>
    Object.fromEntries(questions.filter((q) => q.selected !== null && q.correctIndex !== null).map((q) => [q.id, { selected: q.selected!, correctIndex: q.correctIndex!, explanation: q.explanation ?? "" }]))
  );
  const [reported, setReported] = useState<Set<string>>(new Set(questions.filter((q) => q.reported).map((q) => q.id)));
  const [i, setI] = useState(() => Math.max(0, questions.findIndex((q) => q.selected === null)));
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const q = questions[i];
  const r = q ? res[q.id] : undefined;
  const allAnswered = questions.every((x) => res[x.id]);

  // مؤقت اختياري: تُحفظ نهاية الوقت في sessionStorage كي لا يُعاد ضبطه بإعادة تحميل الصفحة
  const timed = minutes > 0 && !!setId && !questions.every((x) => x.selected !== null);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!timed) return;
    const key = `neuron-aiq-end-${setId}`;
    let end = 0;
    try { end = Number(sessionStorage.getItem(key)) || 0; } catch { /* خاص */ }
    if (!end) {
      end = Date.now() + minutes * 60_000;
      try { sessionStorage.setItem(key, String(end)); } catch { /* خاص */ }
    }
    const tick = () => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timed, minutes, setId]);
  const expired = timed && left === 0 && !allAnswered;
  const done = allAnswered || expired;
  const score = questions.filter((x) => res[x.id] && res[x.id].selected === res[x.id].correctIndex).length;

  function pick(idx: number) {
    if (!q || r || pending || expired) return;
    setErr("");
    start(async () => {
      const a = await answerAiQuestion(q.id, idx);
      if (!a.ok || a.correctIndex === undefined) { setErr(t("common.error")); return; }
      setRes((m) => ({ ...m, [q.id]: { selected: idx, correctIndex: a.correctIndex!, explanation: a.explanation ?? "" } }));
    });
  }

  if (!q) return <p className="text-sm text-muted">{t("aiq.dueEmpty")}</p>;
  return (
    <div className="space-y-3">
      {timed && left !== null && !allAnswered && (
        <p role="timer" aria-live="off" className={`tech flex items-center justify-center gap-2 rounded-xl py-2 text-lg font-semibold ${left <= 60 ? "bg-urgent-bg text-urgent" : "bg-accent-soft text-accent"}`} dir="ltr">
          <Timer size={18} aria-hidden /> {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
        </p>
      )}
      {expired && <p role="status" className="card text-center text-sm font-semibold text-urgent">{t("aiq.timeUp")}</p>}
      {done && (
        <section className="card space-y-1 text-center" aria-label={t("aiq.result")}>
          <p className="text-xs text-muted">{t("aiq.result")}</p>
          <p className="tech text-3xl font-bold text-accent" dir="ltr">{score} / {questions.length}</p>
          <p className="tech text-sm text-muted" dir="ltr">{questions.length ? Math.round((score / questions.length) * 100) : 0}% · {Object.keys(res).length} {t("aiq.answered")}</p>
        </section>
      )}
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="tech" dir="ltr">{i + 1} / {questions.length}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5"><Bot size={12} aria-hidden /> {t("aiq.badge")}</span>
      </div>
      <div className="card space-y-3">
        <Rich>{q.statement}</Rich>
        <ul className="space-y-2" role="list">
          {q.options.map((o, idx) => {
            const state = r ? (idx === r.correctIndex ? "ok" : idx === r.selected ? "bad" : "") : "";
            return (
              <li key={idx}>
                <button type="button" onClick={() => pick(idx)} disabled={!!r || pending} aria-pressed={r?.selected === idx}
                  className={`flex w-full items-start gap-2 rounded-xl border p-3 text-start text-sm ${state === "ok" ? "border-success bg-success/10" : state === "bad" ? "border-danger bg-danger/10" : "border-line hover:bg-surface-2"}`}>
                  <span className="tech text-xs text-muted">{String.fromCharCode(65 + idx)}</span>
                  <span dir="auto">{o}</span>
                  {state === "ok" && <span className="sr-only">{t("aiq.correct")}</span>}
                  {state === "bad" && <span className="sr-only">{t("aiq.wrong")}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        {r && (
          <div role="status" className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
            <p className="font-semibold">{r.selected === r.correctIndex ? t("aiq.correct") : t("aiq.wrong")}</p>
            <Rich>{r.explanation}</Rich>
            {(q.lesson || q.page) && <p className="tech text-xs text-muted">{q.lesson}{q.page ? ` · p. ${q.page}` : ""}</p>}
            {reported.has(q.id) ? (
              <p className="text-xs text-muted">{t("aiq.reportSent")}</p>
            ) : (
              <form action={async (fd) => { await reportAiQuestion(fd); setReported((s) => new Set(s).add(q.id)); }} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={q.id} />
                <input name="note" maxLength={300} className="input !h-8 flex-1 text-xs" placeholder={t("aiq.reportNote")} aria-label={t("aiq.reportNote")} />
                <button className="btn btn-sm" type="submit"><Flag size={12} aria-hidden /> {t("aiq.report")}</button>
              </form>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" className="btn btn-sm" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>{t("common.back")}</button>
        {i < questions.length - 1 ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setI((x) => x + 1)} disabled={!r}>{t("sum.next")}</button>
        ) : done ? (
          <p role="status" className="tech text-sm font-semibold" dir="ltr">{score} / {questions.length}</p>
        ) : null}
      </div>
    </div>
  );
}
