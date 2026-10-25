"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { useT } from "@/lib/i18n/client";
import { generateSummary } from "@/app/actions/ai-summary";
import { generateQcm } from "@/app/actions/ai-qcm";

export interface PickSubject { id: string; code: string; name: string }
export interface PickLesson { id: string; subject_id: string; kind: string; number: number; title: string }
const MAX = 6;
const QCM_MAX_LESSONS = 10;

function LessonChecks({ lessons, picked, setPicked, max = MAX }: { lessons: PickLesson[]; picked: string[]; setPicked: (v: string[]) => void; max?: number }) {
  const { t } = useT();
  if (!lessons.length) return <p className="text-sm text-muted">{t("sum.noLessons")}</p>;
  return (
    <fieldset className="space-y-1.5">
      <legend className="label">{t("sum.lessons")} <span className="text-xs text-muted">({picked.length}/{max})</span></legend>
      <div className="flex gap-2">
        <button type="button" className="btn btn-sm" onClick={() => setPicked(lessons.slice(0, max).map((l) => l.id))}>{t("aiq.selectAll")}</button>
        <button type="button" className="btn btn-sm" onClick={() => setPicked([])} disabled={!picked.length}>{t("aiq.clear")}</button>
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
        {lessons.map((l) => {
          const on = picked.includes(l.id);
          return (
            <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
              <input type="checkbox" name="lesson" value={l.id} checked={on} disabled={!on && picked.length >= max}
                onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} />
              <span className="tech text-xs text-muted" dir="ltr">{l.kind.toUpperCase()} {l.number}</span>
              <span dir="auto">{l.title}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const LANGS = ["fr", "ar", "en"] as const;
const LANG_LABEL = { fr: "Français", ar: "العربية", en: "English" } as const;
function LangSelect({ def }: { def: string }) {
  const { t } = useT();
  return (
    <div>
      <label className="label" htmlFor="ai-lang">{t("sum.lang")}</label>
      <select id="ai-lang" name="lang" className="input" defaultValue={def}>
        {LANGS.map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
      </select>
    </div>
  );
}

export function SummaryForm({ subjects, lessons, defaultLang }: { subjects: PickSubject[]; lessons: PickLesson[]; defaultLang: string }) {
  const { t } = useT();
  const [subject, setSubject] = useState(subjects[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const list = useMemo(() => lessons.filter((l) => l.subject_id === subject), [lessons, subject]);
  if (!subjects.length) return <p className="card text-sm text-muted">{t("sum.noSubjects")}</p>;
  return (
    <ActionForm action={generateSummary} submitLabel={t("sum.generate")} className="card space-y-4">
      <div>
        <label className="label" htmlFor="sum-subject">{t("sum.subject")}</label>
        <select id="sum-subject" className="input" value={subject} onChange={(e) => { setSubject(e.target.value); setPicked([]); }}>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
        </select>
      </div>
      <LessonChecks lessons={list} picked={picked} setPicked={setPicked} />
      <fieldset>
        <legend className="label">{t("sum.kind")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["short", "detailed", "sheet", "flashcards"] as const).map((k, i) => (
            <label key={k} className="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-3 text-sm has-[:checked]:border-accent">
              <input type="radio" name="kind" value={k} defaultChecked={i === 0} className="mt-1" />
              <span><b>{t(`sum.kind.${k}`)}</b><br /><span className="text-xs text-muted">{t(`sum.kindHelp.${k}`)}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <LangSelect def={defaultLang} />
    </ActionForm>
  );
}

export function QcmForm({ subjects, lessons, defaultLang }: { subjects: PickSubject[]; lessons: PickLesson[]; defaultLang: string }) {
  const { t } = useT();
  const [subject, setSubject] = useState(subjects[0]?.id ?? "");
  const [kind, setKind] = useState("");
  const [count, setCount] = useState("10");
  const [picked, setPicked] = useState<string[]>([]);
  const list = useMemo(() => lessons.filter((l) => l.subject_id === subject && (!kind || l.kind === kind)), [lessons, subject, kind]);
  if (!subjects.length) return <p className="card text-sm text-muted">{t("sum.noSubjects")}</p>;
  return (
    <ActionForm action={generateQcm} submitLabel={t("aiq.generate")} className="card space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="q-subject">{t("sum.subject")}</label>
          <select id="q-subject" name="subject" className="input" value={subject} onChange={(e) => { setSubject(e.target.value); setPicked([]); }}>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="q-kind">{t("aiq.type")}</label>
          <select id="q-kind" name="kind" className="input" value={kind} onChange={(e) => { setKind(e.target.value); setPicked([]); }}>
            <option value="">{t("aiq.typeAll")}</option>
            <option value="cm">CM</option><option value="td">TD</option><option value="tp">TP</option>
          </select>
        </div>
      </div>
      <LessonChecks lessons={list} picked={picked} setPicked={setPicked} max={QCM_MAX_LESSONS} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="q-count">{t("aiq.count")} <span className="text-xs text-muted">(1–50)</span></label>
          <input id="q-count" name="count" type="number" inputMode="numeric" min={1} max={50} step={1} required value={count} dir="ltr"
            onChange={(e) => setCount(e.target.value)} className="input" />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[5, 10, 20, 30, 50].map((n) => (
              <button key={n} type="button" onClick={() => setCount(String(n))} aria-pressed={count === String(n)}
                className={`btn btn-sm !min-h-8 !px-3 ${count === String(n) ? "btn-primary" : ""}`}>{n}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="q-min">{t("aiq.duration")}</label>
          <select id="q-min" name="minutes" className="input" defaultValue="0" dir="ltr">
            <option value="0">{t("aiq.noLimit")}</option>
            {[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} {t("aiq.min")}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">{t("aiq.durationHelp")}</p>
        </div>
        <div>
          <label className="label" htmlFor="q-diff">{t("aiq.difficulty")}</label>
          <select id="q-diff" name="difficulty" className="input" defaultValue="medium">
            <option value="easy">{t("diff.easy")}</option><option value="medium">{t("diff.medium")}</option><option value="hard">{t("diff.hard")}</option>
          </select>
        </div>
        <LangSelect def={defaultLang} />
      </div>
      <p className="text-xs text-muted">{t("aiq.timeHint")}</p>
    </ActionForm>
  );
}
