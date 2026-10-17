"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { createRecording } from "@/app/actions/recordings";
import { useT } from "@/lib/i18n/client";

export interface FormLesson {
  id: string;
  subject_id: string;
  kind: string;
  number: number;
  title: string;
  lesson_date: string | null;
}

/** إضافة تسجيل: الرابط (YouTube غير مدرج أو Drive) + ربطه بالمادة والنوع والتاريخ، أو باختيار حصة تملأها تلقائياً. */
export function RecordingForm({
  cohorts,
  subjects,
  lessons,
  defaultCohort,
}: {
  cohorts: { id: string; name: string }[];
  subjects: { id: string; code: string; name: string }[];
  lessons: FormLesson[];
  defaultCohort?: string | null;
}) {
  const { t } = useT();
  const [subject, setSubject] = useState(subjects[0]?.id ?? "");
  const [kind, setKind] = useState("cm");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [lesson, setLesson] = useState("");
  const options = lessons.filter((l) => l.subject_id === subject && l.kind !== "resume");

  function pickLesson(id: string) {
    setLesson(id);
    const l = lessons.find((x) => x.id === id);
    if (l) {
      setKind(l.kind);
      if (l.lesson_date) setDate(l.lesson_date);
    }
  }

  return (
    <ActionForm action={createRecording} submitLabel={t("rec.add")} resetOnSuccess>
      <div>
        <label className="label" htmlFor="rec-url">{t("rec.url")}</label>
        <input id="rec-url" name="url" type="url" className="input" dir="ltr" required placeholder="https://youtu.be/…" />
        <p className="mt-1 text-xs text-muted">{t("rec.urlHelp")}</p>
      </div>
      <div>
        <label className="label" htmlFor="rec-title">{t("rec.title")}</label>
        <input id="rec-title" name="title" className="input" dir="auto" required maxLength={200} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="rec-cohort">{t("acc.cohort")}</label>
          <select id="rec-cohort" name="cohort_id" className="input" required defaultValue={defaultCohort ?? cohorts[0]?.id}>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rec-subject">{t("rec.subject")}</label>
          <select id="rec-subject" name="subject_id" className="input" required value={subject} onChange={(e) => { setSubject(e.target.value); setLesson(""); }}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rec-lesson">{t("rec.lesson")}</label>
          <select id="rec-lesson" name="lesson_id" className="input" value={lesson} onChange={(e) => pickLesson(e.target.value)}>
            <option value="">{t("rec.noLesson")}</option>
            {options.map((l) => (
              <option key={l.id} value={l.id}>{l.kind.toUpperCase()} {l.number} — {l.title}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="rec-kind">{t("rec.kind")}</label>
            <select id="rec-kind" name="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="cm">CM</option>
              <option value="td">TD</option>
              <option value="tp">TP</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="rec-date">{t("rec.date")}</label>
            <input id="rec-date" name="rec_date" type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
      </div>
    </ActionForm>
  );
}
