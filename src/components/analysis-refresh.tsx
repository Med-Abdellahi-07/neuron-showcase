"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { refreshAnalysis } from "@/app/actions/analysis";

export function AnalysisRefresh() {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            setMsg("");
            const r = await refreshAnalysis();
            if (r.ok) router.refresh();
            else setMsg(r.error === "busy" ? t("chat.busy") : r.error === "empty" ? t("analysis.empty") : t("chat.unavailable"));
          })
        }
      >
        <RefreshCw size={16} aria-hidden /> {pending ? t("analysis.working") : t("analysis.refresh")}
      </button>
      {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
    </div>
  );
}
