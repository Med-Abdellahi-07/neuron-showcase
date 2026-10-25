"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CloudOff, ExternalLink, FileText, ListChecks, NotebookText, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { addScore, listPacks, listScores, removePack, storageEstimate } from "@/lib/offline/db";
import { gradeLocal } from "@/lib/offline/grade";
import type { OfflinePack, OfflineQuestion, OfflineScore } from "@/lib/offline/types";
import { Rich } from "@/components/rich";
import { Flashcards } from "@/components/flashcards";

const mb = (n: number) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;
const packSize = (p: OfflinePack) => p.pdfs.reduce((a, f) => a + f.blob.size, 0);

export function OfflineLibrary() {
  const { t } = useT();
  const [packs, setPacks] = useState<OfflinePack[] | null>(null);
  const [scores, setScores] = useState<OfflineScore[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [est, setEst] = useState<{ used: number; quota: number } | null>(null);
  const [online, setOnline] = useState(true);

  const load = useCallback(async () => {
    try {
      setPacks((await listPacks()).sort((a, b) => b.savedAt - a.savedAt));
      setScores(await listScores());
    } catch {
      setPacks([]);
    }
    setEst(await storageEstimate());
  }, []);

  useEffect(() => {
    // قراءة IndexedDB (نظام خارجي) ثم ضبط الحالة
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const up = () => setOnline(navigator.onLine);
    up();
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", up); };
  }, [load]);

  const pack = packs?.find((p) => p.id === open) ?? null;

  if (pack)
    return (
      <PackView
        pack={pack}
        scores={scores.filter((s) => s.lessonId === pack.id)}
        onBack={() => setOpen(null)}
        onScore={async (s) => { await addScore(s); setScores(await listScores()); }}
      />
    );

  return (
    <>
      <header className="space-y-1">
        <h1 className="page-title !mb-0 flex items-center gap-2"><CloudOff size={22} aria-hidden /> {t("off.title")}</h1>
        <p className="text-sm text-muted">{online ? t("off.onlineHint") : t("off.offlineHint")}</p>
        {est && est.quota > 0 && <p className="tech text-xs text-muted" dir="ltr">{mb(est.used)} / {mb(est.quota)}</p>}
      </header>

      {packs === null && <p className="text-sm text-muted">…</p>}
      {packs?.length === 0 && <p className="card text-sm text-muted">{t("off.empty")}</p>}
      <ul className="space-y-2">
        {packs?.map((p) => (
          <li key={p.id} className="card flex items-center gap-3 !p-3">
            <button type="button" onClick={() => setOpen(p.id)} className="min-w-0 flex-1 text-start">
              <span className="block truncate text-sm font-semibold" dir="auto">{p.kind.toUpperCase()} {p.number} — {p.title}</span>
              <span className="block truncate text-xs text-muted" dir="auto">
                {p.subject} · {p.pdfs.length} PDF · {p.questions.length} QCM · {p.summaries.length} {t("off.summaries")} · {mb(packSize(p))}
              </span>
            </button>
            <button type="button" className="btn btn-sm !px-2" aria-label={t("off.remove")} onClick={async () => { await removePack(p.id); load(); }}>
              <Trash2 size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {online && <Link href="/" className="btn w-full"><ArrowLeft size={16} className="rtl:rotate-180" aria-hidden /> {t("off.backApp")}</Link>}
    </>
  );
}

type Tab = "pdf" | "qcm" | "sum";

function PackView({ pack, scores, onBack, onScore }: { pack: OfflinePack; scores: OfflineScore[]; onBack: () => void; onScore: (s: OfflineScore) => Promise<void> }) {
  const { t } = useT();
  const first: Tab = pack.pdfs.length ? "pdf" : pack.questions.length ? "qcm" : "sum";
  const [tab, setTab] = useState<Tab>(first);
  const tabs: { id: Tab; label: string; n: number; icon: typeof FileText }[] = [
    { id: "pdf", label: "PDF", n: pack.pdfs.length, icon: FileText },
    { id: "qcm", label: "QCM", n: pack.questions.length, icon: ListChecks },
    { id: "sum", label: t("off.summaries"), n: pack.summaries.length, icon: NotebookText },
  ];
  return (
    <>
      <button type="button" onClick={onBack} className="text-sm text-accent">← {t("off.title")}</button>
      <h1 className="page-title !mb-0" dir="auto">{pack.kind.toUpperCase()} {pack.number} — {pack.title}</h1>
      <div role="tablist" className="flex gap-2">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} disabled={!x.n} onClick={() => setTab(x.id)}
            className={`btn btn-sm flex-1 ${tab === x.id ? "btn-primary" : ""}`}>
            <x.icon size={14} aria-hidden /> {x.label} ({x.n})
          </button>
        ))}
      </div>
      {tab === "pdf" && <PdfTab pack={pack} />}
      {tab === "qcm" && <QcmTab pack={pack} scores={scores} onScore={onScore} />}
      {tab === "sum" && (
        <div className="space-y-4">
          {pack.summaries.map((s) =>
            s.kind === "flashcards" && s.cards?.length ? (
              <section key={s.id} className="space-y-2"><h2 className="text-sm font-semibold" dir="auto">{s.title}</h2><Flashcards cards={s.cards} /></section>
            ) : (
              <article key={s.id} className="card"><h2 className="mb-2 text-sm font-semibold" dir="auto">{s.title}</h2><Rich>{s.content}</Rich></article>
            )
          )}
        </div>
      )}
    </>
  );
}

