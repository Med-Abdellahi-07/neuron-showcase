/**
 * منطق الأسابيع الدراسية — دوال صرفة بلا اعتماد على البيئة (تُختبر مباشرة بـ node --test).
 * أيام الدراسة: الإثنين–السبت. الأحد لا دراسة فيه.
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

/** يوم الأسبوع ISO: الإثنين = 1 … الأحد = 7 */
export function isoWeekday(iso: string): number {
  const d = parse(iso).getUTCDay();
  return d === 0 ? 7 : d;
}

/** بداية الأسبوع (الإثنين) لتاريخ معيّن */
export function mondayOf(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

/** تاريخ اليوم YYYY-MM-DD في منطقة زمنية معيّنة (لا UTC ولا توقيت الخادم) */
export function dateInZone(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * الأسبوع الذي يُعرض افتراضياً: الإثنين–السبت ← أسبوع اليوم نفسه،
 * الأحد ← الأسبوع القادم (لا دراسة يوم الأحد).
 */
export function defaultWeekMonday(today: string): string {
  return isoWeekday(today) === 7 ? addDays(today, 1) : mondayOf(today);
}

/** أول يوم دراسة من اليوم فصاعداً: الأحد ← الإثنين التالي، غيره ← اليوم نفسه. */
export function studyDateFrom(today: string): string {
  return isoWeekday(today) === 7 ? addDays(today, 1) : today;
}

/** هل غداً يوم دراسة؟ (مساء السبت لا؛ لأن الغد أحد) */
export function isStudyDay(iso: string): boolean {
  return isoWeekday(iso) <= 6;
}

/**
 * رقم الأسبوع الدراسي (1 = الأسبوع الذي يحتوي تاريخ بداية السداسي، من الإثنين).
 * يعيد null قبل بداية السداسي أو إن لم يُحدَّد تاريخ البداية.
 */
export function weekNumber(monday: string, semesterStart: string | null | undefined): number | null {
  if (!semesterStart || !/^\d{4}-\d{2}-\d{2}$/.test(semesterStart)) return null;
  const startMonday = mondayOf(semesterStart);
  const diff = Math.round((parse(mondayOf(monday)).getTime() - parse(startMonday).getTime()) / 86_400_000);
  return diff < 0 ? null : Math.floor(diff / 7) + 1;
}

/**
 * مدى الأسبوع (الإثنين–السبت) بحسب اللغة:
 *   ar «19–24 أكتوبر» · fr «19–24 oct.» · en «Oct 19–24»
 * وعند اختلاف الشهرين: «28 أكتوبر–2 نوفمبر» · «28 oct.–2 nov.» · «Oct 28–Nov 2».
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
