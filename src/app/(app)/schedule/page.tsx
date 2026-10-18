import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects, getSemesterStart, hasEnded, visibleForGroup } from "@/lib/data";
import { ENGLISH_CODE, SESSION_KINDS, sessionsFromHours } from "@/lib/constants";
import { appTimeZone, isValidISO, nowHM, todayISO } from "@/lib/dates";
import { addDays, defaultWeekMonday, mondayOf } from "@/lib/weeks";
import { WeekNav } from "@/components/week-nav";
import { VIEW_COOKIE, colorMap, toGridSession } from "@/lib/schedule-grid";
import { ScheduleGrid } from "@/components/schedule-grid";
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
  // الإثنين–السبت: الأسبوع الحالي؛ الأحد: القادم مباشرة (لا دراسة يوم الأحد)
  const defaultMonday = defaultWeekMonday(today);
  const monday = isValidISO(raw) ? mondayOf(raw) : defaultMonday;

  if (!profile.cohort_id) {
    return (
      <div>
        <h1 className="page-title">{t("schedule.title")}</h1>
        <p className="card text-sm text-warn">{t("schedule.noCohort")}</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [subjects, sem, { data }] = await Promise.all([
    getCurrentSubjects(),
    getSemesterStart(),
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
  const colors = colorMap(subjects);
  const gridSessions = week.map((s) => toGridSession(s, byId.get(s.subject_id), colors.get(s.subject_id) ?? 0));
  const initialView = (await cookies()).get(VIEW_COOKIE)?.value === "day" ? "day" : "grid";
  // لم يختر مجموعة الإنجليزية: تظهر كل المجموعات، فننبّهه
  const showGroupHint = !profile.english_group && week.some((s) => byId.get(s.subject_id)?.code === ENGLISH_CODE && s.group_label);

  // عدّاد الحصص المنجزة (الحصة = 1.5 ساعة)، ما عدا الملغاة
  const done = new Map<string, number>();
  for (const s of all) {
    if (s.status === "cancelled" || !hasEnded(s, today)) continue;
    const key = `${s.subject_id}:${s.kind}`;
    done.set(key, (done.get(key) ?? 0) + 1);
  }

  return (
    <div className="wide-page compact space-y-6">
      <h1 className="page-title !mb-0">{t("schedule.title")}</h1>

      <WeekNav
        monday={monday}
        defaultMonday={defaultMonday}
        semesterStart={sem?.start ?? null}
        locale={locale}
        hrefFor={(w) => (w ? `/schedule?w=${w}` : "/schedule")}
        labels={{ week: t("schedule.week"), prev: t("schedule.prev"), next: t("schedule.next"), thisWeek: t("schedule.thisWeek") }}
      />

      <ScheduleGrid
        key={monday}
        mode="student"
        monday={monday}
        today={today}
        nowHM={nowHM()}
        tz={appTimeZone()}
        sessions={gridSessions}
        initialView={initialView}
      />
      {showGroupHint && <p className="text-xs text-warn">{t("schedule.pickGroup")}</p>}

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
