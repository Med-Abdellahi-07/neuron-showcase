import Link from "next/link";
import { Repeat, Trophy, X } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects } from "@/lib/data";
import { PracticeTabs } from "@/components/practice-tabs";
import { SubmitButton } from "@/components/submit-button";
import { startAttempt, startReview } from "@/app/actions/arena";
import type { DictKey } from "@/lib/i18n/dictionaries";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERRORS: Record<string, DictKey> = {
  no_questions: "arena.err.no_questions",
  not_enough_questions: "arena.err.not_enough_questions",
  generic: "arena.err.generic",
};

export default async function PracticePage({ searchParams }: { searchParams: Promise<SP> }) {
  const userId = await requireUserId();
  const sp = await searchParams;
  const { t } = await getT();
  const supabase = await createClient();

  const lessonId = UUID_RE.test(one(sp.lesson)) ? one(sp.lesson) : "";
  const err = ERRORS[one(sp.err)] ?? null;

  const [subjects, lessonRes, dueRes] = await Promise.all([
    getCurrentSubjects(),
    lessonId ? supabase.from("lessons").select("title, number, kind").eq("id", lessonId).maybeSingle() : null,
    supabase
      .from("review_queue")
      .select("question_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("mastered", false)
      .lte("due_at", new Date().toISOString()),
  ]);
  const dueCount = dueRes.count ?? 0;
  const lessonTitle = lessonRes?.data
    ? `${String(lessonRes.data.kind).toUpperCase()} ${lessonRes.data.number} — ${lessonRes.data.title}`
    : "";

  return (
    <div className="space-y-5">
      <h1 className="page-title !mb-0">{t("practice.title")}</h1>
      <PracticeTabs />

      {err && (
        <p role="alert" className="card text-sm text-warn">
          {t(err)}
        </p>
      )}

      {dueCount > 0 && (
        <section className="card flex items-center justify-between gap-3" aria-labelledby="due-h">
          <div className="min-w-0">
            <h2 id="due-h" className="tech flex items-center gap-2 text-sm font-semibold">
              <Repeat size={16} aria-hidden /> {t("arena.review.due")}
            </h2>
            <p className="tech mt-1 text-2xl font-semibold text-accent" dir="ltr">{dueCount}</p>
          </div>
          <form action={startReview}>
            <SubmitButton className="btn btn-primary">{t("arena.review.start")}</SubmitButton>
          </form>
        </section>
      )}

      {!lessonId && (
        <section className="card space-y-3" aria-labelledby="ranked-h">
          <h2 id="ranked-h" className="tech flex items-center gap-2 text-sm font-semibold">
            <Trophy size={16} aria-hidden /> {t("arena.ranked.title")}
          </h2>
          <p className="text-sm text-muted">{t("arena.ranked.rules")}</p>
          <p className="text-xs text-muted">{t("arena.ranked.firstOnly")}</p>
          <p className="text-xs text-muted">{t("arena.scoring")}</p>
          <form action={startAttempt} className="space-y-3">
            <input type="hidden" name="mode" value="ranked" />
            <div>
              <label className="label" htmlFor="ranked-subject">{t("practice.subject")}</label>
              <select id="ranked-subject" name="subject" className="input" dir="auto">
                <option value="">{t("arena.scope.all")}</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.code}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
            <SubmitButton className="btn btn-primary w-full">{t("arena.ranked.start")}</SubmitButton>
          </form>
        </section>
      )}

      <section className="card space-y-4" aria-labelledby="free-h">
        <div>
          <h2 id="free-h" className="tech text-sm font-semibold">{t("arena.free.title")}</h2>
          <p className="mt-1 text-xs text-muted">{t("arena.free.desc")}</p>
        </div>
        <form action={startAttempt} className="space-y-4">
          <input type="hidden" name="mode" value="free" />
          {lessonId && (
            <div className="flex items-center justify-between gap-2 rounded-[var(--radius)] bg-accent-soft p-3 text-sm">
              <span className="min-w-0 truncate" dir="auto">{t("practice.lesson")}: {lessonTitle}</span>
              <input type="hidden" name="lesson" value={lessonId} />
              <Link href="/practice" className="shrink-0 text-xs text-accent hover:underline" aria-label={t("common.cancel")}><X size={16} strokeWidth={1.9} aria-hidden /></Link>
            </div>
          )}
          {!lessonId && (
            <>
              <div>
                <label className="label" htmlFor="subject">{t("practice.subject")}</label>
                <select id="subject" name="subject" className="input" dir="auto">
                  <option value="">{t("common.all")}</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.code}>{s.code} — {s.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="from">{t("practice.from")}</label>
                  <input id="from" name="from" type="number" min={1} className="input" dir="ltr" />
                </div>
                <div>
                  <label className="label" htmlFor="to">{t("practice.to")}</label>
                  <input id="to" name="to" type="number" min={1} className="input" dir="ltr" />
                </div>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="difficulty">{t("practice.difficulty")}</label>
              <select id="difficulty" name="difficulty" className="input">
                <option value="">{t("diff.mix")}</option>
                <option value="easy">{t("diff.easy")}</option>
                <option value="medium">{t("diff.medium")}</option>
                <option value="hard">{t("diff.hard")}</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="type">{t("arena.type")}</label>
              <select id="type" name="type" className="input">
                <option value="mixed">{t("arena.type.mixed")}</option>
                <option value="mcq">{t("arena.type.mcq")}</option>
                <option value="written">{t("arena.type.written")}</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="count">{t("practice.count")}</label>
              <select id="count" name="count" className="input" defaultValue="10" dir="ltr">
                {[5, 10, 20, 30, 50].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="minutes">{t("arena.time")}</label>
              <select id="minutes" name="minutes" className="input" defaultValue="0">
                <option value="0">{t("arena.time.none")}</option>
                {[5, 10, 20, 30].map((n) => (
                  <option key={n} value={n}>{n} {t("arena.minutes")}</option>
                ))}
              </select>
            </div>
          </div>
          <SubmitButton className="btn btn-primary w-full">{t("practice.start")}</SubmitButton>
        </form>
      </section>
    </div>
  );
}
