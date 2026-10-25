"use client";

import { useState } from "react";
import { Bot, Library, Swords } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { SubmitButton } from "@/components/submit-button";
import { createDuel } from "@/app/actions/duel";
import { createAiDuel } from "@/app/actions/ai-duel";

export interface DuelLesson {
  id: string;
  subject_id: string;
  kind: string;
  number: number;
  title: string;
}

/** اختيار زميل + مادة + (اختيارياً) حصص محددة + عدد الأسئلة. */
export function DuelCreate({
  mates,
  subjects,
  lessons,
  aiEnabled = false,
}: {
  mates: { id: string; full_name: string }[];
  subjects: { id: string; code: string; name: string }[];
  lessons: DuelLesson[];
  aiEnabled?: boolean;
}) {
  const { t, locale } = useT();
  const [source, setSource] = useState<"bank" | "ai">("bank");
  const ai = aiEnabled && source === "ai";
  const [subject, setSubject] = useState(subjects[0]?.id ?? "");
  const code = subjects.find((s) => s.id === subject)?.code ?? "";
  const options = lessons.filter((l) => l.subject_id === subject);

  if (!mates.length) return <p className="card text-sm text-muted">{t("duel.noMates")}</p>;

  return (
    <form action={ai ? createAiDuel : createDuel} className="card space-y-4">
      <h2 className="tech flex items-center gap-2 text-sm font-semibold">
        <Swords size={16} aria-hidden /> {t("duel.new")}
      </h2>
      {aiEnabled && (
        <fieldset>
          <legend className="label">{t("duel.source")}</legend>
          <div className="grid grid-cols-2 gap-2">
            {([["bank", Library, "duel.source.bank"], ["ai", Bot, "duel.source.ai"]] as const).map(([v, Icon, key]) => (
              <label key={v} className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="radio" name="source" value={v} checked={source === v} onChange={() => setSource(v)} className="sr-only" />
                <Icon size={16} aria-hidden /> {t(key)}
              </label>
            ))}
          </div>
          {ai && <p className="mt-1 text-xs text-muted">{t("duel.source.aiHelp")}</p>}
        </fieldset>
      )}
      <div>
        <label className="label" htmlFor="duel-opp">{t("duel.opponent")}</label>
        <select id="duel-opp" name="opponent" className="input" required defaultValue="">
          <option value="" disabled>{t("duel.pickMate")}</option>
          {mates.map((m) => (
            <option key={m.id} value={m.id}>{m.full_name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="duel-subj">{t("rec.subject")}</label>
        <select id="duel-subj" className="input" value={subject} onChange={(e) => setSubject(e.target.value)}>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
          ))}
        </select>
        <input type="hidden" name="subject" value={code} />
      </div>
      {options.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="label">{t("duel.lessonsOpt")}</legend>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-[var(--radius)] border border-border p-2">
            {options.map((l) => (
              <label key={l.id} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" name="lessons" value={l.id} className="size-4 accent-[var(--accent)]" />
                <span className="tech text-xs text-muted" dir="ltr">{l.kind.toUpperCase()} {l.number}</span>
                <span className="min-w-0 truncate" dir="auto">{l.title}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">{t("duel.lessonsHelp")}</p>
        </fieldset>
      )}
      <div>
        <label className="label" htmlFor="duel-count">{t("duel.count")}</label>
        <select id="duel-count" name="count" className="input" defaultValue="8">
          {[5, 8, 10, 15].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
      {ai && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="duel-diff">{t("aiq.difficulty")}</label>
            <select id="duel-diff" name="difficulty" className="input" defaultValue="medium">
              <option value="easy">{t("diff.easy")}</option><option value="medium">{t("diff.medium")}</option><option value="hard">{t("diff.hard")}</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="duel-lang">{t("sum.lang")}</label>
            <select id="duel-lang" name="lang" className="input" defaultValue={locale}>
              <option value="fr">Français</option><option value="ar">العربية</option><option value="en">English</option>
            </select>
          </div>
        </div>
      )}
      <SubmitButton className="btn btn-primary w-full">{ai ? t("duel.startAi") : t("duel.start")}</SubmitButton>
      <p className="text-xs text-muted">{t("duel.rules")}</p>
    </form>
  );
}
