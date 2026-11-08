"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, ClipboardCheck, ImagePlus, Lightbulb, X } from "lucide-react";
import { AiOrb, ClayBook, ClayCheck, ClayPencil, ClaySheet } from "@/components/clay";
import { BackButton } from "@/components/back-button";
import { useT } from "@/lib/i18n/client";
import { LOCALE_LABELS, type DictKey } from "@/lib/i18n/dictionaries";
import { SESSION_LANGS, type SessionLang } from "@/lib/ai/lang";
import { createChat, listExercises, type Exercise } from "@/app/actions/assistant";

export interface PickLesson {
  id: string;
  subject: string; // Subject code.
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
const noopSubscribe = () => () => {};
const hasSpeech = () => {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
};
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
  name,
  flags,
  pressured,
  children,
}: {
  subjects: { code: string; name: string }[];
  lessons: PickLesson[];
  initialLessonId?: string;
  /** First name, for the greeting. */
  name: string;
  flags: { qcm: boolean; summary: boolean };
  pressured: boolean;
  /** Conversation history (rendered by the server under the cards). */
  children?: React.ReactNode;
}) {
  const { t, locale } = useT();
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
  const [panel, setPanel] = useState(false);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const canSpeak = useSyncExternalStore(noopSubscribe, hasSpeech, () => false);
  const recRef = useRef<{ stop: () => void } | null>(null);

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

  /** Starts a conversation with the current context. question: a free question from the bottom bar or suggestions (sent instead of starting the explanation). */
  function go(opts?: { mode?: Mode; question?: string }) {
    setErr("");
    const m = opts?.mode ?? mode;
    const question = opts?.question?.trim();
    if (lessonSel === MULTI && multi.length === 0) {
      setPanel(true);
      return setErr(t("chat.pick.needLessons"));
    }
    if (m === "solve" && !exerciseId && !image) {
      setPanel(true);
      return setErr(t("chat.pick.needExercise"));
    }
    start(async () => {
      const r = await createChat({
        mode: m,
        subjectCode: subject,
        lessonIds: idsFor(lessonSel, multi),
        questionId: m === "solve" ? exerciseId || null : null,
        lang,
      });
      if (!r.ok) return setErr(t("chat.unavailable"));
      try {
        if (image && (question || !exerciseId)) sessionStorage.setItem(`neuron-img-${r.id}`, JSON.stringify([{ mime: image.mime, data: image.data }]));
        if (question) sessionStorage.setItem(`neuron-q-${r.id}`, question);
      } catch {
        /* Without caching it would start with no image. */
      }
      router.push(question ? `/assistant/${r.id}?q=1` : `/assistant/${r.id}?start=1`);
    });
  }

  function toggleVoice() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = locale === "ar" ? "ar-SA" : locale === "fr" ? "fr-FR" : "en-US";
    rec.interimResults = false;
    rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const said = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      setDraft((d) => (d ? `${d} ${said}` : said).slice(0, 2000));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  const cur = lessons.find((l) => l.id === lessonSel);
  const ctxLabel = cur ? `${subject} · ${cur.kind.toUpperCase()} ${cur.number}` : lessonSel === MULTI ? `${subject} · ${multi.length}` : subject;
  const sendDraft = () => {
    const q = draft.trim();
    if (q) go({ mode: "explain", question: q });
  };
  const tile = "flex flex-col gap-2.5 rounded-[20px] bg-surface p-3.5 text-start font-[inherit] text-fg disabled:opacity-60";
  const icon = "flex size-[46px] items-center justify-center rounded-[15px]";

  return (
    <div className="bleed-page flex min-h-dvh flex-col">
      <header className="rounded-b-[32px] bg-deep px-5 pb-[22px] pt-[18px] text-white">
        <div className="mx-auto flex max-w-3xl flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <BackButton variant="dark" />
            <span className="text-base font-semibold">Neuron AI</span>
            <a href="#hist-h" aria-label={t("chat.history")} className="press flex size-10 items-center justify-center rounded-[14px] bg-deep-2 text-white">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
            </a>
          </div>
          <div className="flex items-center gap-3">
            <div className="afl clay-lg shrink-0"><AiOrb /></div>
            <div className="flex flex-col gap-1">
              <span className="text-[19px] font-semibold" dir="auto">{t("ai.hello").replace("{name}", name)}</span>
              <span className="text-[13px] text-on-dark">{t("ai.helpToday")}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPanel((v) => !v)}
            aria-expanded={panel}
            aria-controls="ctx-panel"
            className="flex h-[34px] items-center gap-1.5 self-start rounded-full border border-[#5A3BB8] bg-deep-2 px-3 font-[inherit] text-xs text-white"
          >
            <span dir="ltr">{ctxLabel}</span>
            <span className="text-on-dark">{t("ai.context.change")} ▾</span>
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl grow flex-col gap-3 px-5 pb-28 pt-4">
        {pressured && <p role="status" className="rounded-[16px] bg-surface p-3 text-xs text-muted">{t("ai.pressure")}</p>}

        {panel && (
          <section id="ctx-panel" className="space-y-4 rounded-[20px] bg-surface p-4" aria-label={t("ai.context.panel")}>
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
            className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${lang === l ? "border-transparent bg-primary text-primary-fg" : "border-border text-muted hover:text-fg"}`}
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
            <button type="button" className="btn btn-primary w-full" disabled={pending || !subject} aria-busy={pending} onClick={() => go()}>
              {pending ? t("chat.pick.starting") : t("chat.start")}
            </button>
            <p className="text-xs text-muted">{t("chat.pick.freeNote")}</p>
          </section>
        )}
        {!panel && err && <p role="alert" className="text-sm text-danger">{err}</p>}

        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" className={tile} disabled={pending || !subject} onClick={() => go({ mode: "explain" })}>
            <span className={`${icon} bg-surface-2`}><ClayBook variant="tileDot" className="clays" /></span>
            <span className="flex flex-col gap-0.5"><span className="text-sm font-semibold">{t("ai.card.explain")}</span><span className="text-[11px] text-muted">{t("ai.card.explainSub")}</span></span>
          </button>
          {flags.qcm && (
            <Link href="/assistant/qcm" className={`${tile} no-underline`}>
              <span className={`${icon} bg-surface-2`}><ClayCheck variant="quiz" className="clays" /></span>
              <span className="flex flex-col gap-0.5"><span className="text-sm font-semibold">{t("ai.card.qcm")}</span><span className="text-[11px] text-muted">{t("ai.card.qcmSub")}</span></span>
            </Link>
          )}
          <button type="button" className={tile} disabled={pending || !subject} onClick={() => go({ mode: "review" })}>
            <span className={`${icon} bg-urgent-bg`}><ClayPencil className="clays" /></span>
            <span className="flex flex-col gap-0.5"><span className="text-sm font-semibold">{t("ai.card.exam")}</span><span className="text-[11px] text-muted">{t("ai.card.examSub")}</span></span>
          </button>
          {flags.summary && (
            <Link href="/assistant/summaries" className={`${tile} no-underline`}>
              <span className={`${icon} bg-success-bg`}><ClaySheet className="clays" /></span>
              <span className="flex flex-col gap-0.5"><span className="text-sm font-semibold">{t("ai.card.summary")}</span><span className="text-[11px] text-muted">{t("ai.card.summarySub")}</span></span>
            </Link>
          )}
        </div>

        <h2 className="mt-1 text-sm font-semibold">{t("ai.tryAsk")}</h2>
        <div className="flex flex-col gap-2">
          {(["ai.try1", "ai.try2"] as const).map((k) => (
            <button
              key={k}
              type="button"
              disabled={pending || !subject}
              onClick={() => go({ mode: "explain", question: t(k) })}
              className="rounded-2xl border border-border bg-surface px-3.5 py-3 text-start font-[inherit] text-[13px] text-fg disabled:opacity-60"
              dir="auto"
            >
              {t(k)}
            </button>
          ))}
        </div>

        {children}
      </main>

      <div className="sticky bottom-0 z-10 bg-bg px-4 pb-[calc(22px+env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-[22px] bg-surface p-2 shadow-[0_8px_22px_rgba(42,14,110,0.08)]">
          <label className="flex size-10 cursor-pointer items-center justify-center rounded-[14px] bg-bg text-muted" aria-label={t("ai.composer.attach")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="11" r="2" /><path d="M21 16l-5-5-8 8" /></svg>
            <input type="file" accept="image/*" hidden onChange={onImage} />
          </label>
          {image && (
            <span className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.preview} alt="" className="size-10 rounded-lg object-cover" />
              <button type="button" aria-label={t("chat.removeImage")} onClick={() => setImage(null)} className="absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-fg text-bg"><X size={12} aria-hidden /></button>
            </span>
          )}
          <label className="grow">
            <span className="sr-only">{t("ai.composer.label")}</span>
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendDraft();
                }
              }}
              placeholder={t("ai.composer.placeholder")}
              maxLength={2000}
              dir="auto"
              className="w-full border-0 bg-transparent font-[inherit] text-sm text-fg outline-none placeholder:text-faint"
            />
          </label>
          {canSpeak && (
            <button type="button" onClick={toggleVoice} aria-label={t("ai.composer.voice")} aria-pressed={listening} className={`flex size-10 items-center justify-center rounded-[14px] border-0 ${listening ? "bg-primary text-white" : "bg-bg text-muted"}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            </button>
          )}
          <button type="button" onClick={sendDraft} disabled={pending || !draft.trim() || !subject} aria-label={t("ai.composer.send")} className="flex size-11 items-center justify-center rounded-2xl border-0 bg-primary text-white disabled:opacity-50">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

interface SR {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
}
