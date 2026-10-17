"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, ClipboardCheck, ImagePlus, Lightbulb, X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { LOCALE_LABELS, type DictKey } from "@/lib/i18n/dictionaries";
import { SESSION_LANGS, type SessionLang } from "@/lib/ai/lang";
import { createChat, listExercises, type Exercise } from "@/app/actions/assistant";

export interface PickLesson {
  id: string;
  subject: string; // رمز المادة
  kind: string;
  number: number;
  title: string;
}
type Mode = "explain" | "review" | "solve";
const MODES: { mode: Mode; icon: typeof BookOpen }[] = [
  { mode: "explain", icon: BookOpen },
  { mode: "review", icon: ClipboardCheck },
  { mode: "solve", icon: Lightbulb },
];
const ALL = "all";
const MULTI = "multi";

async function toJpeg(file: File) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.82);
  return { mime: "image/jpeg", data: url.split(",")[1], preview: url };
}

export function ChatPicker({
  subjects,
  lessons,
  initialLessonId,
}: {
  subjects: { code: string; name: string }[];
  lessons: PickLesson[];
  initialLessonId?: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const initial = lessons.find((l) => l.id === initialLessonId);
  const [mode, setMode] = useState<Mode>("explain");
  const [subject, setSubject] = useState(initial?.subject ?? subjects[0]?.code ?? "");
  const [lessonSel, setLessonSel] = useState<string>(initial?.id ?? ALL);
  const [multi, setMulti] = useState<string[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [exerciseId, setExerciseId] = useState<string>("");
  const [image, setImage] = useState<{ mime: string; data: string; preview: string } | null>(null);
  const [lang, setLang] = useState<SessionLang>("fr");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const subjectLessons = lessons.filter((l) => l.subject === subject);
  const lessonLabel = (l: PickLesson) => `${l.kind.toUpperCase()} ${l.number} — ${l.title}`;
  const idsFor = (sel: string, m: string[]) => (sel === ALL ? [] : sel === MULTI ? m : [sel]);

  function loadExercises(nextSubject: string, nextSel: string, nextMulti: string[]) {
    setExerciseId("");
    setExercises([]);
    listExercises(nextSubject, idsFor(nextSel, nextMulti)).then(setExercises).catch(() => setExercises([]));
  }

  function onMode(m: Mode) {
    setMode(m);
    setErr("");
    if (m === "solve") loadExercises(subject, lessonSel, multi);
  }
  function onSubject(code: string) {
    setSubject(code);
    setLessonSel(ALL);
    setMulti([]);
    if (mode === "solve") loadExercises(code, ALL, []);
  }
  function onLesson(sel: string) {
    setLessonSel(sel);
    if (mode === "solve") loadExercises(subject, sel, multi);
  }
  function onMulti(id: string, on: boolean) {
    const next = on ? [...multi, id] : multi.filter((x) => x !== id);
    setMulti(next);
    if (mode === "solve") loadExercises(subject, MULTI, next);
  }

  async function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      setImage(await toJpeg(f));
      setExerciseId("");
    } catch {
      setErr(t("chat.pick.badImage"));
    }
  }

  function go() {
    setErr("");
    if (lessonSel === MULTI && multi.length === 0) return setErr(t("chat.pick.needLessons"));
    if (mode === "solve" && !exerciseId && !image) return setErr(t("chat.pick.needExercise"));
    start(async () => {
      const r = await createChat({
        mode,
        subjectCode: subject,
        lessonIds: idsFor(lessonSel, multi),
        questionId: mode === "solve" ? exerciseId || null : null,
        lang,
      });
      if (!r.ok) return setErr(t("chat.unavailable"));
      if (image && !exerciseId) {
        try {
          sessionStorage.setItem(`neuron-img-${r.id}`, JSON.stringify([{ mime: image.mime, data: image.data }]));
        } catch {
          /* بلا تخزين مؤقت سيبدأ الشرح بلا صورة */
        }
      }
      router.push(`/assistant/${r.id}?start=1`);
    });
  }

  return (
    <section className="card space-y-4" aria-labelledby="pick-h">
      <h2 id="pick-h" className="tech text-sm font-semibold">{t("chat.new")}</h2>

      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("chat.mode")}>
        {MODES.map(({ mode: m, icon: Icon }) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => onMode(m)}
            className={`flex items-start gap-2 rounded-[var(--radius)] border p-3 text-start text-sm ${
              mode === m ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"
            }`}
          >
            <Icon size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="block font-medium">{t(`chat.mode.${m}` as DictKey)}</span>
              <span className="block text-xs text-muted">{t(`chat.pick.desc.${m}` as DictKey)}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="p-subject">{t("chat.subject")}</label>
          <select id="p-subject" className="input" dir="auto" value={subject} onChange={(e) => onSubject(e.target.value)}>
            {subjects.map((s) => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="p-lesson">{t("chat.pick.lesson")}</label>
          <select id="p-lesson" className="input" dir="auto" value={lessonSel} onChange={(e) => onLesson(e.target.value)}>
            <option value={ALL}>{t("chat.pick.allLessons")}</option>
            <option value={MULTI}>{t("chat.pick.multi")}</option>
            {subjectLessons.map((l) => (
              <option key={l.id} value={l.id}>{lessonLabel(l)}</option>
            ))}
          </select>
        </div>
      </div>

      <div role="radiogroup" aria-label={t("chat.pick.lang")} className="flex flex-wrap items-center gap-2">
        <span className="label !mb-0">{t("chat.pick.lang")}</span>
        {SESSION_LANGS.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={lang === l}
            onClick={() => setLang(l)}
            className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${lang === l ? "border-transparent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg"}`}
          >
            {LOCALE_LABELS[l]}
          </button>
        ))}
      </div>

      {lessonSel === MULTI && (
        <fieldset className="space-y-1.5 rounded-[var(--radius)] border border-border p-3">
          <legend className="label px-1">{t("chat.pick.multi")}</legend>
          {subjectLessons.length === 0 && <p className="text-xs text-muted">{t("chat.pick.noLessons")}</p>}
          {subjectLessons.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm" dir="auto">
              <input type="checkbox" checked={multi.includes(l.id)} onChange={(e) => onMulti(l.id, e.target.checked)} />
              {lessonLabel(l)}
            </label>
          ))}
        </fieldset>
      )}

      {mode === "solve" && (
        <div className="space-y-2">
          <p className="label">{t("chat.pick.exercise")}</p>
          {exercises.length === 0 ? (
            <p className="text-xs text-muted">{t("chat.pick.noExercises")}</p>
          ) : (
            <ul className="max-h-56 space-y-1.5 overflow-y-auto" role="radiogroup" aria-label={t("chat.pick.exercise")}>
              {exercises.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={exerciseId === x.id}
                    onClick={() => {
                      setExerciseId(x.id);
                      setImage(null);
                    }}
                    className={`flex w-full items-start gap-2 rounded-[var(--radius)] border p-2 text-start text-xs ${
                      exerciseId === x.id ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2"
                    }`}
                  >
                    <span className="badge shrink-0">{x.type === "mcq" ? "QCM" : "Écrit"}</span>
                    <span className="min-w-0" dir="auto">{x.statement}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <label className="btn btn-sm cursor-pointer">
              <ImagePlus size={14} aria-hidden /> {t("chat.pick.image")}
              <input type="file" accept="image/*" hidden onChange={onImage} />
            </label>
            {image && (
              <span className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.preview} alt="" className="size-12 rounded object-cover" />
                <button type="button" aria-label={t("chat.removeImage")} onClick={() => setImage(null)} className="absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-fg text-bg">
                  <X size={12} aria-hidden />
                </button>
              </span>
            )}
          </div>
        </div>
      )}

      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <button type="button" className="btn btn-primary w-full" disabled={pending || !subject} aria-busy={pending} onClick={go}>
        {pending ? t("chat.pick.starting") : t("chat.start")}
      </button>
      <p className="text-xs text-muted">{t("chat.pick.freeNote")}</p>
    </section>
  );
}
