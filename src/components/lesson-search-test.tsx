"use client";

import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";
import { reindexAll, runLessonSearch, type ReindexResult } from "@/app/actions/ai-admin";
import type { LessonSearchReport } from "@/lib/ai/lesson-diag";
import { useT } from "@/lib/i18n/client";

function Hits({ rows }: { rows: LessonSearchReport["vector"]["rows"] }) {
  const { t } = useT();
  return (
    <ul className="space-y-1.5">
      {rows.map((h, i) => (
        <li key={i} className="rounded border border-border p-2 text-xs">
          <p className="tech font-semibold" dir="ltr">{h.sim} — {h.where}</p>
          <p className="text-muted" dir="auto">{h.snippet}</p>
        </li>
      ))}
      {rows.length === 0 && <li className="text-xs text-muted">{t("ls.none")}</li>}
    </ul>
  );
}

export function LessonSearchTest({ subjects }: { subjects: string[] }) {
  const { t } = useT();
  const [query, setQuery] = useState("Qu'est-ce que l'apprentissage supervisé selon le cours ?");
  const [subject, setSubject] = useState("");
  const [rep, setRep] = useState<LessonSearchReport | null>(null);
  const [re, setRe] = useState<{ results: ReindexResult[]; remaining: number } | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    setErr("");
    try { setRep(await runLessonSearch(query, subject)); } catch { setErr(t("ls.failed")); }
  });
  const reindex = () => start(async () => {
    setErr("");
    try { setRe(await reindexAll()); setRep(await runLessonSearch(query, subject)); } catch { setErr(t("ls.reindexFailed")); }
  });

  return (
    <section className="card space-y-3" aria-labelledby="ls-h">
      <h3 id="ls-h" className="tech text-sm font-semibold">{t("ls.title")}</h3>
      <div className="grid grid-cols-3 gap-2">
        <input className="input col-span-2" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("ls.sample")} />
        <select className="input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={t("common.subject")}>
          <option value="">{t("ls.allSubjects")}</option>
          {subjects.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={run} disabled={pending} aria-busy={pending}>{pending ? "…" : t("ls.search")}</button>
        <button type="button" className="btn" onClick={reindex} disabled={pending}>{t("ls.reindexAll")}</button>
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}

      {re && (
        <div className="space-y-1 text-xs" aria-live="polite">
          {re.results.map((r, i) => (
            <p key={i} className={r.ok ? "" : "text-danger"} dir="auto">
              {r.ok ? <Check size={14} strokeWidth={1.9} className="inline text-success" aria-hidden /> : <X size={14} strokeWidth={1.9} className="inline text-danger" aria-hidden />} {r.name}: {r.chunks} {t("ls.chunks")} ({r.embedded ? t("ls.withVectors") : t("ls.noVectors")}) {r.error ?? ""}
            </p>
          ))}
          {re.remaining > 0 && <p className="text-warn">{re.remaining} {t("ls.remaining")}</p>}
        </div>
      )}

      {rep && (
        <div className="space-y-3 text-sm" aria-live="polite">
          <p className="rounded border border-border p-2 font-medium" dir="auto">{rep.verdict}</p>
          {rep.index && (
            <div className="space-y-1">
              <p className="tech text-xs" dir="ltr">
                PDF: {rep.index.pdfFiles} · {t("ls.indexed")}: {rep.index.indexedFiles} · {t("ls.chunks")}: {rep.index.chunks} · {t("ls.vectorsShort")}: {rep.index.withEmbedding} · {t("ls.threshold")}: {rep.threshold}
              </p>
              <ul className="space-y-1 text-xs">
                {rep.index.files.map((f, i) => (
                  <li key={i} dir="auto" className={f.error || f.chunks === 0 ? "text-warn" : ""}>
                    {f.lesson} / {f.name} — {f.chunks} {t("ls.chunks")} ({f.withEmbedding} {t("ls.vectorsShort")}){f.published ? "" : ` [${t("ls.unpublished")}]`}{f.error ? ` — ${f.error}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="tech text-xs" dir="ltr">
            embedding: {rep.embedding?.ok ? `OK (${rep.embedding.dims} dims)` : `FAIL ${rep.embedding?.error}`}
          </p>
          <div>
            <p className="label">{t("ls.semantic")}</p>
            {rep.vector.error && <p className="text-xs text-danger" dir="ltr">{rep.vector.error}</p>}
            <Hits rows={rep.vector.rows} />
          </div>
          <div>
            <p className="label">{t("ls.fulltext")}</p>
            {rep.text.error && <p className="text-xs text-danger" dir="ltr">{rep.text.error}</p>}
            <Hits rows={rep.text.rows} />
          </div>
        </div>
      )}
    </section>
  );
}
