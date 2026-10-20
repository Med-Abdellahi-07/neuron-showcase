import { isManagerRole, requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getAllSubjects, getCurrentSubjects, getSemesterStart } from "@/lib/data";
import { appTimeZone, isValidISO, nowHM, todayISO } from "@/lib/dates";
import { addDays, defaultWeekMonday, mondayOf } from "@/lib/weeks";
import { getSpace } from "@/lib/spaces";
import { WeekNav } from "@/components/week-nav";
import { colorMap, toGridSession } from "@/lib/schedule-grid";
import { copyPreviousWeek, setSemesterStart } from "@/app/actions/schedule";
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
  const defaultMonday = defaultWeekMonday(todayISO());
  const monday = isValidISO(one(sp.w)) ? mondayOf(one(sp.w) as string) : defaultMonday;

  const space = await getSpace();
  const supabase = await createClient();
  const { data: cohorts } = await supabase.from("cohorts").select("id, name").eq("id", profile.cohort_id ?? "");
  const cohortList = (cohorts ?? []) as { id: string; name: string }[];
  const cohortId =
    cohortList.find((c) => c.id === one(sp.c))?.id ?? cohortList.find((c) => c.id === profile.cohort_id)?.id ?? cohortList[0]?.id;

  if (!cohortId) return <p className="card text-sm text-warn">{t("schedule.noCohort")}</p>;

  const [subjects, current, sem, { data }] = await Promise.all([
    getAllSubjects(),
    getCurrentSubjects(),
    getSemesterStart(),
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

  return (
    <div className="wide-page compact space-y-6">
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

      <WeekNav
        monday={monday}
        defaultMonday={defaultMonday}
        semesterStart={sem?.start ?? null}
        locale={locale}
        hrefFor={(w) => `/admin/schedule?${w ? `w=${w}&` : ""}c=${cohortId}`}
        labels={{ week: t("schedule.week"), prev: t("schedule.prev"), next: t("schedule.next"), thisWeek: t("schedule.thisWeek") }}
      />

      {isManagerRole(profile.role) && sem && (
        <form action={setSemesterStart} className="card flex flex-wrap items-end gap-2">
          <input type="hidden" name="semester_id" value={sem.id} />
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="sem-start">{t("schedule.semStart")}</label>
            <input id="sem-start" name="start_date" type="date" className="input" defaultValue={sem.start ?? ""} dir="ltr" />
          </div>
          <button className="btn btn-sm">{t("schedule.semStartSave")}</button>
          <p className="w-full text-xs text-muted">{t("schedule.semStartHelp")}</p>
        </form>
      )}

      <form action={copyPreviousWeek}>
        <input type="hidden" name="cohort_id" value={cohortId} />
        <input type="hidden" name="week" value={monday} />
        <button className="btn btn-sm">{t("sa.copyPrev")}</button>
      </form>
      {space?.features.ai && <ScheduleAi cohortId={cohortId} week={monday} subjects={subjects.map((s) => ({ id: s.id, code: s.code }))} />}

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