function PdfTab({ pack }: { pack: OfflinePack }) {
  const { t } = useT();
  // عناوين blob تُنشأ مرة وتُحرَّر عند المغادرة
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    // blob URLs موارد خارجية: تُنشأ عند الدخول وتُحرَّر عند الخروج
    const u = pack.pdfs.map((f) => URL.createObjectURL(f.blob));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [pack]);
  return (
    <div className="space-y-4">
      {pack.pdfs.map((f, i) => (
        <div key={f.name + i} className="space-y-2">
          {urls[i] && <iframe src={urls[i]} title={f.name} className="h-[70vh] w-full rounded-[var(--radius)] border border-border bg-surface-2" />}
          <div className="flex items-center justify-between gap-2">
            <span className="tech truncate text-xs text-muted" dir="ltr">{f.name}</span>
            {urls[i] && <a href={urls[i]} target="_blank" rel="noopener noreferrer" className="btn btn-sm"><ExternalLink size={14} aria-hidden /> {t("common.open")}</a>}
          </div>
        </div>
      ))}
    </div>
  );
}

function QcmTab({ pack, scores, onScore }: { pack: OfflinePack; scores: OfflineScore[]; onScore: (s: OfflineScore) => Promise<void> }) {
  const { t } = useT();
  const [run, setRun] = useState(0);
  const last = scores[scores.length - 1];
  return (
    <div className="space-y-3">
      {last && <p className="tech text-xs text-muted">{t("off.lastScore")}: {last.correct}/{last.total} · {new Date(last.at).toLocaleDateString()}</p>}
      <QcmRun key={run} questions={pack.questions} lessonId={pack.id} onScore={onScore} onAgain={() => setRun((x) => x + 1)} />
    </div>
  );
}

function QcmRun({ questions, lessonId, onScore, onAgain }: { questions: OfflineQuestion[]; lessonId: string; onScore: (s: OfflineScore) => Promise<void>; onAgain: () => void }) {
  const { t } = useT();
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const q = questions[i];
  const done = i >= questions.length;
  const result = useMemo(() => (done ? gradeLocal(questions, answers) : null), [done, questions, answers]);

  function next() {
    const a = [...answers, picked ?? -1];
    setAnswers(a);
    setPicked(null);
    setI(i + 1);
    if (i + 1 >= questions.length) {
      const g = gradeLocal(questions, a);
      onScore({ lessonId, at: Date.now(), correct: g.correct, total: g.total });
    }
  }

  if (done && result)
    return (
      <div className="card space-y-3 text-center">
        <p className="text-3xl font-bold" dir="ltr">{result.correct}/{result.total}</p>
        <p className="text-sm text-muted">{result.pct}%</p>
        <button type="button" onClick={onAgain} className="btn btn-primary w-full">{t("off.again")}</button>
        <p className="text-xs text-muted">{t("off.localOnly")}</p>
      </div>
    );

  return (
    <div className="card space-y-3">
      <p className="tech text-xs text-muted" dir="ltr">{i + 1}/{questions.length}</p>
      <Rich>{q.statement}</Rich>
      <ul className="space-y-2">
        {q.options.map((o, k) => {
          const shown = picked !== null;
          const cls = !shown ? "" : k === q.correct ? "!border-success bg-success/10" : k === picked ? "!border-danger bg-danger/10" : "";
          return (
            <li key={k}>
              <button type="button" disabled={shown} onClick={() => setPicked(k)} className={`btn w-full !justify-start text-start ${cls}`}>
                <span className="tech font-semibold">{String.fromCharCode(65 + k)}.</span> <span className="min-w-0" dir="auto"><Rich>{o}</Rich></span>
              </button>
            </li>
          );
        })}
      </ul>
      {picked !== null && (
        <>
          {q.explanation && <div className="rounded-[var(--radius)] bg-accent-soft p-3"><Rich>{q.explanation}</Rich></div>}
          <button type="button" onClick={next} className="btn btn-primary w-full">{i + 1 >= questions.length ? t("off.finish") : t("off.next")}</button>
        </>
      )}
    </div>
  );
}
