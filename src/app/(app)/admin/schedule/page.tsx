import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getAllSubjects } from "@/lib/data";
import { SLOTS, STUDY_DAYS } from "@/lib/constants";
import { addDays, formatDate, isValidISO, mondayOf, todayISO } from "@/lib/dates";
import { addSession, copyPreviousWeek, deleteSession, setSessionStatus } from "@/app/actions/schedule";
import { ActionForm } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm-button";
import { SessionCard } from "@/components/session-card";
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

  const [subjects, { data }] = await Promise.all([
    getAllSubjects(),
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
  const q = (w: string) => `/admin/schedule?w=${w}&c=${cohortId}`;
  const arrow = "size-4 rtl:rotate-180";

  return (
    <div className="space-y-6">
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
      <p className="text-xs text-muted">{t("sa.aiSoon")}</p>

      <div className="space-y-5">
        {STUDY_DAYS.map((d) => {
          const date = addDays(monday, d - 1);
          const list = sessions.filter((s) => s.session_date === date);
          return (
            <section key={d} aria-labelledby={`d-${d}`}>
              <h3 id={`d-${d}`} className="tech mb-2 flex items-baseline gap-2 text-sm font-semibold text-muted">
                {t(`day.${d}` as "day.1")} <span className="text-xs font-normal" dir="ltr">{formatDate(date, locale)}</span>
              </h3>
              {list.length === 0 ? (
                <p className="text-xs text-muted">{t("schedule.empty")}</p>
              ) : (
                <ul className="space-y-2">
                  {list.map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      subject={byId.get(s.subject_id)}
                      actions={
                        <div className="space-y-2 pt-1">
                          <form action={setSessionStatus} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="id" value={s.id} />
                            <input name="note" className="input !min-h-8 min-w-0 flex-1 text-xs" dir="auto" placeholder={t("sa.note")} defaultValue={s.note ?? ""} maxLength={200} />
                            {s.status !== "cancelled" && <button name="status" value="cancelled" className="btn btn-sm btn-danger">{t("sa.cancel")}</button>}
                            {s.status !== "changed" && <button name="status" value="changed" className="btn btn-sm">{t("schedule.changed")}</button>}
                            {s.status !== "scheduled" && <button name="status" value="scheduled" className="btn btn-sm">{t("sa.restore")}</button>}
                          </form>
                          <form action={deleteSession}>
                            <input type="hidden" name="id" value={s.id} />
                            <ConfirmButton>{t("common.delete")}</ConfirmButton>
                          </form>
                        </div>
                      }
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <details className="card" open={sessions.length === 0}>
        <summary className="cursor-pointer text-sm font-semibold">{t("sa.add")}</summary>
        <ActionForm action={addSession} submitLabel={t("common.add")} resetOnSuccess className="mt-4 space-y-4">
          <input type="hidden" name="cohort_id" value={cohortId} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="session_date">{t("common.date")}</label>
              <input id="session_date" name="session_date" type="date" className="input" dir="ltr" defaultValue={monday} required />
            </div>
            <div>
              <label className="label" htmlFor="slot">{t("sa.slot")}</label>
              <select id="slot" name="slot" className="input" dir="ltr" required>
                {SLOTS.map((s) => (
                  <option key={s.n} value={s.n}>{s.start}–{s.end}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="subject_id">{t("common.subject")}</label>
              <select id="subject_id" name="subject_id" className="input" dir="auto" required defaultValue="">
                <option value="" disabled></option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="kind">{t("common.type")}</label>
              <select id="kind" name="kind" className="input" required>
                <option value="cm">{t("kind.cm")}</option>
                <option value="td">{t("kind.td")}</option>
                <option value="tp">{t("kind.tp")}</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="room">{t("sa.room")}</label>
              <input id="room" name="room" className="input" dir="auto" maxLength={40} />
            </div>
            <div>
              <label className="label" htmlFor="teacher">{t("sa.teacher")} ({t("common.optional")})</label>
              <input id="teacher" name="teacher" className="input" dir="auto" maxLength={80} />
            </div>
            <div>
              <label className="label" htmlFor="shared_with">{t("sa.shared")} ({t("common.optional")})</label>
              <input id="shared_with" name="shared_with" className="input" dir="auto" maxLength={80} />
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="group_label">{t("sa.group")} ({t("common.optional")})</label>
              <input id="group_label" name="group_label" className="input" dir="ltr" maxLength={40} />
            </div>
          </div>
        </ActionForm>
      </details>
    </div>
  );
}
