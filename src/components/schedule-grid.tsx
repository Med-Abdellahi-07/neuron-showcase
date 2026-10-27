"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { BackButton } from "@/components/back-button";
import { ScheduleDay } from "@/components/schedule-day";
import { useT } from "@/lib/i18n/client";
import { SLOTS, STUDY_DAYS } from "@/lib/constants";
import { addDays, formatDate } from "@/lib/dates";
import { hueOf, saveView, slotAt, type GridSession, type ScheduleView } from "@/lib/schedule-grid";
import { addSession, deleteSession, setSessionStatus } from "@/app/actions/schedule";
import { ActionForm } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm-button";
import type { DictKey } from "@/lib/i18n/dictionaries";

export interface AdminProps {
  cohortId: string;
  subjects: { id: string; code: string; name: string }[];
}

interface Props {
  /** طالب: قراءة فقط. مشرف: الضغط على خانة يفتح الإدارة والإضافة */
  mode: "student" | "admin";
  monday: string;
  /** وقت الخادم الابتدائي (يتجدد في المتصفح كل نصف دقيقة) */
  today: string;
  nowHM: string;
  tz: string;
  sessions: GridSession[];
  initialView?: ScheduleView;
  admin?: AdminProps;
  /** الطالب: تنقّل الأسابيع (يظهر تحت العنوان في الرأس) */
  weekNav?: React.ReactNode;
  /** النسخة المحلية بلا إنترنت: بلا روابط لصفحات الخادم، والرجوع يُدار من الأب */
  offline?: { onBack: () => void; backLabel: string };
}

interface Sel {
  date: string;
  slot: number;
  /** الطالب يرى الحصة المضغوطة فقط؛ المشرف يرى كل حصص الخانة */
  sessionId?: string;
}

const dayKey = (n: number) => `day.${n}` as DictKey;
const cellKey = (date: string, slot: number) => `${date}|${slot}`;
/** يوم الأسبوع 1..6 (الإثنين..السبت) لتاريخ ISO؛ الأحد لا دراسة فيه فيُعامل كالسبت */
const weekday = (iso: string) => Math.min(6, new Date(`${iso}T00:00:00Z`).getUTCDay() || 7);

/** التاريخ والوقت الحاليان بتوقيت التطبيق (لا نعتمد على توقيت جهاز الطالب) */
function clock(tz: string) {
  const d = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { today, hm };
}

function useNow(tz: string, initial: { today: string; hm: string }) {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    let safe = true;
    const tick = () => {
      try {
        if (safe) setNow(clock(tz));
      } catch {
        /* منطقة زمنية غير صالحة: نبقي وقت الخادم */
      }
    };
    const id = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      safe = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [tz]);
  return now;
}

