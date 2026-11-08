import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects } from "@/lib/data";
import { appTimeZone, todayISO } from "@/lib/dates";
import { addDays, dateInZone } from "@/lib/weeks";
import { INTL_TAG } from "@/lib/i18n/dictionaries";
import { buildSeries, chartCoords, lastMonths, monthEnd, monthStart, pct as pctOf, prevMonth } from "@/lib/home-stats";
import { BackButton } from "@/components/back-button";
import { MonthSelect } from "@/components/month-select";
import { ClayBars, ClayCheck, ClayClock } from "@/components/clay";

type Row = { answered_at: string; is_correct: boolean; elapsed_ms: number; subject_id: string | null };

export default async function ProgressPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await requireProfile();
  const { t, locale } = await getT();
  const sp = await searchParams;
  const raw = Array.isArray(sp.m) ? sp.m[0] : sp.m;
  const tz = appTimeZone();
  const nowYm = todayISO().slice(0, 7);
  const ym = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : nowYm;
  const prev = prevMonth(ym);
  const start = monthStart(ym);
  const end = monthEnd(ym);
  const supabase = await createClient();

  // Window widened by a day on each side (time zone offsets), then trimmed by app date.
  const [rowsRes, prevTotalRes, prevOkRes, subjects] = await Promise.all([
    supabase
      .from("attempt_answers")
      .select("answered_at, is_correct, elapsed_ms, subject_id")
      .eq("user_id", profile.id)
      .gte("answered_at", `${addDays(start, -1)}T00:00:00Z`)
      .lte("answered_at", `${addDays(end, 1)}T23:59:59Z`)
      .order("answered_at")
      .limit(5000),
    supabase.from("attempt_answers").select("id", { count: "exact", head: true }).eq("user_id", profile.id).gte("answered_at", `${addDays(monthStart(prev), -1)}T00:00:00Z`).lt("answered_at", `${addDays(start, 0)}T00:00:00Z`),
    supabase.from("attempt_answers").select("id", { count: "exact", head: true }).eq("user_id", profile.id).eq("is_correct", true).gte("answered_at", `${addDays(monthStart(prev), -1)}T00:00:00Z`).lt("answered_at", `${addDays(start, 0)}T00:00:00Z`),
    getCurrentSubjects(),
  ]);

  const dayOf = (v: unknown) => {
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : dateInZone(d, tz);
  };
  const rows = ((rowsRes.data ?? []) as Row[])
    .map((r) => ({ ...r, day: dayOf(r.answered_at) }))
    .filter((r): r is Row & { day: string } => r.day !== null && r.day >= start && r.day <= end);
  const total = rows.length;
  const ok = rows.filter((r) => r.is_correct).length;
  const rate = pctOf(ok, total);
  const prevRate = (prevTotalRes.count ?? 0) > 0 ? pctOf(prevOkRes.count ?? 0, prevTotalRes.count ?? 0) : null;
  const delta = total > 0 && prevRate !== null ? rate - prevRate : null;
  const ms = rows.reduce((a, r) => a + (r.elapsed_ms ?? 0), 0);
  const hours = Math.round((ms / 3_600_000) * 10) / 10;

  const series = buildSeries(rows.map((r) => ({ day: r.day, correct: r.is_correct })), ym, 9);
  const pts = chartCoords(series);
  const idx = [0, 2, 4, 6, 8];
  const tag = INTL_TAG[locale];
  const dayLabel = (iso: string, first: boolean) =>
    first ? new Intl.DateTimeFormat(tag, { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(iso)) : String(Number(iso.slice(8, 10)));
  const monthName = (m: string, long = true) => new Intl.DateTimeFormat(tag, { timeZone: "UTC", month: long ? "long" : "short" }).format(new Date(`${m}-01`));
  const monthOptions = lastMonths(nowYm, 6).map((m) => ({ ym: m, label: monthName(m) }));
  if (!monthOptions.some((o) => o.ym === ym)) monthOptions.push({ ym, label: monthName(ym) });

  // Subjects: share of correct answers per subject this month, most practised first.
  const per = new Map<string, { n: number; ok: number }>();
  for (const r of rows) {
    if (!r.subject_id) continue;
    const e = per.get(r.subject_id) ?? { n: 0, ok: 0 };
    e.n += 1;
    if (r.is_correct) e.ok += 1;
    per.set(r.subject_id, e);
  }
  const subjectRows = subjects
    .filter((s) => per.has(s.id))
    .map((s) => ({ s, ...per.get(s.id)! }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);

  const poly = pts.map((p) => `${p.x} ${p.y}`).join(" L");
  const last = pts[pts.length - 1];
  const first = pts[0];

  return (
    <div className="flex flex-col gap-3.5 px-1">
      <header className="flex items-center justify-between">
        <BackButton />
        <h1 className="m-0 text-lg font-semibold">{t("progress.title")}</h1>
        <MonthSelect value={ym} options={monthOptions} label={t("progress.month")} />
      </header>

      <section className="flex flex-col gap-2.5 rounded-3xl bg-surface px-4 pb-3 pt-[18px]">
        <div className="flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-muted">{t("progress.correctRate")}</span>
            <span className="tech text-[34px] font-bold leading-[1.15]">{rate}%</span>
          </div>
          <ClayBars className="pf clay self-center" />
          {delta !== null && (
            <span
              dir="ltr"
              className={`tech rounded-full px-2.5 py-1 text-xs font-semibold ${delta >= 0 ? "bg-success-bg text-success" : "bg-urgent-bg text-urgent"}`}
            >
              {t("progress.vsPrev").replace("{d}", `${delta >= 0 ? "+" : ""}${delta}`).replace("{m}", monthName(prev, false))}
            </span>
          )}
        </div>
        <figure
          dir="ltr"
          role="img"
          aria-label={
            first && last
              ? t("progress.chartAria").replace("{m}", monthName(ym)).replace("{a}", String(first.pct)).replace("{b}", String(last.pct))
              : t("progress.empty")
          }
          className="m-0"
        >
          <svg width="318" height="176" viewBox="0 0 340 188" className="block h-auto w-full">
            <g stroke="#ECE9F5" strokeWidth="1">
              <line x1="30" y1="10" x2="330" y2="10" /><line x1="30" y1="45" x2="330" y2="45" /><line x1="30" y1="80" x2="330" y2="80" /><line x1="30" y1="115" x2="330" y2="115" />
            </g>
            <line x1="30" y1="150" x2="330" y2="150" stroke="#CFCADF" strokeWidth="1" />
            <g fontFamily="Readex Pro, sans-serif" fontSize="10" fill="#6E6A85" textAnchor="end">
              <text x="24" y="13">100</text><text x="24" y="48">75</text><text x="24" y="83">50</text><text x="24" y="118">25</text><text x="24" y="153">0</text>
            </g>
            {pts.length >= 2 && (
              <>
                <path d={`M${poly} L${last.x} 150 L${first.x} 150 Z`} fill="#6D3BF5" opacity="0.1" />
                <path d={`M${poly}`} fill="none" stroke="#6D3BF5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </>
            )}
            {last && (
              <>
                <line x1={last.x} y1={last.y} x2={last.x} y2="150" stroke="#6D3BF5" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
                <circle cx={last.x} cy={last.y} r="5" fill="#6D3BF5" stroke="#FFFFFF" strokeWidth="2" />
                <rect x={last.x - 40} y="16" width="40" height="22" rx="8" fill="#2A0E6E" />
                <text x={last.x - 20} y="31" fontFamily="Readex Pro, sans-serif" fontSize="11" fontWeight="600" fill="#FFFFFF" textAnchor="middle">{last.pct}%</text>
              </>
            )}
            <g fontFamily="Readex Pro, sans-serif" fontSize="10" fill="#6E6A85" textAnchor="middle">
              {idx.map((i, k) => (
                <text key={i} x={k === 4 ? 322 : 30 + 37.5 * i} y="170">{dayLabel(series[i].day, k === 0)}</text>
              ))}
            </g>
          </svg>
          {total === 0 && <figcaption className="sr-only">{t("progress.empty")}</figcaption>}
        </figure>
        {total === 0 && <p className="pb-1 text-center text-xs text-muted">{t("progress.empty")}</p>}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <section className="relative flex h-[120px] flex-col justify-between overflow-hidden rounded-[22px] bg-deep p-4 text-white">
          <div className="pf2 clay absolute bottom-2.5 left-2" aria-hidden="true"><ClayCheck variant="ring" /></div>
          <span className="flex size-[30px] items-center justify-center rounded-full bg-white text-deep">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
          </span>
          <span className="flex flex-col"><span className="text-xs text-on-dark">{t("progress.solved")}</span><span className="tech text-2xl font-bold">{total}</span></span>
        </section>
        <section className="relative flex h-[120px] flex-col justify-between overflow-hidden rounded-[22px] bg-primary p-4 text-white">
          <div className="pf clay absolute bottom-2.5 left-2" aria-hidden="true"><ClayClock /></div>
          <span className="flex size-[30px] items-center justify-center rounded-full bg-white text-primary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </span>
          <span className="flex flex-col"><span className="text-xs text-on-dark-2">{t("progress.practiceTime")}</span><span className="tech text-2xl font-bold">{t("progress.hoursShort").replace("{n}", String(hours))}</span></span>
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-3xl bg-surface p-4">
        <div className="flex justify-between">
          <h2 className="m-0 text-[15px] font-semibold">{t("progress.subjects")}</h2>
          <Link href="/subjects" className="text-xs text-accent no-underline">{t("progress.all")}</Link>
        </div>
        {subjectRows.length === 0 ? (
          <p className="text-xs text-muted">{t("progress.noSubjects")}</p>
        ) : (
          subjectRows.map(({ s, n, ok: c }) => {
            const p = pctOf(c, n);
            return (
              <div key={s.id} className="flex flex-col gap-[5px]">
                <div className="flex justify-between text-[13px]"><span dir="ltr">{s.name}</span><span className="tech font-semibold" dir="ltr">{p}%</span></div>
                <div className="h-2 rounded bg-track"><div className="h-2 rounded bg-primary" style={{ width: `${p}%` }} /></div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
