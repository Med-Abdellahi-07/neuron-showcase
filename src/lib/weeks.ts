/**
 * Study-week logic: pure functions with no environment dependency (tested directly with node --test).
 * Study days: Monday-Saturday. No classes on Sunday.
 */

const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

/** ISO weekday: Monday = 1 ... Sunday = 7. */
export function isoWeekday(iso: string): number {
  const d = parse(iso).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Start of the week (Monday) for a given date. */
export function mondayOf(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

/** Today's date YYYY-MM-DD in a given time zone (not UTC and not the server's time). */
export function dateInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * The week shown by default: Monday-Saturday -> the current week,
 * Sunday -> next week (no classes on Sunday).
 */
export function defaultWeekMonday(today: string): string {
  return isoWeekday(today) === 7 ? addDays(today, 1) : mondayOf(today);
}

/** First study day from today onward: Sunday -> next Monday, otherwise today. */
export function studyDateFrom(today: string): string {
  return isoWeekday(today) === 7 ? addDays(today, 1) : today;
}

/** Is tomorrow a study day? (Saturday evening: no, because tomorrow is Sunday.) */
export function isStudyDay(iso: string): boolean {
  return isoWeekday(iso) <= 6;
}

/**
 * Study week number (1 = the week containing the semester start date, counted from Monday).
 * Returns null before the semester starts or if no start date is set.
 */
export function weekNumber(monday: string, semesterStart: string | null | undefined): number | null {
  if (!semesterStart || !/^\d{4}-\d{2}-\d{2}$/.test(semesterStart)) return null;
  const startMonday = mondayOf(semesterStart);
  const diff = Math.round((parse(mondayOf(monday)).getTime() - parse(startMonday).getTime()) / 86_400_000);
  return diff < 0 ? null : Math.floor(diff / 7) + 1;
}

/**
 * Week range by language:
 *   ar "19-24 <Arabic month>" · fr "19-24 oct." · en "Oct 19-24"
 *   when the months differ: ar "28 <month>-2 <month>" · fr "28 oct.-2 nov." · en "Oct 28-Nov 2".
 */
export function formatWeekRange(monday: string, locale: "ar" | "fr" | "en"): string {
  const tag = { ar: "ar-u-nu-latn", fr: "fr-FR", en: "en-US" }[locale];
  const month = (iso: string) => new Intl.DateTimeFormat(tag, { timeZone: "UTC", month: "short" }).format(parse(iso));
  const end = addDays(monday, 5);
  const d1 = parse(monday).getUTCDate();
  const d2 = parse(end).getUTCDate();
  const m1 = month(monday);
  const m2 = month(end);
  const same = parse(monday).getUTCMonth() === parse(end).getUTCMonth();
  if (locale === "en") return same ? `${m1} ${d1}–${d2}` : `${m1} ${d1}–${m2} ${d2}`;
  return same ? `${d1}–${d2} ${m1}` : `${d1} ${m1}–${d2} ${m2}`;
}
