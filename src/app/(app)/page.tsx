import Link from "next/link";
import { CalendarClock, DoorOpen, Hourglass, Megaphone, Pin, Repeat, Swords } from "lucide-react";
import { ProgressRing } from "@/components/progress-ring";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { getSpace } from "@/lib/spaces";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects, getRemainingSubjects, hasEnded, visibleForGroup } from "@/lib/data";
import { SLOTS } from "@/lib/constants";
import { formatDate, todayISO } from "@/lib/dates";
import { studyDateFrom } from "@/lib/weeks";
import type { Announcement, ScheduleSession } from "@/lib/types";
import { hoursLeft, type DuelItem } from "@/lib/duel";

export default async function HomePage() {
  const profile = await requireProfile();
  const { t, locale } = await getT();
  const supabase = await createClient();
  const today = todayISO();
  const cohortId = profile.cohort_id;
  const features = (await getSpace())?.features;

  // كل هذه الاستعلامات مستقلة عن بعضها، فتُنفَّذ معاً في موجة واحدة
  const remaining = await getRemainingSubjects(); // مواد متبقية من L1 (طالب L2 فقط)
  const sessionFilter = [`cohort_id.eq.${cohortId}`, ...(remaining.length ? [`subject_id.in.(${remaining.map((r) => r.id).join(",")})`] : [])].join(",");
  const [subjects, sessionsRes, annsRes, lessonsRes, progressRes, dueRes, duelsRes] = await Promise.all([
    getCurrentSubjects(),
    cohortId
      ? supabase
          .from("schedule_sessions")
          .select("*")
          .or(sessionFilter)
          .gte("session_date", studyDateFrom(today))
          .neq("status", "cancelled")
          .order("session_date")
          .order("slot")
          .limit(40)
      : null,
    cohortId
      ? supabase
          .from("announcements")
          .select("*")
          .eq("cohort_id", cohortId)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          .order("pinned", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(5)
      : null,
    supabase.from("lessons").select("id, subject_id").neq("kind", "resume").eq("status", "published"),
    supabase.from("lesson_progress").select("lesson_id").eq("user_id", profile.id),
    supabase
      .from("review_queue")
      .select("question_id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("mastered", false)
      .lte("due_at", new Date().toISOString()),
    supabase.rpc("my_duels"),
  ]);
  const myTurn = ((duelsRes.data ?? []) as DuelItem[]).filter((d) => (d.status === "open" && !d.i_am_challenger && !d.my_finished) || (d.status === "challenger_turn" && d.i_am_challenger));
  const soonest = myTurn.filter((d) => d.status === "open").sort((a, b) => hoursLeft(a.expires_at) - hoursLeft(b.expires_at))[0];

  const byId = new Map([...subjects, ...remaining].map((s) => [s.id, s]));
  const ownIds = new Set(subjects.map((s) => s.id)); // التقدّم لمواد فضائي فقط؛ المتبقية في قسمها
  const next =
    ((sessionsRes?.data ?? []) as ScheduleSession[]).find(
      (s) => !hasEnded(s, today) && visibleForGroup(s, byId.get(s.subject_id)?.code, profile)
    ) ?? null;
  const announcements = (annsRes?.data ?? []) as Announcement[];

  // التقدم: الحصص المنشورة (CM/TD/TP) في مواد السداسي الحالي مقابل ما درسه الطالب
  const lessonIds = new Set(
    (lessonsRes.data ?? []).filter((l) => ownIds.has(l.subject_id as string)).map((l) => l.id as string)
  );
  const total = lessonIds.size;
  const studied = (progressRes.data ?? []).filter((p) => lessonIds.has(p.lesson_id as string)).length;
  const dueCount = dueRes.count ?? 0;
  const pct = total ? Math.round((studied / total) * 100) : 0;
  const nextSubject = next ? byId.get(next.subject_id) : undefined;
  const nextSlot = next ? SLOTS.find((s) => s.n === next!.slot) : undefined;

  // تقدّم كل مادة (حلقة لكل مادة) من الحصص المنشورة
  const subjectOf = new Map((lessonsRes.data ?? []).map((l) => [l.id as string, l.subject_id as string]));
  const perSubject = new Map<string, { done: number; total: number }>();
  for (const [lid, sid] of subjectOf) {
    if (!ownIds.has(sid)) continue;
    const e = perSubject.get(sid) ?? { done: 0, total: 0 };
    e.total += 1;
    if ((progressRes.data ?? []).some((p) => p.lesson_id === lid)) e.done += 1;
    perSubject.set(sid, e);
  }
  const ringSubjects = subjects.filter((s) => (perSubject.get(s.id)?.total ?? 0) > 0);
  const firstName = profile.full_name.split(" ")[0];

  return (
    <div className="space-y-4">
      <header className="pb-1">
        <div className="min-w-0">
          <p className="text-[13px] text-muted">{t("home.greeting")}</p>
          <h1 className="truncate text-2xl font-semibold" dir="auto">{firstName}</h1>
        </div>
      </header>

      {!profile.cohort_id && <p className="card text-sm text-warn">{t("home.noCohort")}</p>}

      <section className="card-featured space-y-3" aria-labelledby="next-h">
        <div className="flex items-center justify-between gap-2">
          <h2 id="next-h" className="flex items-center gap-2 text-[13px] font-medium opacity-90">
            <CalendarClock size={16} strokeWidth={1.9} aria-hidden /> {t("home.nextSession")}
          </h2>
          {next && nextSlot && (
            <span className="tech rounded-full bg-black/15 px-3 py-1 text-xs font-medium" dir="ltr">
              {formatDate(next.session_date, locale)} · {nextSlot.start}
            </span>
          )}
        </div>
        {next && nextSubject && nextSlot ? (
          <Link href="/schedule" className="block space-y-3">
            <p className="text-[19px] font-semibold leading-snug" dir="auto">{nextSubject.name}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-black/15 px-3 py-1">{t(`kind.${next.kind}`)}</span>
              {next.cohort_id !== cohortId && <span className="tech rounded-full bg-black/15 px-3 py-1" dir="ltr">L1</span>}
              <span className="tech inline-flex items-center gap-1 rounded-full bg-black/15 px-3 py-1" dir="ltr">
                <Hourglass size={12} strokeWidth={1.9} aria-hidden /> {nextSlot.start}–{nextSlot.end}
              </span>
              {next.room && (
                <span className="tech inline-flex items-center gap-1 rounded-full bg-black/15 px-3 py-1" dir="ltr">
                  <DoorOpen size={12} strokeWidth={1.9} aria-hidden /> {next.room}
                </span>
              )}
            </div>
          </Link>
        ) : (
          <p className="text-sm opacity-90">{t("home.noSession")}</p>
        )}
      </section>

      {(features?.review || features?.duel) && (
      <div className={`grid gap-3 ${features?.review && features?.duel ? "grid-cols-2" : "grid-cols-1"}`}>
        {features?.review && (
        <Link href={dueCount > 0 ? "/practice" : "/practice/mistakes"} className="card press flex items-center gap-3">
          <span className="icon-box size-10"><Repeat size={20} strokeWidth={1.9} aria-hidden /></span>
          <span className="min-w-0">
            {dueCount > 0 && <span className="tech block text-xl font-semibold leading-none">{dueCount}</span>}
            <span className="mt-1 block text-xs leading-snug text-muted">{t(dueCount > 0 ? "home.reviewsDue" : "home.reviewsNone")}</span>
          </span>
        </Link>
        )}
        {features?.duel && (myTurn.length > 0 ? (
          <Link href="/practice/duel" className="card press flex items-center gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--r-icon)] bg-urgent-bg text-urgent">
              <Swords size={20} strokeWidth={1.9} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="tech block text-xl font-semibold leading-none text-urgent">{myTurn.length}</span>
              <span className="mt-1 block text-xs leading-snug text-muted">
                {t("home.duelsPending")}
                {soonest && <span className="badge-urgent ms-1 !px-2 !py-0 tech" dir="ltr">{hoursLeft(soonest.expires_at)}h</span>}
              </span>
            </span>
          </Link>
        ) : (
          <Link href="/practice/duel" className="card press flex items-center gap-3">
            <span className="icon-box size-10"><Swords size={20} strokeWidth={1.9} aria-hidden /></span>
            <span className="text-xs leading-snug text-muted">{t("duel.tab")}</span>
          </Link>
        ))}
      </div>
      )}

      <section className="card-lg space-y-4" aria-labelledby="progress-h">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="progress-h" className="text-[13px] font-medium text-muted">{t("home.progress")}</h2>
          <span className="text-xs text-muted">
            <span className="tech font-semibold text-fg" dir="ltr">{pct}%</span> · {studied} {t("home.studiedOf")} {total}
          </span>
        </div>
        {ringSubjects.length > 0 ? (
          <ul className="flex flex-wrap justify-center gap-x-3 gap-y-4">
            {ringSubjects.map((s) => {
              const e = perSubject.get(s.id)!;
              return (
                <li key={s.id} className="w-[30%] min-w-24">
                  <Link href={`/subjects/${s.code}`} className="press flex flex-col items-center gap-2 text-center">
                    <ProgressRing done={e.done} total={e.total} />
                    <span className="line-clamp-2 text-[11px] leading-snug text-muted" dir="auto">{s.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex justify-center"><ProgressRing done={studied} total={total} size={80} /></div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="ann-h">
        <h2 id="ann-h" className="flex items-center gap-2 text-[13px] font-medium text-muted">
          <Megaphone size={16} strokeWidth={1.9} aria-hidden /> {t("home.announcements")}
        </h2>
        {announcements.length === 0 ? (
          <p className="text-sm text-muted">{t("home.noAnnouncements")}</p>
        ) : (
          announcements.map((a) => (
            <article key={a.id} className="rounded-[20px] bg-announce p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{a.title}</h3>
                {a.pinned && <Pin size={16} strokeWidth={1.9} className="mt-0.5 shrink-0 text-accent" aria-label={t("ann.pinned")} />}
              </div>
              {a.body && <p className="mt-1 whitespace-pre-line text-sm text-muted">{a.body}</p>}
              <p className="tech mt-2 text-xs text-muted" dir="ltr">{a.created_at.slice(0, 10)}</p>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
