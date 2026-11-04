"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CloudDownload, CheckCircle2, Trash2, Loader2 } from "lucide-react";
import { prepareOfflinePack } from "@/app/actions/offline";
import { getPack, removePack, savePack } from "@/lib/offline/db";
import { fetchJoined } from "@/lib/big-file";
import { useT } from "@/lib/i18n/client";

type State = "idle" | "busy" | "saved" | "error";

/** زر «تنزيل للمشاهدة بدون نت» في صفحة الحصة: PDF + الأسئلة + ملخصات الطالب تُحفظ في IndexedDB */
export function OfflineButton({ lessonId, withQuestions }: { lessonId: string; withQuestions: boolean }) {
  const { t } = useT();
  const [state, setState] = useState<State>("idle");
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    getPack(lessonId).then((p) => alive && p && setState("saved")).catch(() => {});
    return () => { alive = false; };
  }, [lessonId]);

  async function save() {
    setState("busy");
    setNote("");
    try {
      const res = await prepareOfflinePack(lessonId, withQuestions);
      if (!res.ok) throw new Error(res.error);
      const pdfs = await Promise.all(
        res.pack.pdfs.map(async (f) => {
          if (f.parts) return { name: f.name, blob: await fetchJoined(f.parts, { hashes: f.hashes }) }; // مجزّأ: ضمّ الأجزاء
          const r = await fetch(f.url);
          if (!r.ok) throw new Error("pdf");
          return { name: f.name, blob: await r.blob() };
        })
      );
      if (!pdfs.length && !res.pack.questions.length && !res.pack.summaries.length) {
        setNote(t("off.nothing"));
        setState("error");
        return;
      }
      await savePack({ ...res.pack, pdfs, savedAt: Date.now() });
      try { await navigator.storage?.persist?.(); } catch { /* اختياري */ }
      if (res.qNote) setNote(t(res.qNote === "limit" ? "off.qLimit" : res.qNote === "none" || res.qNote === "off" ? "off.qNone" : "off.qErr"));
      setState("saved");
    } catch {
      setNote(t("off.err"));
      setState("error");
    }
  }

  async function remove() {
    await removePack(lessonId).catch(() => {});
    setState("idle");
    setNote("");
  }

  if (state === "saved")
    return (
      <div className="card flex flex-wrap items-center justify-between gap-2 !p-3" role="status">
        <span className="flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 size={18} aria-hidden /> {t("off.saved")}</span>
        <span className="flex gap-2">
          <Link href="/offline" className="btn btn-sm">{t("off.openList")}</Link>
          <button type="button" onClick={remove} className="btn btn-sm" aria-label={t("off.remove")}><Trash2 size={14} aria-hidden /> {t("off.remove")}</button>
        </span>
        {note && <p className="w-full text-xs text-muted">{note}</p>}
      </div>
    );

  return (
    <div className="space-y-1">
      <button type="button" onClick={save} disabled={state === "busy"} className="btn w-full">
        {state === "busy" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <CloudDownload size={16} aria-hidden />}
        {state === "busy" ? t("off.saving") : t("off.save")}
      </button>
      {note && <p role="alert" className="text-xs text-muted">{note}</p>}
    </div>
  );
}
