import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects, hasEnded, visibleForGroup } from "@/lib/data";
import { SESSION_KINDS, STUDY_DAYS, sessionsFromHours } from "@/lib/constants";
import { addDays, formatDate, isValidISO, mondayOf, todayISO } from "@/lib/dates";
import { SessionCard } from "@/components/session-card";
import type { ScheduleSession, SessionKind } from "@/lib/types";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfile();
  const { t, locale } = await getT();
  const sp = await searchParams;
  const raw = Array.isArray(sp.w) ? sp.w[0] : sp.w;
  const today = todayISO();
  const monday = mondayOf(isValidISO(raw) ? raw : today);
  const thisMonday = mondayOf(today);

  if (!profile.cohort_id) {
    return (
      <div>
        <h1 className="page-title">{t("schedule.title")}</h1>
        <p className="card text-sm text-warn">{t("schedule.noCohort")}</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [subjects, { data }] = await Promise.all([
    getCurrentSubjects(),
    supabase
      .from("schedule_sessions")
      .select("*")
      .eq("cohort_id", profile.cohort_id)
      .order("session_date")
      .order("slot"),
  ]);
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const all = ((data ?? []) as ScheduleSession[]).filter((s) =>
    visibleForGroup(s, byId.get(s.subject_id)?.code, profile)
  );

  const weekEnd = addDays(monday, 6);
  const week = all.filter((s) => s.session_date >= monday && s.session_date <= weekEnd);

  // عدّاد الحصص المنجزة (الحصة = 1.5 ساعة)، ما عدا الملغاة
  const done = new Map<string, number>();
  for (const s of all) {
    if (s.status === "cancelled" || !hasEnded(s, today)) continue;
    const key = `${s.subject_id}:${s.kind}`;
    done.set(key, (done.get(key) ?? 0) + 1);
  }

  const arrow = "size-4 rtl:rotate-180";
  return (
    <div className="space-y-6">
      <h1 className="page-title !mb-0">{t("schedule.title")}</h1>

      <div className="flex items-center justify-between gap-2">
        <Link href={`/schedule?w=${addDays(monday, -7)}`} className="btn btn-sm" aria-label={t("schedule.prev")}>
          <ChevronLeft className={arrow} aria-hidden />
        </Link>
        <div className="text-center">
          <p className="tech text-sm font-semibold" dir="ltr">
            {formatDate(monday, locale)} → {formatDate(addDays(monday, 5), locale)}
          </p>
          {monday !== thisMonday && (
            <Link href="/schedule" className="text-xs text-accent hover:underline">{t("schedule.thisWeek")}</Link>
          )}
        </div>
        <Link href={`/schedule?w=${addDays(monday, 7)}`} className="btn btn-sm" aria-label={t("schedule.next")}>
          <ChevronRight className={arrow} aria-hidden />
        </Link>
      </div>

      <div className="space-y-5">
        {STUDY_DAYS.map((d) => {
          const date = addDays(monday, d - 1);
          const sessions = week.filter((s) => s.session_date === date);
          return (
            <section key={d} aria-labelledby={`day-${d}`}>
              <h2 id={`day-${d}`} className={`tech mb-2 flex items-baseline gap-2 text-sm font-semibold ${date === today ? "text-accent" : "text-muted"}`}>
                {t(`day.${d}` as "day.1")}
                <span className="text-xs font-normal" dir="ltr">{formatDate(date, locale)}</span>
              </h2>
              {sessions.length === 0 ? (
                <p className="text-xs text-muted">{t("schedule.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {sessions.map((s) => (
                    <SessionCard key={s.id} session={s} subject={byId.get(s.subject_id)} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section className="space-y-3" aria-labelledby="counter-h">
        <h2 id="counter-h" className="tech text-sm font-semibold text-muted">{t("schedule.counter")}</h2>
        <ul className="space-y-3">
          {subjects.map((s) => {
            const rows = SESSION_KINDS.map((k) => ({
              kind: k as SessionKind,
              total: sessionsFromHours(s[`${k}_hours` as "cm_hours"]),
              done: done.get(`${s.id}:${k}`) ?? 0,
            })).filter((r) => r.total > 0);
            const total = rows.reduce((a, r) => a + r.total, 0);
            const doneSum = rows.reduce((a, r) => a + Math.min(r.done, r.total), 0);
            const pct = total ? Math.round((doneSum / total) * 100) : 0;
            return (
              <li key={s.id} className="card space-y-2 !p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium" dir="auto">{s.name}</p>
                  <span className="tech shrink-0 text-xs text-muted" dir="ltr">{doneSum}/{total}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rows.map((r) => (
                    <span key={r.kind} className="badge tech" dir="ltr">
                      {t(`kind.${r.kind}`)} {r.done}/{r.total}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
