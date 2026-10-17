import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getAllSubjects, getCurrentSubjects } from "@/lib/data";
import { addDays, appTimeZone, formatDate, isValidISO, mondayOf, nowHM, todayISO } from "@/lib/dates";
import { colorMap, toGridSession } from "@/lib/schedule-grid";
import { copyPreviousWeek } from "@/app/actions/schedule";
import { ScheduleAi } from "@/components/schedule-ai";
import { ScheduleGrid } from "@/components/schedule-grid";
import type { ScheduleSession } from "@/lib/types";

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireStaff();
  const { t, locale } = await getT();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const monday = mondayOf(isValidISO(one(sp.w)) ? (one(sp.w) as string) : todayISO());

  const supabase = await createClient();
  const { data: cohorts } = await supabase.from("cohorts").select("id, name").order("name");
  const cohortList = (cohorts ?? []) as { id: string; name: string }[];
  const cohortId =
    cohortList.find((c) => c.id === one(sp.c))?.id ?? cohortList.find((c) => c.id === profile.cohort_id)?.id ?? cohortList[0]?.id;

  if (!cohortId) return <p className="card text-sm text-warn">{t("schedule.noCohort")}</p>;

  const [subjects, current, { data }] = await Promise.all([
    getAllSubjects(),
    getCurrentSubjects(),
    supabase
      .from("schedule_sessions")
      .select("*")
      .eq("cohort_id", cohortId)
      .gte("session_date", monday)
      .lte("session_date", addDays(monday, 6))
      .order("session_date")
      .order("slot"),
  ]);
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const sessions = (data ?? []) as ScheduleSession[];
  const colors = colorMap(current, subjects);
  const gridSessions = sessions.map((x) => toGridSession(x, byId.get(x.subject_id), colors.get(x.subject_id) ?? 0));
  const q = (w: string) => `/admin/schedule?w=${w}&c=${cohortId}`;
  const arrow = "size-4 rtl:rotate-180";

  return (
    <div className="wide-page space-y-6">
      {cohortList.length > 1 && (
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="w" value={monday} />
          <div className="flex-1">
            <label className="label" htmlFor="c">{t("acc.cohort")}</label>
            <select id="c" name="c" className="input" defaultValue={cohortId}>
              {cohortList.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <button className="btn">OK</button>
        </form>
      )}

      <div className="flex items-center justify-between gap-2">
        <Link href={q(addDays(monday, -7))} className="btn btn-sm" aria-label={t("schedule.prev")}><ChevronLeft className={arrow} aria-hidden /></Link>
        <p className="tech text-sm font-semibold" dir="ltr">{formatDate(monday, locale)} → {formatDate(addDays(monday, 5), locale)}</p>
        <Link href={q(addDays(monday, 7))} className="btn btn-sm" aria-label={t("schedule.next")}><ChevronRight className={arrow} aria-hidden /></Link>
      </div>

      <form action={copyPreviousWeek}>
        <input type="hidden" name="cohort_id" value={cohortId} />
        <input type="hidden" name="week" value={monday} />
        <button className="btn btn-sm">{t("sa.copyPrev")}</button>
      </form>
      <ScheduleAi cohortId={cohortId} week={monday} subjects={subjects.map((s) => ({ id: s.id, code: s.code }))} />

      <ScheduleGrid
        key={`${monday}|${cohortId}`}
        mode="admin"
        monday={monday}
        today={todayISO()}
        nowHM={nowHM()}
        tz={appTimeZone()}
        sessions={gridSessions}
        admin={{ cohortId, subjects: subjects.map((x) => ({ id: x.id, code: x.code, name: x.name })) }}
      />
    </div>
  );
}
