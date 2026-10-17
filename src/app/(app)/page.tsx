import Link from "next/link";
import { CalendarClock, Megaphone, Repeat, Swords } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { COMMA } from "@/lib/i18n/dictionaries";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects, hasEnded, visibleForGroup } from "@/lib/data";
import { SLOTS } from "@/lib/constants";
import { formatDate, todayISO } from "@/lib/dates";
import type { Announcement, ScheduleSession } from "@/lib/types";
import { hoursLeft, type DuelItem } from "@/lib/duel";

export default async function HomePage() {
  const profile = await requireProfile();
  const { t, locale } = await getT();
  const supabase = await createClient();
  const today = todayISO();
  const cohortId = profile.cohort_id;

  // كل هذه الاستعلامات مستقلة عن بعضها، فتُنفَّذ معاً في موجة واحدة
  const [subjects, sessionsRes, annsRes, lessonsRes, progressRes, dueRes, duelsRes] = await Promise.all([
    getCurrentSubjects(),
    cohortId
      ? supabase
          .from("schedule_sessions")
          .select("*")
          .eq("cohort_id", cohortId)
          .gte("session_date", today)
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

  const byId = new Map(subjects.map((s) => [s.id, s]));
  const next =
    ((sessionsRes?.data ?? []) as ScheduleSession[]).find(
      (s) => !hasEnded(s, today) && visibleForGroup(s, byId.get(s.subject_id)?.code, profile)
    ) ?? null;
  const announcements = (annsRes?.data ?? []) as Announcement[];

  // التقدم: الحصص المنشورة (CM/TD/TP) في مواد السداسي الحالي مقابل ما درسه الطالب
  const lessonIds = new Set(
    (lessonsRes.data ?? []).filter((l) => byId.has(l.subject_id as string)).map((l) => l.id as string)
  );
  const total = lessonIds.size;
  const studied = (progressRes.data ?? []).filter((p) => lessonIds.has(p.lesson_id as string)).length;
  const dueCount = dueRes.count ?? 0;
  const pct = total ? Math.round((studied / total) * 100) : 0;
  const nextSubject = next ? byId.get(next.subject_id) : undefined;
  const nextSlot = next ? SLOTS.find((s) => s.n === next!.slot) : undefined;

  return (
    <div className="space-y-6">
      <h1 className="page-title !mb-0">
        {t("home.greeting")}{COMMA[locale]} {profile.full_name.split(" ")[0]}
      </h1>

      {!profile.cohort_id && <p className="card text-sm text-warn">{t("home.noCohort")}</p>}

      <section className="card space-y-2" aria-labelledby="next-h">
        <h2 id="next-h" className="tech flex items-center gap-2 text-sm font-semibold text-muted">
          <CalendarClock size={16} aria-hidden /> {t("home.nextSession")}
        </h2>
        {next && nextSubject && nextSlot ? (
          <Link href="/schedule" className="block">
            <p className="font-semibold">{nextSubject.name}</p>
            <p className="tech mt-1 text-sm text-muted" dir="ltr">
              {t(`kind.${next.kind}`)} · {formatDate(next.session_date, locale)} · {nextSlot.start}–{nextSlot.end}
              {next.room ? ` · ${next.room}` : ""}
            </p>
          </Link>
        ) : (
          <p className="text-sm text-muted">{t("home.noSession")}</p>
        )}
      </section>

      <Link href={dueCount > 0 ? "/practice" : "/practice/mistakes"} className="card flex items-center justify-between gap-3">
        <span className="tech flex items-center gap-2 text-sm font-semibold text-muted">
          <Repeat size={16} aria-hidden /> {t(dueCount > 0 ? "home.reviewsDue" : "home.reviewsNone")}
        </span>
        {dueCount > 0 && <span className="tech text-2xl font-semibold text-accent" dir="ltr">{dueCount}</span>}
      </Link>

      {myTurn.length > 0 && (
        <Link href="/practice/duel" className="card flex items-center justify-between gap-3 border-accent">
          <span className="tech flex items-center gap-2 text-sm font-semibold">
            <Swords size={16} aria-hidden className="text-accent" /> {t("home.duelsPending")}
          </span>
          <span className="text-end">
            <span className="tech block text-2xl font-semibold text-accent" dir="ltr">{myTurn.length}</span>
            {soonest && <span className="text-xs text-muted">{t("duel.hoursLeft")}: {hoursLeft(soonest.expires_at)}h</span>}
          </span>
        </Link>
      )}

      <section className="card space-y-3" aria-labelledby="progress-h">
        <h2 id="progress-h" className="tech text-sm font-semibold text-muted">{t("home.progress")}</h2>
        <div className="flex items-baseline gap-2">
          <span className="tech text-3xl font-semibold" dir="ltr">{pct}%</span>
          <span className="text-sm text-muted">
            {studied} {t("home.studiedOf")} {total}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="ann-h">
        <h2 id="ann-h" className="tech flex items-center gap-2 text-sm font-semibold text-muted">
          <Megaphone size={16} aria-hidden /> {t("home.announcements")}
        </h2>
        {announcements.length === 0 ? (
          <p className="text-sm text-muted">{t("home.noAnnouncements")}</p>
        ) : (
          announcements.map((a) => (
            <article key={a.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{a.title}</h3>
                {a.pinned && <span className="badge badge-accent">📌</span>}
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
