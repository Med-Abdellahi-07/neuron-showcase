"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { importQuestions, type ImportOutcome } from "@/app/actions/content";
import { QUESTION_CSV_EXAMPLE, QUESTION_PROMPT, parseQuestionInput, type ImportError } from "@/lib/question-import";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dictionaries";

function CopyButton({ value }: { value: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* الحافظة غير متاحة */
        }
      }}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? t("q.copied") : t("q.copy")}
    </button>
  );
}

const fmtError = (e: ImportError, t: (k: DictKey) => string) => [...e.keys.map((k) => t(k)), e.detail].filter(Boolean).join(" — ");

export function QuestionImporter() {
  const { t } = useT();
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const [count, setCount] = useState(20);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, start] = useTransition();

  const parsed = useMemo(() => parseQuestionInput(raw), [raw]);
  const prompt = QUESTION_PROMPT.replace("{N}", String(count));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setRaw(await file.text());
  }

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <h2 className="tech text-sm font-semibold">{t("q.template")}</h2>
        <p className="text-xs text-muted">{t("q.templateHint")}</p>
        <div className="flex items-center gap-2">
          <label className="label !mb-0" htmlFor="n">N</label>
          <input id="n" type="number" min={5} max={100} value={count} onChange={(e) => setCount(Number(e.target.value) || 20)} className="input !w-20" dir="ltr" />
          <CopyButton value={prompt} />
        </div>
        <textarea readOnly className="input min-h-40 font-mono text-xs" dir="ltr" value={prompt} aria-label="Prompt" />
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted">CSV</p>
          <CopyButton value={QUESTION_CSV_EXAMPLE} />
        </div>
        <textarea readOnly className="input min-h-24 font-mono text-xs" dir="ltr" value={QUESTION_CSV_EXAMPLE} aria-label="CSV example" />
      </section>

      <section className="card space-y-3">
        <label className="label" htmlFor="raw">{t("q.paste")}</label>
        <textarea
          id="raw"
          className="input min-h-48 font-mono text-xs"
          dir="ltr"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setOutcome(null);
          }}
        />
        <div>
          <label className="label" htmlFor="qfile">{t("q.uploadFile")}</label>
          <input id="qfile" type="file" accept=".json,.csv,text/csv,application/json" onChange={onFile} className="input !py-1.5" />
        </div>

        {raw.trim() && (
          <div className="space-y-2 text-sm" aria-live="polite">
            <p className="tech">
              <span className="text-success">{parsed.valid.length} {t("q.valid")}</span>
              {" · "}
              <span className={parsed.errors.length ? "text-danger" : "text-muted"}>{parsed.errors.length} {t("q.invalid")}</span>
            </p>
            {parsed.errors.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-auto rounded-[var(--radius)] bg-surface-2 p-3 text-xs">
                {parsed.errors.slice(0, 30).map((e, i) => (
                  <li key={i}><span className="tech text-danger">#{e.row}</span> {fmtError(e, t)}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || parsed.valid.length === 0}
          onClick={() =>
            start(async () => {
              const res = await importQuestions(raw);
              setOutcome(res);
              if (res.inserted > 0) {
                setRaw("");
                router.refresh();
              }
            })
          }
        >
          {t("q.importBtn")} ({parsed.valid.length})
        </button>

        {outcome && (
          <div role="status" className="space-y-1 text-sm">
            <p className="text-success">{t("q.imported")} {outcome.inserted}</p>
            {outcome.unlinked > 0 && <p className="text-xs text-warn">{outcome.unlinked} — {t("q.unlinked")}</p>}
            {outcome.errors.slice(0, 10).map((e, i) => (
              <p key={i} className="text-xs text-danger">#{e.row} {fmtError(e, t)}</p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
