/**
 * Home and "Progress" statistics: pure functions tested directly with node --test.
 * All numbers come from existing tables (attempt_answers / lesson_progress), with no new columns.
 */
import { addDays } from "./weeks.ts";

/** Consecutive active days ending today or yesterday (an unfinished day does not break the streak). Dates are YYYY-MM-DD. */
export function computeStreak(activeDays: Iterable<string>, today: string): number {
  const set = new Set(activeDays);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cursor)) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** Whole-number percentage; 0 if there is no denominator. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export interface AnswerRow {
  day: string; // YYYY-MM-DD
  correct: boolean;
}

/** First day of the month YM = YYYY-MM. */
export const monthStart = (ym: string) => `${ym}-01`;

/** Last day of the month YM. */
export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The month before YM. */
export function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/** The last n months ending at ym, newest first. */
export function lastMonths(ym: string, n: number): string[] {
  const out = [ym];
  while (out.length < n) out.push(prevMonth(out[out.length - 1]));
  return out;
}

export interface SeriesPoint {
  day: string;
  pct: number | null; // Cumulative share of correct answers up to this day (null = no answers yet).
}

/**
 * Cumulative samples of the correct-answer rate over the month: `points` points spread evenly from the first day to the last.
 * The value at each point = correct / all answers from the start of the month up to that day.
 */
export function buildSeries(rows: AnswerRow[], ym: string, points = 9): SeriesPoint[] {
  const start = monthStart(ym);
  const end = monthEnd(ym);
  const span = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
  const inMonth = rows.filter((r) => r.day >= start && r.day <= end);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < points; i++) {
    const day = addDays(start, Math.round((span * i) / (points - 1)));
    let total = 0;
    let ok = 0;
    for (const r of inMonth) {
      if (r.day <= day) {
        total += 1;
        if (r.correct) ok += 1;
      }
    }
    out.push({ day, pct: total ? Math.round((ok / total) * 100) : null });
  }
  return out;
}

/** Chart coordinates as in VProgress: x from 30 to 330, y = 150 - pct*1.4. */
export function chartCoords(series: SeriesPoint[]): { x: number; y: number; pct: number }[] {
  const pts = series.filter((p): p is { day: string; pct: number } => p.pct !== null);
  const all = series.length - 1 || 1;
  return pts.map((p) => {
    const i = series.findIndex((s) => s.day === p.day);
    return { x: +(30 + (300 * i) / all).toFixed(1), y: +(150 - p.pct * 1.4).toFixed(1), pct: p.pct };
  });
}

/** A time like "6h 05m" from milliseconds (text formatting is left to the UI via the parts). */
export function hm(ms: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(ms / 60_000));
  return { h: Math.floor(total / 60), m: total % 60 };
}

/** Streak numbers that deserve a celebration. */
export const STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365] as const;

/** The streak number if it is a milestone worth celebrating, otherwise null. */
export function streakMilestone(streak: number): number | null {
  return (STREAK_MILESTONES as readonly number[]).includes(streak) ? streak : null;
}

/** Number of distinct active days within the week starting at monday (7 days). */
export function activeDaysInWeek(activeDays: Iterable<string>, monday: string): number {
  const end = addDays(monday, 6);
  return new Set([...activeDays].filter((d) => d >= monday && d <= end)).size;
}

/** Weekly goal: studying on at least 5 different days. */
export const WEEK_GOAL_DAYS = 5;
export const weekGoalPct = (days: number) => Math.min(100, Math.round((days / WEEK_GOAL_DAYS) * 100));
