"use client";

import { useT } from "@/lib/i18n/client";
import { SLOTS } from "@/lib/constants";
import { addDays } from "@/lib/dates";
import type { GridSession } from "@/lib/schedule-grid";
import type { DictKey } from "@/lib/i18n/dictionaries";
import { ClayAlarm, ClayCalendar } from "@/components/clay";

const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const dayKey = (n: number) => `day.${n}` as DictKey;
const shortKey = (n: number) => `day.short.${n}` as DictKey;

/**
 * Student day view (VSchedule.html): a "left today" card, the six day strips, and the day's session list.
 * The grid view (P1-P6) stays behind the grid button in the header.
 */
export function ScheduleDay({
  monday,
  now,
  day,
  setDay,
  byCell,
  onOpen,
}: {
  monday: string;
  now: { today: string; hm: string };
  day: number;
  setDay: (n: number) => void;
  byCell: Map<string, GridSession[]>;
  onOpen: (date: string, slot: number, id: string) => void;
}) {
  const { t } = useT();
  const days = [1, 2, 3, 4, 5, 6].map((n) => ({ n, date: addDays(monday, n - 1) }));
  const sel = days.find((d) => d.n === day) ?? days[0];
  const itemsOn = (date: string) => SLOTS.flatMap((sl) => (byCell.get(`${date}|${sl.n}`) ?? []).map((s) => ({ sl, s })));
  const list = itemsOn(sel.date);
  const live = list.filter((x) => x.s.status !== "cancelled");
  const hours = Math.round(live.length * 1.5 * 10) / 10;

  const todayInWeek = days.some((d) => d.date === now.today);
  const left = todayInWeek ? itemsOn(now.today).filter((x) => x.s.status !== "cancelled" && x.sl.end > now.hm) : [];
  const weekTotal = days.reduce((a, d) => a + itemsOn(d.date).filter((x) => x.s.status !== "cancelled").length, 0);
  const upcoming = left.find((x) => x.sl.start > now.hm);

  return (
    <div className="flex flex-col gap-4">
      <section className="relative flex h-[108px] flex-col justify-center gap-1 rounded-3xl bg-deep px-[18px] py-4 text-white">
        <svg width="350" height="108" viewBox="0 0 350 108" aria-hidden="true" className="absolute inset-0 size-full rounded-3xl" preserveAspectRatio="xMidYMid slice">
          <circle cx="40" cy="96" r="70" fill="#3A1A8C" />
          <g stroke="#5A3BB8" strokeWidth="1.2" fill="none"><path d="M150 14 L190 34 L176 70" /></g>
          <g fill="#7C5CE6"><circle cx="150" cy="14" r="2.5" /><circle cx="190" cy="34" r="3" /><circle cx="176" cy="70" r="2.5" /></g>
        </svg>
        <span className="relative text-xs text-on-dark">{t(todayInWeek ? "schedule.leftToday" : "schedule.weekSessions")}</span>
        <span className="relative text-[22px] font-bold">
          {todayInWeek
            ? left.length > 0
              ? t("schedule.leftTitle").replace("{n}", String(left.length)).replace("{t}", left[left.length - 1].sl.end)
              : t("schedule.noneLeft")
            : t("schedule.weekCount").replace("{n}", String(weekTotal))}
        </span>
        {upcoming && <span className="relative text-xs text-on-dark">{t("schedule.nextUp").replace("{p}", String(upcoming.sl.n)).replace("{t}", upcoming.sl.start)}</span>}
        <div className="sf clay-lg absolute -top-4 left-4" aria-hidden="true"><ClayCalendar variant="hero" day={String(Number(sel.date.slice(8, 10)))} /></div>
        <div className="sring clay-lg absolute left-[92px] top-[52px]" aria-hidden="true"><ClayAlarm /></div>
      </section>

      <div role="tablist" aria-label={t("schedule.dayPicker")} className="grid grid-cols-6 gap-2">
        {days.map((d) => {
          const selected = d.n === sel.n;
          const has = itemsOn(d.date).length > 0;
          return (
            <button
              key={d.n}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setDay(d.n)}
              className={`flex h-[66px] flex-col items-center justify-center gap-0.5 rounded-[18px] border-0 font-[inherit] ${
                selected ? "bg-primary text-white shadow-[0_8px_18px_rgba(109,59,245,0.35)]" : `bg-surface ${has ? "text-fg" : "text-faint"}`
              }`}
            >
              <span className={`text-[11px] ${selected ? "text-on-dark-2" : has ? "text-muted" : ""}`}>{t(shortKey(d.n))}</span>
              <span className="tech text-[17px] font-semibold" dir="ltr">{Number(d.date.slice(8, 10))}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="m-0 text-base font-semibold">{t("schedule.daySessions").replace("{d}", t(dayKey(sel.n)))}</h2>
        <span className="text-xs text-muted">{t("schedule.dayMeta").replace("{n}", String(live.length)).replace("{h}", String(hours))}</span>
      </div>

      {list.length === 0 ? (
        <p className="rounded-[20px] bg-surface p-4 text-sm text-muted">{t("schedule.dayEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {list.map(({ sl, s }) => {
            const isToday = s.date === now.today;
            const cancelled = s.status === "cancelled";
            const ended = isToday && sl.end <= now.hm;
            const live_ = isToday && !cancelled && sl.start <= now.hm && now.hm < sl.end;
            const frac = live_ ? Math.min(100, Math.max(0, Math.round(((mins(now.hm) - mins(sl.start)) / (mins(sl.end) - mins(sl.start))) * 100))) : 0;
            const meta = [t(`kind.${s.kind}`), s.room ? `${t("schedule.room")} ${s.room}` : null, s.teacher, s.sharedWith ? `${t("schedule.sharedWith")} ${s.sharedWith}` : null, ended ? t("schedule.ended") : null].filter(Boolean).join(" · ");
            return (
              <li key={s.id} className={`flex items-stretch gap-3 ${ended ? "opacity-55" : ""}`}>
                <div className="flex w-[46px] shrink-0 flex-col items-center pt-3.5 text-xs text-muted">
                  <span className={`tech font-semibold ${live_ ? "text-accent" : "text-fg"}`} dir="ltr">{sl.start}</span>
                  <span className="tech">P{sl.n}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onOpen(s.date, s.slot, s.id)}
                  aria-haspopup="dialog"
                  data-status={s.status}
                  className={`flex min-w-0 grow flex-col gap-1 rounded-[20px] bg-surface text-start font-[inherit] text-fg ${live_ ? "gap-1.5 border-2 border-primary p-[13px]" : "border-0 p-3.5"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span dir="auto" className={`min-w-0 text-start text-sm font-semibold ${cancelled ? "text-danger line-through" : ""}`}>{s.subjectName}</span>
                    {live_ && <span className="shrink-0 rounded-full bg-success-bg px-[9px] py-[3px] text-[11px] font-semibold text-success">{t("schedule.now")}</span>}
                    {cancelled && <span className="shrink-0 rounded-full bg-urgent-bg px-[9px] py-[3px] text-[11px] font-semibold text-danger">{t("schedule.cancelled")}</span>}
                    {s.status === "changed" && <span className="shrink-0 rounded-full bg-urgent-bg px-[9px] py-[3px] text-[11px] font-semibold text-urgent">{t("schedule.changed")}</span>}
                  </span>
                  <span className="text-xs text-muted" dir="auto">{s.status === "changed" && s.note ? s.note : meta}</span>
                  {s.status === "changed" && s.note && meta && <span className="text-xs text-muted" dir="auto">{meta}</span>}
                  {live_ && (
                    <span className="block h-[5px] rounded-[3px] bg-track" aria-hidden="true">
                      <span className="block h-[5px] rounded-[3px] bg-primary" style={{ width: `${frac}%` }} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
