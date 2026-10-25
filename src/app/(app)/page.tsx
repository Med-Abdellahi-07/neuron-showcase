import Link from "next/link";
import { Megaphone, Pin } from "lucide-react";
import { ProgressRing } from "@/components/progress-ring";
import { ClayBolt, ClayBook, ClayCalendar, ClayCap, ClayCheck, ClayFlame } from "@/components/clay";
import { Tilt } from "@/components/tilt";
import { SpaceSwitcher } from "@/components/space-switcher";
import { getSpaceOptions } from "@/lib/space-options";
import { Achievement } from "@/components/achievement";
import { activeDaysInWeek, computeStreak, pct as pctOf, streakMilestone, WEEK_GOAL_DAYS, weekGoalPct } from "@/lib/home-stats";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { getSpace } from "@/lib/spaces";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects, getRemainingSubjects, getSemesterStart, hasEnded, visibleForGroup } from "@/lib/data";
import { SLOTS } from "@/lib/constants";
import { appTimeZone, formatDate, nowHM, todayISO } from "@/lib/dates";
import { addDays, dateInZone, defaultWeekMonday, studyDateFrom, weekNumber } from "@/lib/weeks";
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
  const [subjects, sessionsRes, annsRes, lessonsRes, progressRes, dueRes, duelsRes, answersRes, totalAnsRes, okAnsRes, options, sem] = await Promise.all([
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
    supabase.from("lesson_progress").select("lesson_id, studied_at").eq("user_id", profile.id),
    supabase
      .from("review_queue")
      .select("question_id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("mastered", false)
      .lte("due_at", new Date().toISOString()),
    supabase.rpc("my_duels"),
    supabase.from("attempt_answers").select("answered_at").eq("user_id", profile.id).order("answered_at", { ascending: false }).limit(400),
    supabase.from("attempt_answers").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
    supabase.from("attempt_answers").select("id", { count: "exact", head: true }).eq("user_id", profile.id).eq("is_correct", true),
    profile.role === "admin" ? getSpaceOptions() : Promise.resolve([]),
    getSemesterStart(),
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
  const space = await getSpace();

  // السلسلة: أيام متتالية فيها إجابة أو حصة مدروسة (بتوقيت التطبيق)
  const tz = appTimeZone();
  const dayOf = (v: unknown) => {
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : dateInZone(d, tz);
  };
  const activeDays = [
    ...(answersRes.data ?? []).map((r) => dayOf(r.answered_at)),
    ...(progressRes.data ?? []).map((r) => dayOf(r.studied_at)),
  ].filter((d): d is string => d !== null);
  const streak = computeStreak(activeDays, today);
  const monday = defaultWeekMonday(today);
  const weekDays = activeDaysInWeek(activeDays, monday);
  const wins = ((duelsRes.data ?? []) as DuelItem[]).filter((d) => d.status === "completed" && d.result?.won).length;
  const mastery = pctOf(okAnsRes.count ?? 0, totalAnsRes.count ?? 0);
  const weekNo = weekNumber(defaultWeekMonday(today), sem?.start);
  const hour = Number(nowHM().slice(0, 2));
  const dayOfMonth = String(Number(today.slice(8, 10)));
  const nextWhen = next ? (next.session_date === today ? t("home.today") : next.session_date === addDays(today, 1) ? t("home.tomorrow") : formatDate(next.session_date, locale)) : "";
  const C = 2 * Math.PI * 40; // محيط دائرة الإتقان (r=40)

  const shortcuts = [
    { href: "/subjects", label: t("home.lessons"), bg: "#EFE9FF", icon: <ClayBook variant="tile" className="clays" /> },
    { href: "/practice", label: "QCM", bg: "#E3F6EE", icon: <ClayCheck variant="tile" className="clays" /> },
    ...(features?.duel ? [{ href: "/practice/duel", label: "Duel", bg: "#FFF1DE", icon: <ClayBolt className="clays" /> }] : []),
    { href: "/schedule", label: t("nav.schedule"), bg: "#FFE6EF", icon: <ClayCalendar variant="tile" day={dayOfMonth} className="clays" /> },
  ];

  return (
    <div className="bleed-page">
      <Achievement
        name={firstName}
        streak={streak}
        streakMilestone={streakMilestone(streak)}
        weekGoalKey={weekDays >= WEEK_GOAL_DAYS ? monday : null}
        goalPct={weekGoalPct(weekDays)}
        wins={wins}
      />
      <header className="relative h-[262px] overflow-hidden rounded-b-[var(--r-head)] bg-deep px-5 pt-[22px] text-white">
        <svg viewBox="0 0 390 262" preserveAspectRatio="xMidYMin slice" aria-hidden="true" className="absolute inset-0 size-full">
          <circle cx="-20" cy="40" r="110" fill="#3A1A8C" />
          <circle cx="380" cy="230" r="90" fill="#341583" />
          <g stroke="#5A3BB8" strokeWidth="1.2" fill="none" opacity="0.8"><path d="M300 30 L340 70 L320 120" /><path d="M60 170 L100 200 L80 240" /></g>
          <g fill="#7C5CE6"><circle cx="300" cy="30" r="3" /><circle cx="340" cy="70" r="3.5" /><circle cx="320" cy="120" r="3" /><circle cx="60" cy="170" r="3" /><circle cx="100" cy="200" r="3.5" /></g>
        </svg>
        <div className="relative mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/profile" className="flex items-center gap-2.5">
            <span className="flex size-[42px] items-center justify-center rounded-full bg-gold font-bold text-deep">{profile.full_name.trim().charAt(0).toUpperCase() || "?"}</span>
            <span className="flex flex-col">
              <span className="text-xs text-on-dark">{t(hour < 12 ? "home.goodMorning" : "home.goodEvening")}</span>
              <span className="text-[17px] font-semibold" dir="auto">{firstName}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {profile.role === "admin" && space && <SpaceSwitcher current={space.id} options={options} />}
            <Link href="/profile#notif-h" aria-label={t("home.notifications")} className="press relative flex size-[42px] items-center justify-center rounded-[14px] border border-[#4A2BA6] bg-deep-2 text-white">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
              {dueCount + myTurn.length > 0 && <span className="absolute right-[9px] top-2 size-2 rounded-full bg-pink" />}
            </Link>
          </div>
        </div>
        <div className="hfa clay absolute left-3.5 top-[92px]" aria-hidden="true"><ClayCap variant="home" /></div>
        <div className="hfb clay absolute right-4 top-[104px]" aria-hidden="true"><ClayBook variant="gold" /></div>
        <Link href="/progress" className="relative mx-auto mt-[22px] flex max-w-3xl flex-col items-center gap-0.5">
          <span className="text-[13px] text-on-dark">{t("home.weekProgress")}</span>
          <span className="tech text-[46px] font-bold leading-[1.1]">{pct}%</span>
          <span className="text-xs text-on-dark">{studied} {t("home.studiedOf")} {total}{weekNo ? ` · ${t("home.weekN").replace("{n}", String(weekNo))}` : ""}</span>
        </Link>
      </header>

      <div className="relative mx-auto max-w-3xl px-5">
        <nav aria-label="shortcuts" className="relative z-[1] -mt-10 grid rounded-[22px] bg-surface px-1.5 py-3.5 shadow-[var(--shadow-float)]" style={{ gridTemplateColumns: `repeat(${shortcuts.length}, minmax(0, 1fr))` }}>
          {shortcuts.map((x) => (
            <Link key={x.href} href={x.href} className="press flex flex-col items-center gap-1.5 text-xs">
              <span className="flex size-[46px] items-center justify-center rounded-2xl" style={{ background: x.bg }}>{x.icon}</span>
              {x.label}
            </Link>
          ))}
        </nav>

        <div className="mt-3.5 space-y-3 pb-4">
          {!profile.cohort_id && <p className="card text-sm text-warn">{t("home.noCohort")}</p>}

          {next && nextSubject && nextSlot ? (
            <Link href="/schedule" className="press flex items-center gap-3 rounded-[22px] bg-surface p-3.5" aria-labelledby="next-h">
              <span className="flex h-[58px] w-[52px] shrink-0 flex-col items-center justify-center rounded-2xl bg-primary text-white">
                <span className="text-[11px] text-on-dark-2">{nextWhen}</span>
                <span className="tech text-[15px] font-bold" dir="ltr">{nextSlot.start}</span>
              </span>
              <span className="flex min-w-0 grow flex-col gap-[3px]">
                <span id="next-h" className="text-xs text-muted">{t("home.nextSession")} · {t(`kind.${next.kind}`)}{next.room ? ` · ${next.room}` : ""}{next.cohort_id !== cohortId ? " · L1" : ""}</span>
                <span className="truncate text-start text-[15px] font-semibold" dir="auto">{nextSubject.name}</span>
              </span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6E6A85" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0 ltr:-scale-x-100"><path d="M15 6l-6 6 6 6" /></svg>
            </Link>
          ) : (
            <p className="rounded-[22px] bg-surface p-3.5 text-sm text-muted">{t("home.noSession")}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Tilt className="rounded-[22px] bg-primary p-4 text-white">
              <div className="flex flex-col items-center gap-1">
                <span className="self-stretch text-xs text-on-dark-2" style={{ transform: "translateZ(25px)" }}>{t("home.streak")}</span>
                <span className="hflk clay" style={{ transform: "translateZ(40px)" }}><ClayFlame /></span>
                <span className="tech text-[34px] font-bold leading-none" style={{ transform: "translateZ(35px)" }}>{streak}</span>
                <span className="text-xs text-on-dark-2">{t("home.streakDays")}</span>
              </div>
            </Tilt>
            <Tilt className="rounded-[22px] bg-surface p-4">
              <div className="flex flex-col items-center gap-1.5">
                <span className="self-stretch text-xs text-muted" style={{ transform: "translateZ(25px)" }}>{t("home.mastery")}</span>
                <div className="relative size-24" style={{ transform: "translateZ(35px)" }}>
                  <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={t("home.masteryAria").replace("{n}", String(mastery))} className="rtl:-scale-x-100">
                    <circle cx="48" cy="48" r="40" fill="none" stroke="#EFE9FF" strokeWidth="11" />
                    {mastery > 0 && <circle cx="48" cy="48" r="40" fill="none" stroke="#6D3BF5" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${((C * mastery) / 100).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 48 48)" />}
                  </svg>
                  <span className="tech absolute inset-0 flex items-center justify-center text-xl font-bold" dir="ltr">{mastery}%</span>
                </div>
                <span className="text-[11px] text-muted">{t("home.subjectsCount").replace("{n}", String(subjects.length))}</span>
              </div>
            </Tilt>
          </div>

          {features?.review && (
            <Link href={dueCount > 0 ? "/practice" : "/practice/mistakes"} className="press flex items-center gap-3 rounded-[22px] bg-surface p-3.5">
              <span className="tech flex size-[42px] items-center justify-center rounded-[14px] bg-urgent-bg font-bold text-urgent">{dueCount}</span>
              <span className="flex grow flex-col">
                <span className="text-sm font-semibold">{t(dueCount > 0 ? "home.reviewsDue" : "home.reviewsNone")}</span>
                {dueCount > 0 && <span className="text-xs text-muted">{t("home.reviewMinutes").replace("{n}", String(Math.max(1, dueCount * 2)))}</span>}
              </span>
              <span className="text-[13px] font-semibold text-accent">{t("home.start")}</span>
            </Link>
          )}

          {features?.duel && myTurn.length > 0 && (
            <Link href="/practice/duel" className="press flex items-center gap-3 rounded-[22px] bg-surface p-3.5">
              <span className="tech flex size-[42px] items-center justify-center rounded-[14px] bg-urgent-bg font-bold text-urgent">{myTurn.length}</span>
              <span className="flex grow flex-col">
                <span className="text-sm font-semibold">{t("home.duelsPending")}</span>
                {soonest && <span className="tech text-xs text-muted" dir="ltr">{hoursLeft(soonest.expires_at)}h</span>}
              </span>
              <span className="text-[13px] font-semibold text-accent">{t("home.start")}</span>
            </Link>
          )}

          {ringSubjects.length > 0 && (
            <section className="space-y-4 rounded-[22px] bg-surface p-4" aria-labelledby="progress-h">
              <h2 id="progress-h" className="text-[13px] font-medium text-muted">{t("home.progress")}</h2>
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
            </section>
          )}

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
      </div>
    </div>
  );
}
