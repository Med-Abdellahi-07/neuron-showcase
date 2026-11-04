"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, CloudOff, MessageCircle, Sparkles, Trash2, Trophy, Wifi } from "lucide-react";
import { I18nProvider, useT } from "@/lib/i18n/client";
import { INTL_TAG, LOCALES, LOCALE_COOKIE, isRtl, type Locale } from "@/lib/i18n/dictionaries";
import { addScore, getSnapshot, listOutbox, listPacks, listScores, removePack, storageEstimate } from "@/lib/offline/db";
import { flushOutbox } from "@/lib/offline/sync";
import type { OfflinePack, OfflineScore, OfflineSnapshot } from "@/lib/offline/types";
import { SLOTS } from "@/lib/constants";
import { addDays, formatWeekRange, weekNumber } from "@/lib/weeks";
import { ScheduleGrid } from "@/components/schedule-grid";
import { PackView, mb, packSize } from "@/components/offline-library";
import { hueOf } from "@/lib/schedule-grid";
import { dismissSplash } from "@/components/splash";

/**
 * الاتصال الفعلي: navigator.onLine وحده يكذب (واي فاي بلا إنترنت، أو الخادم غير متاح)،
 * فنؤكده بطلب صغير للخادم (يمر عبر الشبكة دائمًا) عند الفتح وعند أحداث الشبكة وكل 15 ثانية.
 */
function useReallyOnline(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    const probe = async () => {
      if (!navigator.onLine) { if (live) setOk(false); return; }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4000);
      try {
        const r = await fetch(`/sw-build.js?p=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: ctl.signal });
        if (live) setOk(r.ok);
      } catch {
        if (live) setOk(false);
      } finally {
        clearTimeout(timer);
      }
    };
    probe();
    const id = setInterval(probe, 15000);
    window.addEventListener("online", probe);
    window.addEventListener("offline", probe);
    return () => { live = false; clearInterval(id); window.removeEventListener("online", probe); window.removeEventListener("offline", probe); };
  }, []);
  return ok;
}

function cookieLocale(): Locale | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`));
  const v = m?.[1] as Locale | undefined;
  return v && LOCALES.includes(v) ? v : null;
}

/** اليوم والساعة في منطقة التطبيق (من لقطة الجدول) بدون الخادم */
function localNow(tz: string) {
  const d = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { today, hm };
}

interface Data {
  snap: OfflineSnapshot | null;
  packs: OfflinePack[];
  scores: OfflineScore[];
  pending: number;
  est: { used: number; quota: number } | null;
}

/** الصفحة المحلية: لا تطلب شيئًا من الخادم؛ كل ما فيها من IndexedDB. تعمل كتطبيق صغير بحالة داخلية (بدون تنقّل خادم). */
export function OfflineApp() {
  const [data, setData] = useState<Data | null>(null);
  const [locale, setLocale] = useState<Locale>("ar");

  const load = useCallback(async () => {
    let snap: OfflineSnapshot | null = null;
    let packs: OfflinePack[] = [];
    let scores: OfflineScore[] = [];
    let pending = 0;
    try {
      [snap, packs, scores, pending] = await Promise.all([
        getSnapshot().then((x) => x ?? null),
        listPacks(),
        listScores(),
        listOutbox().then((x) => x.length),
      ]);
    } catch { /* لا قاعدة بعد */ }
    const est = await storageEstimate();
    setLocale(cookieLocale() ?? snap?.locale ?? "ar");
    setData({ snap, packs: packs.sort((a, b) => b.savedAt - a.savedAt), scores, pending, est });
  }, []);

  useEffect(() => {
    // قراءة IndexedDB (نظام خارجي) ثم ضبط الحالة
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => { dismissSplash(); }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
  }, [locale]);

  return (
    <I18nProvider locale={locale}>
      <span data-offline-app hidden />
      {data ? <Inner data={data} reload={load} /> : <div className="min-h-dvh" aria-busy="true" />}
    </I18nProvider>
  );
}

type View = "home" | "schedule" | "lessons" | { pack: string };