/** كتلة حصة داخل خانة أو قائمة اليوم */
function SessionBlock({
  s,
  now,
  onOpen,
  large = false,
}: {
  s: GridSession;
  now: boolean;
  onOpen: () => void;
  large?: boolean;
}) {
  const { t } = useT();
  const cancelled = s.status === "cancelled";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-status={s.status}
      data-now={now}
      style={{ ["--h" as string]: hueOf(s.color) }}
      className={`sg-block block w-full rounded-lg p-2 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${large ? "text-sm" : "text-xs"}`}
    >
      <span className="flex items-start justify-between gap-1">
        <span className={`block font-semibold leading-snug ${cancelled ? "text-danger line-through" : ""}`} dir="auto">
          {s.subjectName}
        </span>
        {now && (
          <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[10px] font-semibold text-accent" aria-label={t("schedule.now")}>
            <span className="sg-dot size-1.5 rounded-full bg-accent" aria-hidden />
            {t("schedule.now")}
          </span>
        )}
      </span>
      <span className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${large ? "text-xs" : "text-[11px]"} ${cancelled ? "text-danger" : "text-muted"}`}>
        <span className="tech font-semibold text-fg">{t(`kind.${s.kind}`)}</span>
        {s.room && <span dir="auto">{t("schedule.room")} {s.room}</span>}
      </span>
      {s.teacher && (
        <span className={`block ${large ? "text-xs" : "text-[11px]"} text-muted`} dir="auto">
          {s.teacher}
        </span>
      )}
      {s.sharedWith && (
        <span className="block text-[10px] italic text-muted" dir="auto">
          {t("schedule.sharedWith")} {s.sharedWith}
        </span>
      )}
      {(s.l1 || s.groupLabel || cancelled || s.status === "changed") && (
        <span className="mt-1 flex flex-wrap gap-1">
          {s.l1 && <span className="badge badge-accent !px-1.5 !py-0 text-[10px]" dir="ltr">L1</span>}
          {s.groupLabel && <span className="badge !px-1.5 !py-0 text-[10px]" dir="auto">{s.groupLabel}</span>}
          {cancelled && <span className="badge !px-1.5 !py-0 text-[10px] !text-danger">{t("schedule.cancelled")}</span>}
          {s.status === "changed" && <span className="badge !px-1.5 !py-0 text-[10px] !border-warn !text-warn">{t("schedule.changed")}</span>}
        </span>
      )}
    </button>
  );
}

/** تفاصيل حصة واحدة داخل النافذة */
function SessionDetails({ s, mode, offline }: { s: GridSession; mode: "student" | "admin"; offline?: boolean }) {
  const { t, locale } = useT();
  const slot = SLOTS.find((x) => x.n === s.slot);
  const cancelled = s.status === "cancelled";
  const row = (label: string, value: string | null) =>
    value ? (
      <div className="flex justify-between gap-3 text-sm">
        <dt className="shrink-0 text-muted">{label}</dt>
        <dd className="min-w-0 text-end" dir="auto">{value}</dd>
      </div>
    ) : null;
  return (
    <div className="sg-block space-y-3 rounded-lg p-3" data-status={s.status} style={{ ["--h" as string]: hueOf(s.color) }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={`font-semibold leading-snug ${cancelled ? "text-danger line-through" : ""}`} dir="auto">{s.subjectName}</p>
        <div className="flex flex-wrap gap-1">
          <span className="badge badge-accent tech">{t(`kind.${s.kind}`)}</span>
          {s.l1 && <span className="badge badge-accent" dir="ltr">L1</span>}
          {cancelled && <span className="badge !text-danger">{t("schedule.cancelled")}</span>}
          {s.status === "changed" && <span className="badge !border-warn !text-warn">{t("schedule.changed")}</span>}
        </div>
      </div>
      <dl className="space-y-1">
        {row(t("common.date"), `${t(dayKey(weekday(s.date)))} ${formatDate(s.date, locale)}`)}
        {row(t("schedule.period"), slot ? `P${slot.n} · ${slot.start}–${slot.end}` : null)}
        {row(t("schedule.room"), s.room)}
        {row(t("schedule.teacher"), s.teacher)}
        {row(t("schedule.sharedWith"), s.sharedWith)}
        {row(t("schedule.group"), s.groupLabel)}
        {row(t("common.status"), t(s.status === "scheduled" ? "schedule.statusScheduled" : s.status === "cancelled" ? "schedule.cancelled" : "schedule.changed"))}
      </dl>
      {s.note && (
        <p className="rounded-md bg-surface/60 p-2 text-sm text-warn" dir="auto">
          <span className="font-medium">{t("schedule.note")}: </span>
          {s.note}
        </p>
      )}
      {mode === "student" && !offline && s.subjectCode && (
        <Link href={`/subjects/${s.subjectCode}`} className="btn btn-sm btn-primary w-full">
          {t("schedule.subjectPage")}
        </Link>
      )}
      {mode === "admin" && (
        <div className="space-y-2 border-t border-border pt-3">
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
      )}
    </div>
  );
}

/** نموذج إضافة حصة في خانة محددة (للمشرف) */
function AddForm({ admin, date, slot }: { admin: AdminProps; date: string; slot: number }) {
  const { t } = useT();
  const id = `${date}-${slot}`;
  return (
    <ActionForm action={addSession} submitLabel={t("common.add")} resetOnSuccess className="space-y-3">
      <input type="hidden" name="cohort_id" value={admin.cohortId} />
      <input type="hidden" name="session_date" value={date} />
      <input type="hidden" name="slot" value={slot} />
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label" htmlFor={`sub-${id}`}>{t("common.subject")}</label>
          <select id={`sub-${id}`} name="subject_id" className="input" dir="auto" required defaultValue="">
            <option value="" disabled></option>
            {admin.subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`kind-${id}`}>{t("common.type")}</label>
          <select id={`kind-${id}`} name="kind" className="input" required>
            <option value="cm">{t("kind.cm")}</option>
            <option value="td">{t("kind.td")}</option>
            <option value="tp">{t("kind.tp")}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`room-${id}`}>{t("sa.room")}</label>
          <input id={`room-${id}`} name="room" className="input" dir="auto" maxLength={40} />
        </div>
        <div>
          <label className="label" htmlFor={`teacher-${id}`}>{t("sa.teacher")} ({t("common.optional")})</label>
          <input id={`teacher-${id}`} name="teacher" className="input" dir="auto" maxLength={80} />
        </div>
        <div>
          <label className="label" htmlFor={`shared-${id}`}>{t("sa.shared")} ({t("common.optional")})</label>
          <input id={`shared-${id}`} name="shared_with" className="input" dir="auto" maxLength={80} />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor={`group-${id}`}>{t("sa.group")} ({t("common.optional")})</label>
          <input id={`group-${id}`} name="group_label" className="input" dir="ltr" maxLength={40} />
        </div>
      </div>
    </ActionForm>
  );
}

export function ScheduleGrid({ mode, monday, today, nowHM, tz, sessions, initialView = "day", admin, weekNav, offline }: Props) {
  const { t, locale } = useT();
  const now = useNow(tz, { today, hm: nowHM });
  const [view, setView] = useState<ScheduleView>(mode === "admin" ? "grid" : initialView);
  const days = useMemo(() => STUDY_DAYS.map((n) => ({ n, date: addDays(monday, n - 1) })), [monday]);
  const [day, setDay] = useState<number>(() => days.find((d) => d.date === today)?.n ?? 1);
  const [sel, setSel] = useState<Sel | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const byCell = useMemo(() => {
    const m = new Map<string, GridSession[]>();
    for (const s of sessions) {
      const k = cellKey(s.date, s.slot);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return m;
  }, [sessions]);

  const curSlot = slotAt(now.hm);
  const isNow = (s: GridSession) => s.date === now.today && s.slot === curSlot && s.status !== "cancelled";

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (sel && !el.open) el.showModal();
    if (!sel && el.open) el.close();
  }, [sel]);

  function changeView(v: ScheduleView) {
    setView(v);
    saveView(v);
  }

  const open = (date: string, slot: number, sessionId?: string) => setSel({ date, slot, sessionId });
  const selSessions = sel ? (byCell.get(cellKey(sel.date, sel.slot)) ?? []).filter((s) => !sel.sessionId || s.id === sel.sessionId) : [];
  const selSlot = sel ? SLOTS.find((x) => x.n === sel.slot) : undefined;
  const selWeekday = sel ? weekday(sel.date) : 1;

  return (
    <div className="space-y-3">
      {mode === "student" && (
        <header className="flex items-center justify-between">
          {offline ? (
            <button type="button" onClick={offline.onBack} aria-label={offline.backLabel} className="press flex size-[42px] items-center justify-center rounded-[14px] bg-surface text-fg">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ltr:-scale-x-100"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          ) : (
            <BackButton />
          )}
          <div className="flex flex-col items-center">
            <h1 className="m-0 text-lg font-semibold">{t("schedule.title")}</h1>
            {weekNav}
          </div>
          <button
            type="button"
            onClick={() => changeView(view === "grid" ? "day" : "grid")}
            aria-label={t(view === "grid" ? "schedule.toDay" : "schedule.toGrid")}
            aria-pressed={view === "grid"}
            className="press flex size-[42px] items-center justify-center rounded-[14px] border-0 bg-surface text-fg"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
              <rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" />
            </svg>
          </button>
        </header>
      )}
      {mode === "student" && view === "grid" && <p className="text-[11px] leading-tight text-muted sm:hidden">{t("schedule.gridHint")}</p>}
      {mode === "admin" && <p className="text-xs text-muted">{t("sa.gridHint")}</p>}

      {view === "grid" ? (
        <div
          className="overflow-x-auto rounded-[var(--radius)] border border-border bg-surface"
          role="region"
          aria-label={t("schedule.title")}
          tabIndex={0}
        >
          <table className="sg-table w-full min-w-[54rem] table-fixed border-separate border-spacing-0 text-start">
            <caption className="sr-only">{t("schedule.title")}</caption>
            <colgroup>
              <col className="w-[4.75rem]" />
              {days.map((d) => (
                <col key={d.n} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="sticky start-0 z-20 bg-primary px-2 py-2.5 text-center text-xs font-semibold text-primary-fg">
                  {t("schedule.period")}
                </th>
                {days.map((d) => (
                  <th
                    key={d.n}
                    scope="col"
                    aria-current={d.date === now.today ? "date" : undefined}
                    className={`px-2 py-2.5 text-center text-xs font-semibold ${d.date === now.today ? "bg-primary text-primary-fg ring-2 ring-inset ring-primary-fg/40" : "bg-primary/85 text-primary-fg"}`}
                  >
                    <span className="block">{t(dayKey(d.n))}</span>
                    <span className="tech block text-[10px] font-normal opacity-90" dir="ltr">{formatDate(d.date, locale)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SLOTS.map((sl) => (
                <tr key={sl.n}>
                  <th
                    scope="row"
                    className={`sticky start-0 z-10 bg-surface-2 px-1.5 py-2 text-center align-middle ${curSlot === sl.n ? "text-accent" : ""}`}
                  >
                    <span className="tech block text-sm font-semibold">P{sl.n}</span>
                    <span className="tech block text-[10px] leading-tight text-muted" dir="ltr">
                      {sl.start}
                      <br />
                      {sl.end}
                    </span>
                  </th>
                  {days.map((d) => {
                    const items = byCell.get(cellKey(d.date, sl.n)) ?? [];
                    const today_ = d.date === now.today;
                    return (
                      <td key={d.n} className={`h-[5.5rem] p-1 align-top ${today_ ? "sg-today" : ""}`}>
                        {items.length > 0 ? (
                          <div className="space-y-1">
                            {items.map((s) => (
                              <SessionBlock key={s.id} s={s} now={isNow(s)} onOpen={() => open(d.date, sl.n, mode === "student" ? s.id : undefined)} />
                            ))}
                          </div>
                        ) : mode === "admin" ? (
                          <button
                            type="button"
                            onClick={() => open(d.date, sl.n)}
                            aria-label={`${t("sa.addHere")}: ${t(dayKey(d.n))} P${sl.n}`}
                            className="group flex h-full min-h-[4.5rem] w-full items-center justify-center rounded-lg text-muted transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            <span className="group-hover:hidden group-focus-visible:hidden" aria-hidden>—</span>
                            <span className="hidden text-lg font-semibold group-hover:inline group-focus-visible:inline" aria-hidden>+</span>
                          </button>
                        ) : (
                          <span className="flex h-full min-h-[4.5rem] items-center justify-center text-muted" aria-label={t("schedule.empty")}>
                            —
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-md">
          <ScheduleDay monday={monday} now={now} day={day} setDay={setDay} byCell={byCell} onOpen={(d, sl, id) => open(d, sl, id)} />
        </div>
      )}

      <dialog
        ref={dialogRef}
        onClose={() => setSel(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSel(null);
        }}
        aria-labelledby="sg-title"
        className="m-auto max-h-[88dvh] w-[min(34rem,calc(100vw-1.5rem))] overflow-auto rounded-[var(--radius)] border border-border bg-surface p-0 text-fg shadow-xl backdrop:bg-black/50"
      >
        {sel && (
          <div className="space-y-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="sg-title" className="text-base font-semibold">
                  {mode === "admin" ? `${t(dayKey(selWeekday))} ${formatDate(sel.date, locale)}` : t("schedule.details")}
                </h2>
                <p className="tech text-xs text-muted" dir="ltr">
                  P{sel.slot} · {selSlot?.start}–{selSlot?.end}
                </p>
              </div>
              <button type="button" className="btn btn-sm !px-2" onClick={() => setSel(null)} aria-label={t("schedule.close")}>
                <X size={16} aria-hidden />
              </button>
            </div>

            {selSessions.length > 0 && (
              <div className="space-y-3">
                {mode === "admin" && <h3 className="text-xs font-semibold text-muted">{t("sa.cellSessions")}</h3>}
                {selSessions.map((s) => (
                  <SessionDetails key={s.id} s={s} mode={mode} offline={!!offline} />
                ))}
              </div>
            )}

            {mode === "admin" && admin && (
              <details className="rounded-[var(--radius)] border border-border p-3" open={selSessions.length === 0}>
                <summary className="cursor-pointer text-sm font-semibold">{selSessions.length === 0 ? t("sa.addHere") : t("sa.addAnother")}</summary>
                <div className="mt-3">
                  <AddForm admin={admin} date={sel.date} slot={sel.slot} />
                </div>
              </details>
            )}

            {selSessions.length === 0 && mode === "student" && <p className="text-sm text-muted">{t("schedule.empty")}</p>}
          </div>
        )}
      </dialog>
    </div>
  );
}
