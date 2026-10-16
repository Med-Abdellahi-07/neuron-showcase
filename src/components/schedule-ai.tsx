"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { extractSchedule, saveExtracted, type DraftRow } from "@/app/actions/schedule-ai";

async function toJpeg(file: File) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return { mime: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] };
}

export function ScheduleAi({
  cohortId,
  week,
  subjects,
}: {
  cohortId: string;
  week: string;
  subjects: { id: string; code: string }[];
}) {
  const { t } = useT();
  const router = useRouter();
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await extractSchedule({ image: await toJpeg(f), week });
      if (!r.ok) setMsg(r.error === "busy" ? t("chat.busy") : t("sched.ai.failed"));
      else {
        setRows(r.rows);
        if (!r.rows.length) setMsg(t("sched.ai.none"));
        else if (r.skipped) setMsg(`${t("sched.ai.skipped")}: ${r.skipped}`);
      }
    } catch {
      setMsg(t("sched.ai.failed"));
    }
    setBusy(false);
  }

  const upd = (i: number, p: Partial<DraftRow>) => setRows((cur) => cur && cur.map((r, k) => (k === i ? { ...r, ...p } : r)));

  async function save() {
    if (!rows) return;
    setBusy(true);
    const r = await saveExtracted(cohortId, rows);
    setBusy(false);
    if (!r.ok) return setMsg(t("common.error"));
    setRows(null);
    setMsg(`${t("common.saved")} (${r.saved})`);
    router.refresh();
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="tech text-sm font-semibold">{t("sched.ai.title")}</h2>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        <button type="button" className="btn btn-sm" disabled={busy} aria-busy={busy} onClick={() => fileRef.current?.click()}>
          <Sparkles size={14} aria-hidden /> {busy ? t("sched.ai.reading") : t("sched.ai.upload")}
        </button>
      </div>
      <p className="text-xs text-muted">{t("sched.ai.hint")}</p>
      {msg && <p role="status" className="text-sm">{msg}</p>}
      {rows && rows.length > 0 && (
        <>
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="grid grid-cols-6 gap-1.5 rounded-[var(--radius)] border border-border p-2 text-xs">
                <input type="date" className="input col-span-3 !min-h-8" dir="ltr" value={r.date} onChange={(e) => upd(i, { date: e.target.value })} aria-label="date" />
                <input type="number" min={1} max={6} className="input !min-h-8" dir="ltr" value={r.slot} onChange={(e) => upd(i, { slot: Number(e.target.value) })} aria-label="slot" />
                <select className="input !min-h-8" value={r.kind} onChange={(e) => upd(i, { kind: e.target.value as DraftRow["kind"] })} aria-label="kind">
                  <option value="cm">CM</option><option value="td">TD</option><option value="tp">TP</option>
                </select>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setRows((c) => c && c.filter((_, k) => k !== i))} aria-label={t("common.delete")}>×</button>
                <select className="input col-span-3 !min-h-8" value={r.subject_id} onChange={(e) => upd(i, { subject_id: e.target.value })} aria-label="subject">
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                </select>
                <input className="input col-span-3 !min-h-8" dir="auto" value={r.room} placeholder="room" maxLength={40} onChange={(e) => upd(i, { room: e.target.value })} />
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>{t("sched.ai.save")} ({rows.length})</button>
            <button type="button" className="btn" onClick={() => setRows(null)}>{t("common.cancel")}</button>
          </div>
        </>
      )}
    </section>
  );
}
