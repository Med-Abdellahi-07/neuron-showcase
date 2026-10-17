"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { runAiDiagnostics } from "@/app/actions/ai-admin";
import type { DiagReport } from "@/lib/ai/diagnostics";
import { useT } from "@/lib/i18n/client";

export function AiDiagnostics() {
  const { t } = useT();
  const [report, setReport] = useState<DiagReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      try {
        setReport(await runAiDiagnostics());
      } catch {
        setError(t("diag.failed"));
      }
    });
  }

  const geminiAlert = report?.rows.find((r) => r.alert);

  return (
    <div className="space-y-4">
      <button type="button" className="btn btn-primary" onClick={run} disabled={pending} aria-busy={pending}>
        {pending ? "…" : t("diag.run")}
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {report && (
        <div className="space-y-4" aria-live="polite">
          {geminiAlert && (
            <div role="alert" className="card flex gap-3 border-danger bg-danger/10 text-sm">
              <AlertTriangle className="mt-0.5 shrink-0 text-danger" size={18} aria-hidden />
              <div className="space-y-1">
                <p className="font-semibold text-danger">{t("diag.geminiAuth")}</p>
                <p>{geminiAlert.hint}</p>
                <p className="text-muted">{t("diag.stillWorks")}</p>
              </div>
            </div>
          )}

          <ul className="space-y-2">
            {report.rows.map((r) => (
              <li key={r.id} className={`card space-y-1 !p-3 text-sm ${r.alert ? "border-danger" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    {r.ok ? <Check size={16} className="shrink-0 text-success" aria-label="OK" /> : <X size={16} className="shrink-0 text-danger" aria-label="FAIL" />}
                    <span dir="auto">{r.label}</span>
                  </span>
                  <span className="tech shrink-0 text-xs text-muted" dir="ltr">
                    {r.status ?? "—"} · {r.ms}ms
                  </span>
                </div>
                {r.model && <p className="tech text-xs text-muted" dir="ltr">{r.model}</p>}
                <p className="whitespace-pre-wrap break-words text-xs" dir="auto">{r.detail}</p>
                {r.hint && !r.ok && <p className="text-xs text-warn" dir="auto">{r.hint}</p>}
              </li>
            ))}
          </ul>

          <div className="card !p-3">
            <p className="label mb-2">{t("diag.env")}</p>
            <ul className="tech grid gap-1 text-xs" dir="ltr">
              {report.env.map((e) => (
                <li key={e.name} className="flex justify-between gap-2">
                  <span>{e.name}</span>
                  <span className={e.set || e.value ? "" : "text-danger"}>
                    {e.value ? e.value : e.set ? "set" : "MISSING"}
                    {e.value && !e.set ? " (default)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
