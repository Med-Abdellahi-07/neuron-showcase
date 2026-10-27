import { getProfile } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSpace } from "@/lib/spaces";
import { getCurrentSubjects, getRemainingSubjects, getSemesterStart, visibleForGroup } from "@/lib/data";
import { appTimeZone, todayISO } from "@/lib/dates";
import { addDays, defaultWeekMonday } from "@/lib/weeks";
import { colorMap, toGridSession } from "@/lib/schedule-grid";
import type { ScheduleSession } from "@/lib/types";
import type { OfflineSnapshot } from "@/lib/offline/types";

export const dynamic = "force-dynamic";

/**
 * لقطة الجدول للتشغيل بدون إنترنت: الأسبوع الافتراضي + التالي، المواد المتبقية، اسم الفضاء والعرض.
 * لا بريد ولا هاتف ولا رموز ولا محادثات.
 */
export async function GET() {
  const profile = await getProfile();
  if (!profile) return Response.json({ error: "auth" }, { status: 401 });
  const [locale, space] = await Promise.all([getLocale(), getSpace()]);
  const today = todayISO();
  const defaultMonday = defaultWeekMonday(today);

  let sessions: OfflineSnapshot["sessions"] = [];
  let remainingOut: OfflineSnapshot["remaining"] = [];
  let semesterStart: string | null = null;
  if (profile.cohort_id) {
    const supabase = await createClient();
    const [current, remaining, sem] = await Promise.all([getCurrentSubjects(), getRemainingSubjects(), getSemesterStart()]);
    semesterStart = sem?.start ?? null;
    const subjects = [...current, ...remaining.filter((r) => !current.some((c) => c.id === r.id))];
    const { data } = await supabase
      .from("schedule_sessions")
      .select("*")
      .gte("session_date", defaultMonday)
      .lte("session_date", addDays(defaultMonday, 13))
      .or([`cohort_id.eq.${profile.cohort_id}`, ...(remaining.length ? [`subject_id.in.(${remaining.map((r) => r.id).join(",")})`] : [])].join(","))
      .order("session_date")
      .order("slot");
    const byId = new Map(subjects.map((s) => [s.id, s]));
    const colors = colorMap(current, remaining);
    sessions = ((data ?? []) as ScheduleSession[])
      .filter((s) => visibleForGroup(s, byId.get(s.subject_id)?.code, profile))
      .map((s) => toGridSession(s, byId.get(s.subject_id), colors.get(s.subject_id) ?? 0, s.cohort_id !== profile.cohort_id));
    remainingOut = remaining.map((r) => ({ id: r.id, code: r.code, name: r.name }));
  }

  const snap: OfflineSnapshot = {
    userId: profile.id,
    name: profile.full_name,
    space: space?.name ?? "",
    locale,
    tz: appTimeZone(),
    savedAt: Date.now(),
    semesterStart,
    defaultMonday,
    sessions,
    remaining: remainingOut,
    features: { ai: space?.features.ai === true, chat: space?.features.chat === true, ranking: space?.features.ranking === true },
  };
  return Response.json(snap, { headers: { "Cache-Control": "no-store" } });
}
