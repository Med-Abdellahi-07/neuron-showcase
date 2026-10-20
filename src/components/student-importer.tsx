"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download } from "lucide-react";
import Papa from "papaparse";
import { bulkCreateStudents, type BulkOutcome } from "@/app/actions/accounts";
import { ACCOUNT_CSV_EXAMPLE, MAX_ACCOUNT_ROWS, parseAccountRows } from "@/lib/account-import";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dictionaries";

/** نص المعرّف+كلمة السر لكل طالب: يُعرض مرة واحدة فقط بعد الإنشاء كي يسلّمه المشرف للطلاب. */
const credentialsCsv = (o: BulkOutcome) =>
  Papa.unparse({ fields: ["full_name", "identifier", "password"], data: o.created.map((c) => [c.full_name, c.identifier, c.password]) });

export function StudentImporter() {
  const { t } = useT();
  const router = useRouter();
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState("");
  const [readError, setReadError] = useState(false);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const parsed = useMemo(() => parseAccountRows(rows), [rows]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setOutcome(null);
    setReadError(false);
    if (!file) return;
    setFileName(file.name);
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        const sheet = await readSheet(file); // أول ورقة
        setRows(sheet.map((r) => r.map((c) => String(c ?? ""))));
      } else {
        const res = Papa.parse<string[]>(await file.text(), { skipEmptyLines: true });
        setRows(res.data.map((r) => r.map((c) => String(c ?? ""))));
      }
    } catch {
      setRows([]);
      setReadError(true);
    }
  }

  const errText = (e: BulkOutcome["errors"][number]) => [`#${e.row}`, t(e.key as DictKey), e.detail].filter(Boolean).join(" — ");

  return (
    <section className="card space-y-4">
      <div>
        <h2 className="tech text-sm font-semibold">{t("acc.bulk.title")}</h2>
        <p className="mt-1 text-xs text-muted">{t("acc.bulk.help").replace("{n}", String(MAX_ACCOUNT_ROWS))}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted">{t("acc.bulk.example")}</p>
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(ACCOUNT_CSV_EXAMPLE);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* الحافظة غير متاحة */
              }
            }}
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? t("q.copied") : t("q.copy")}
          </button>
        </div>
        <textarea readOnly className="input min-h-20 font-mono text-xs" dir="ltr" value={ACCOUNT_CSV_EXAMPLE} aria-label="CSV example" />
      </div>

      <div>
        <label className="label" htmlFor="acc-file">{t("acc.bulk.file")}</label>
        <input id="acc-file" type="file" accept=".csv,.xlsx,text/csv" onChange={onFile} className="input" />
        {fileName && <p className="mt-1 text-xs text-muted" dir="ltr">{fileName}</p>}
        {readError && <p role="alert" className="mt-1 text-sm text-danger">{t("acc.bulk.readError")}</p>}
      </div>

      {rows.length > 0 && !outcome && (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="tech font-semibold text-accent" dir="ltr">{parsed.valid.length}</span> {t("acc.bulk.valid")}
            {parsed.errors.length > 0 && <> · <span className="tech font-semibold text-danger" dir="ltr">{parsed.errors.length}</span> {t("acc.bulk.invalid")}</>}
          </p>
          {parsed.tooMany && <p className="text-sm text-warn">{t("acc.bulk.tooMany").replace("{n}", String(MAX_ACCOUNT_ROWS))}</p>}
          {parsed.errors.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-auto text-xs text-danger">
              {parsed.errors.slice(0, 30).map((e, i) => (
                <li key={i}>{errText(e)}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || parsed.valid.length === 0}
            onClick={() =>
              start(async () => {
                const res = await bulkCreateStudents(rows);
                setOutcome(res);
                router.refresh();
              })
            }
          >
            {pending ? t("common.loading") : t("acc.bulk.create").replace("{n}", String(parsed.valid.length))}
          </button>
        </div>
      )}

      {outcome && (
        <div className="space-y-3" role="status">
          <p className="text-sm font-medium">
            {t("acc.bulk.done").replace("{n}", String(outcome.created.length))}
            {outcome.errors.length > 0 && <> · {t("acc.bulk.failed").replace("{n}", String(outcome.errors.length))}</>}
          </p>
          {outcome.created.length > 0 && (
            <>
              <p className="rounded-xl bg-accent-soft p-3 text-xs">{t("acc.bulk.saveNow")}</p>
              <a
                className="btn btn-sm"
                download="neuron-accounts.csv"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + credentialsCsv(outcome))}`}
              >
                <Download size={14} aria-hidden /> {t("acc.bulk.download")}
              </a>
              <div className="max-h-56 overflow-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <tbody>
                    {outcome.created.map((c) => (
                      <tr key={c.row} className="border-b border-border last:border-0">
                        <td className="p-2" dir="auto">{c.full_name}</td>
                        <td className="tech p-2" dir="ltr">{c.identifier}</td>
                        <td className="tech p-2 font-semibold" dir="ltr">{c.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {outcome.errors.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-auto text-xs text-danger">
              {outcome.errors.map((e, i) => (
                <li key={i}>{errText(e)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
