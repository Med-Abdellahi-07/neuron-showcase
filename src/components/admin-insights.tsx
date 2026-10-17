import Link from "next/link";
import { Activity, BookX, Bot, GaugeCircle, Users } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { daysSince } from "@/lib/dates";
import type { DictKey } from "@/lib/i18n/dictionaries";

interface Student {
  id: string;
  full_name: string;
  last_seen_at: string | null;
  answers_7d: number;
  attempts_total: number;
  accuracy: number | null;
  lessons_studied: number;
  duels_played: number;
}
interface SubjectStat { subject_id: string; code: string; name: string; students: number; answers: number; accuracy: number | null }
interface Weak { lesson_id: string; kind: string; number: number; title: string; subject_code: string; students: number; weak_students: number; accuracy: number | null }
interface Daily { day: string; provider: "gemini" | "groq" | "tavily"; calls: number; failures: number }
interface Kind { kind: string; today: number; last_30d: number; users_today: number }

const PROVIDERS = ["gemini", "groq", "tavily"] as const;
const num = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v));

function limitFor(p: (typeof PROVIDERS)[number]): number | null {
  const v = Number(process.env[`AI_LIMIT_${p.toUpperCase()}_DAILY`]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function Bar({ pct, tone = "accent" }: { pct: number; tone?: "accent" | "warn" | "danger" }) {
  const color = tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-accent";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** إحصائيات المدير: نشاط الطلاب، متوسط المواد، الحصص الأضعف، استهلاك الذكاء الاصطناعي. إحصاءات مجمّعة فقط. */
export async function AdminInsights() {
  const { t, locale } = await getT();
  const supabase = await createClient();
  const [stu, subj, weak, daily, kinds] = await Promise.all([
    supabase.rpc("admin_students"),
    supabase.rpc("admin_subject_stats"),
    supabase.rpc("admin_weak_lessons", { p_limit: 10 }),
    supabase.rpc("admin_ai_daily", { p_days: 14 }),
    supabase.rpc("admin_ai_kinds"),
  ]);
  if (stu.error)
    return <p className="card text-sm text-warn">{t("stats.runMigration")}</p>;

  const students = (stu.data ?? []) as Student[];
  const subjects = ((subj.data ?? []) as SubjectStat[]).map((s) => ({ ...s, accuracy: num(s.accuracy) }));
  const weakLessons = (weak.data ?? []) as Weak[];
  const dailyRows = (daily.data ?? []) as Daily[];
  const kindRows = (kinds.data ?? []) as Kind[];

  const ago = (iso: string | null) => (iso ? daysSince(iso) : null);
  const active1 = students.filter((s) => (ago(s.last_seen_at) ?? 99) < 1).length;
  const active7 = students.filter((s) => (ago(s.last_seen_at) ?? 99) < 7).length;
  const absent = students.filter((s) => (ago(s.last_seen_at) ?? 99) >= 3);

  const today = new Date().toISOString().slice(0, 10);
  const todayBy = new Map(dailyRows.filter((d) => d.day === today).map((d) => [d.provider, d]));
  const days = [...new Set(dailyRows.map((d) => d.day))].sort().slice(-14);
  const tavily30 = dailyRows.filter((d) => d.provider === "tavily").reduce((a, d) => a + d.calls, 0);
  const maxCalls = Math.max(1, ...dailyRows.map((d) => d.calls));
  const rel = (iso: string | null) => {
    const d = ago(iso);
    if (d === null) return t("stats.never");
    if (d === 0) return t("stats.today");
    return `${d} ${t("stats.daysAgo")}`;
  };

  return (
    <div className="space-y-8">
      {/* ───── نشاط الطلاب ───── */}
      <section className="space-y-3" aria-labelledby="st-act">
        <h2 id="st-act" className="tech flex items-center gap-2 text-sm font-semibold"><Users size={16} aria-hidden /> {t("stats.activity")}</h2>
        <ul className="grid grid-cols-3 gap-3">
          {[
            [t("stats.active1"), active1],
            [t("stats.active7"), active7],
            [t("stats.absent3"), absent.length],
          ].map(([label, v]) => (
            <li key={String(label)} className="card !p-3 text-center">
              <p className="tech text-2xl font-semibold text-accent" dir="ltr">{v}<span className="text-sm text-muted">/{students.length}</span></p>
              <p className="mt-1 text-[11px] leading-tight text-muted">{label}</p>
            </li>
          ))}
        </ul>
        <ul className="card divide-y divide-border !p-0">
          {students.map((s) => {
            const d = ago(s.last_seen_at);
            const gone = d === null || d >= 3;
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate" dir="auto">{s.full_name}</span>
                  <span className="tech text-[11px] text-muted" dir="ltr">
                    {s.answers_7d} {t("stats.answers7")} · {s.lessons_studied} {t("stats.lessonsStudied")}
                    {s.accuracy !== null ? ` · ${s.accuracy}%` : ""}
                  </span>
                </span>
                <span className={`badge shrink-0 ${gone ? "text-warn" : ""}`}>{rel(s.last_seen_at)}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted">{t("stats.privacyNote")}</p>
      </section>

      {/* ───── متوسط المواد ───── */}
      <section className="space-y-3" aria-labelledby="st-sub">
        <h2 id="st-sub" className="tech flex items-center gap-2 text-sm font-semibold"><Activity size={16} aria-hidden /> {t("stats.subjects")}</h2>
        <ul className="card space-y-3">
          {subjects.map((s) => (
            <li key={s.subject_id} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate" dir="auto"><span className="tech text-xs text-accent" dir="ltr">{s.code}</span> {s.name}</span>
                <span className="tech shrink-0 text-xs" dir="ltr">
                  {s.accuracy === null ? "—" : `${s.accuracy}%`} <span className="text-muted">· {s.answers} · {s.students}👤</span>
                </span>
              </div>
              <Bar pct={s.accuracy ?? 0} tone={s.accuracy !== null && s.accuracy < 50 ? "warn" : "accent"} />
            </li>
          ))}
        </ul>
      </section>

      {/* ───── الحصص الأضعف ───── */}
      <section className="space-y-3" aria-labelledby="st-weak">
        <h2 id="st-weak" className="tech flex items-center gap-2 text-sm font-semibold"><BookX size={16} aria-hidden /> {t("stats.weak")}</h2>
        {weakLessons.length === 0 ? (
          <p className="card text-sm text-muted">{t("stats.weakNone")}</p>
        ) : (
          <ul className="space-y-2">
            {weakLessons.map((w) => (
              <li key={w.lesson_id}>
                <Link href={`/lessons/${w.lesson_id}`} className="card flex items-center justify-between gap-3 !p-3 transition-colors hover:bg-surface-2">
                  <span className="min-w-0 text-sm" dir="auto">
                    <span className="tech text-xs text-accent" dir="ltr">{w.subject_code} {w.kind.toUpperCase()} {w.number}</span>
                    <span className="block truncate">{w.title}</span>
                  </span>
                  <span className="tech shrink-0 text-end text-xs" dir="ltr">
                    <span className="block text-warn">{w.weak_students}/{w.students}</span>
                    <span className="text-muted">{num(w.accuracy)}%</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">{t("stats.weakNote")}</p>
      </section>

      {/* ───── استهلاك الذكاء الاصطناعي ───── */}
      <section className="space-y-3" aria-labelledby="st-ai">
        <h2 id="st-ai" className="tech flex items-center gap-2 text-sm font-semibold"><Bot size={16} aria-hidden /> {t("stats.ai")}</h2>
        <ul className="space-y-3">
          {PROVIDERS.map((p) => {
            const row = todayBy.get(p);
            const calls = row?.calls ?? 0;
            const lim = p === "tavily" ? 900 : limitFor(p);
            const used = p === "tavily" ? tavily30 : calls;
            const pct = lim ? (used / lim) * 100 : 0;
            return (
              <li key={p} className="card space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tech text-sm font-semibold">{p}</span>
                  <span className="tech text-xs text-muted" dir="ltr">
                    {t("stats.todayCalls")}: {calls}
                    {row?.failures ? ` · ✗ ${row.failures}` : ""}
                  </span>
                </div>
                {lim ? (
                  <>
                    <Bar pct={pct} tone={pct >= 90 ? "danger" : pct >= 70 ? "warn" : "accent"} />
                    <p className="tech text-xs text-muted" dir="ltr">
                      {used} / {lim} {p === "tavily" ? t("stats.per30d") : t("stats.perDay")}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted">{t("stats.limitUnset")}</p>
                )}
              </li>
            );
          })}
        </ul>

        {days.length > 0 && (
          <div className="card space-y-2">
            <p className="text-xs font-medium text-muted">{t("stats.last14")}</p>
            <ul className="space-y-1.5">
              {days.map((day) => (
                <li key={day} className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-[11px]">
                  <span className="tech text-muted" dir="ltr">{new Date(day + "T00:00:00Z").toLocaleDateString(locale === "ar" ? "ar" : "fr-FR", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
                  <span className="space-y-0.5">
                    {PROVIDERS.map((p) => {
                      const r = dailyRows.find((d) => d.day === day && d.provider === p);
                      if (!r) return null;
                      return (
                        <span key={p} className="flex items-center gap-2">
                          <span className="tech w-12 shrink-0 text-muted" dir="ltr">{p}</span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                            <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.calls / maxCalls) * 100}%` }} />
                          </span>
                          <span className="tech w-14 shrink-0 text-end" dir="ltr">{r.calls}{r.failures ? ` ✗${r.failures}` : ""}</span>
                        </span>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {kindRows.length > 0 && (
          <div className="card space-y-2">
            <p className="flex items-center gap-2 text-xs font-medium text-muted"><GaugeCircle size={14} aria-hidden /> {t("stats.byFeature")}</p>
            <ul className="divide-y divide-border text-sm">
              {kindRows.map((k) => (
                <li key={k.kind} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{t(`stats.kind.${k.kind}` as DictKey)}</span>
                  <span className="tech text-xs text-muted" dir="ltr">{k.today} {t("stats.today")} · {k.users_today}👤 · {k.last_30d}/30d</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted">{t("stats.aiNote")}</p>
      </section>
    </div>
  );
}