function Inner({ data, reload }: { data: Data; reload: () => Promise<void> }) {
  const { t, locale } = useT();
  const { snap, packs, scores, pending, est } = data;
  const online = useReallyOnline();
  const [view, setView] = useState<View>("home");
  useEffect(() => {
    // عودة الاتصال: أرسل النتائج المعلّقة
    if (online) flushOutbox().then((n) => { if (n) reload(); }).catch(() => {});
  }, [online, reload]);

  const tag = INTL_TAG[locale];
  const updated = snap ? new Date(snap.savedAt).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" }) : null;

  const header = (
    <header className="relative z-10 rounded-b-[var(--r-head)] bg-deep px-5 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] text-white md:px-8">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-deep-2" aria-hidden><CloudOff size={20} /></span>
        <div className="min-w-0">
          <p className="text-base font-semibold leading-snug">{online ? t("off.connBack") : t("off.youOffline")}{updated && !online ? <> · {t("off.lastUpdate")}: <span className="tech">{updated}</span></> : null}</p>
          {snap && <p className="truncate text-xs text-white/70" dir="auto">{t("off.hello")} {snap.name}{snap.space ? <> · <span dir="ltr">{snap.space}</span></> : null}</p>}
        </div>
      </div>
    </header>
  );

  const pack = typeof view === "object" ? packs.find((p) => p.id === view.pack) : null;

  return (
    <div className="min-h-dvh pb-8">
      {header}
      <main className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-8">
        {online && (
          <div role="status" className="card flex flex-wrap items-center justify-between gap-3 !border-success bg-success/10">
            <span className="flex items-center gap-2 text-sm font-semibold"><Wifi size={16} aria-hidden /> {t("off.connBack")}</span>
            {/* رابط عادي (تحميل كامل) كي يمر عبر الشبكة بلا مهلة */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/?online=1" className="btn btn-primary btn-sm">{t("off.goOnline")}</a>
          </div>
        )}

        {pack ? (
          <PackView
            pack={pack}
            scores={scores.filter((s) => s.lessonId === pack.id)}
            onBack={() => setView("lessons")}
            onScore={async (s) => { await addScore(s); await reload(); }}
          />
        ) : view === "schedule" && snap ? (
          <OfflineSchedule snap={snap} onBack={() => setView("home")} />
        ) : view === "lessons" ? (
          <Lessons packs={packs} est={est} onOpen={(id) => setView({ pack: id })} onBack={() => setView("home")} onRemove={async (id) => { await removePack(id); await reload(); }} />
        ) : (
          <Home snap={snap} packs={packs} pending={pending} onSchedule={() => setView("schedule")} onLessons={() => setView("lessons")} onOpen={(id) => setView({ pack: id })} />
        )}
      </main>
    </div>
  );
}

function Home({ snap, packs, pending, onSchedule, onLessons, onOpen }: { snap: OfflineSnapshot | null; packs: OfflinePack[]; pending: number; onSchedule: () => void; onLessons: () => void; onOpen: (id: string) => void }) {
  const { t } = useT();
  const now = snap ? localNow(snap.tz) : null;
  const today = snap && now ? snap.sessions.filter((s) => s.date === now.today).sort((a, b) => a.slot - b.slot) : [];
  const disabled = [
    { icon: Sparkles, label: t("off.aiTile") },
    { icon: MessageCircle, label: t("off.chatTile") },
    { icon: Trophy, label: t("off.rankTile") },
  ];
  return (
    <>
      {!snap && <p className="card text-sm text-warn">{t("off.noSnapshot")}</p>}

      {snap && (
        <section className="space-y-2" aria-labelledby="off-today">
          <h2 id="off-today" className="tech text-sm font-semibold text-muted">{t("off.todaySessions")}</h2>
          {today.length === 0 ? (
            <p className="card text-sm text-muted">{t("off.noToday")}</p>
          ) : (
            <ul className="space-y-2">
              {today.map((s) => {
                const slot = SLOTS.find((x) => x.n === s.slot);
                return (
                  <li key={s.id} className="card flex items-center gap-3 !p-3" style={{ borderInlineStartWidth: 4, borderInlineStartColor: `hsl(${hueOf(s.color)} 70% 55%)` }}>
                    <span className="tech w-24 shrink-0 text-xs text-muted" dir="ltr">{slot ? `${slot.start}–${slot.end}` : `P${s.slot}`}</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-semibold ${s.status === "cancelled" ? "line-through opacity-60" : ""}`} dir="auto">{s.subjectName}{s.l1 ? " · L1" : ""}</span>
                      <span className="block truncate text-xs text-muted" dir="auto">{t(`kind.${s.kind}`)}{s.room ? ` · ${s.room}` : ""}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" onClick={onSchedule} className="btn btn-primary w-full"><CalendarDays size={16} aria-hidden /> {t("off.fullSchedule")}</button>
        </section>
      )}

      <section className="space-y-2" aria-labelledby="off-lessons">
        <h2 id="off-lessons" className="tech text-sm font-semibold text-muted">{t("off.myLessons")}</h2>
        {packs.length === 0 ? (
          <p className="card text-sm text-muted">{t("off.noLessons")}</p>
        ) : (
          <>
            <ul className="space-y-2">
              {packs.slice(0, 3).map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpen(p.id)} className="card w-full !p-3 text-start">
                    <span className="block truncate text-sm font-semibold" dir="auto">{p.kind.toUpperCase()} {p.number} — {p.title}</span>
                    <span className="block truncate text-xs text-muted" dir="auto">{p.subject}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={onLessons} className="btn w-full"><BookOpen size={16} aria-hidden /> {t("off.myLessons")} ({packs.length})</button>
          </>
        )}
      </section>

      {snap && snap.remaining.length > 0 && (
        <section className="space-y-2" aria-labelledby="off-rem">
          <h2 id="off-rem" className="tech text-sm font-semibold text-muted">{t("off.remaining")}</h2>
          <ul className="flex flex-wrap gap-2">
            {snap.remaining.map((r) => <li key={r.id} className="badge" dir="auto">{r.name}</li>)}
          </ul>
        </section>
      )}

      <section className="space-y-2" aria-label={t("off.needsNet")}>
        <ul className="grid grid-cols-3 gap-2">
          {disabled.map((d) => (
            <li key={d.label}>
              <button type="button" disabled className="card flex w-full flex-col items-center gap-1 !p-3 text-center opacity-50">
                <d.icon size={20} aria-hidden />
                <span className="text-xs font-medium">{d.label}</span>
                <span className="text-[10px] text-muted">{t("off.needsNet")}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{t("off.disabledNote")}</p>
      </section>

      {pending > 0 && <p className="tech text-xs text-muted">{pending} {t("off.pending")}</p>}
    </>
  );
}

function Lessons({ packs, est, onOpen, onBack, onRemove }: { packs: OfflinePack[]; est: { used: number; quota: number } | null; onOpen: (id: string) => void; onBack: () => void; onRemove: (id: string) => Promise<void> }) {
  const { t } = useT();
  const groups = useMemo(() => {
    const m = new Map<string, OfflinePack[]>();
    for (const p of packs) m.set(p.subject || "—", [...(m.get(p.subject || "—") ?? []), p]);
    return [...m.entries()];
  }, [packs]);
  const total = packs.reduce((a, p) => a + packSize(p), 0);
  return (
    <>
      <button type="button" onClick={onBack} className="text-sm text-accent">← {t("nav.home")}</button>
      <h1 className="page-title !mb-0">{t("off.myLessons")}</h1>
      <p className="tech text-xs text-muted" dir="ltr">{t("off.storageUsed")}: {mb(total)}{est && est.quota > 0 ? ` (${mb(est.used)} / ${mb(est.quota)})` : ""}</p>
      {packs.length === 0 && <p className="card text-sm text-muted">{t("off.noLessons")}</p>}
      {groups.map(([subject, list]) => (
        <section key={subject} className="space-y-2">
          <h2 className="text-sm font-semibold" dir="auto">{subject}</h2>
          <ul className="space-y-2">
            {list.map((p) => (
              <li key={p.id} className="card flex items-center gap-3 !p-3">
                <button type="button" onClick={() => onOpen(p.id)} className="min-w-0 flex-1 text-start">
                  <span className="block truncate text-sm font-semibold" dir="auto">{p.kind.toUpperCase()} {p.number} — {p.title}</span>
                  <span className="block truncate text-xs text-muted">{p.pdfs.length} PDF · {p.questions.length} QCM · {p.summaries.length} {t("off.summaries")} · {mb(packSize(p))}</span>
                </button>
                <button type="button" className="btn btn-sm !px-2" aria-label={t("off.remove")} onClick={() => onRemove(p.id)}><Trash2 size={14} aria-hidden /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function OfflineSchedule({ snap, onBack }: { snap: OfflineSnapshot; onBack: () => void }) {
  const { t, locale } = useT();
  const [monday, setMonday] = useState(snap.defaultMonday);
  const [now] = useState(() => localNow(snap.tz));
  const first = snap.defaultMonday, last = addDays(first, 7);
  const n = weekNumber(monday, snap.semesterStart);
  const week = snap.sessions.filter((s) => s.date >= monday && s.date <= addDays(monday, 6));
  const arrow = "size-3.5 rtl:rotate-180";
  const nav = (
    <div className="flex items-center gap-1">
      <button type="button" disabled={monday <= first} onClick={() => setMonday(addDays(monday, -7))} aria-label={t("schedule.prev")} className="flex size-6 items-center justify-center rounded-full text-muted disabled:opacity-30"><ChevronLeft className={arrow} aria-hidden /></button>
      <span className="text-xs text-muted" aria-live="polite">
        {n !== null && <>{t("schedule.week")} <span className="tech">{n}</span> · </>}
        <span className="tech">{formatWeekRange(monday, locale)}</span>
      </span>
      <button type="button" disabled={monday >= last} onClick={() => setMonday(addDays(monday, 7))} aria-label={t("schedule.next")} className="flex size-6 items-center justify-center rounded-full text-muted disabled:opacity-30"><ChevronRight className={arrow} aria-hidden /></button>
    </div>
  );
  return (
    <>
      <ScheduleGrid
        key={monday}
        mode="student"
        monday={monday}
        today={now.today}
        nowHM={now.hm}
        tz={snap.tz}
        sessions={week}
        initialView="day"
        weekNav={nav}
        offline={{ onBack, backLabel: t("nav.back") }}
      />
      <p className="text-xs text-muted">{t("off.savedWeeks")}</p>
    </>
  );
}
