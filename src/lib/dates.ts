import { dateInZone } from "@/lib/weeks";
import { INTL_TAG, type Locale } from "@/lib/i18n/dictionaries";

const tz = () => process.env.APP_TIMEZONE || "UTC";

/** المنطقة الزمنية للتطبيق (تُستعمل أيضاً لحدّ الأسبوع في الترتيب) */
export const appTimeZone = tz;

/** تاريخ اليوم بصيغة YYYY-MM-DD في المنطقة الزمنية للتطبيق */
export function todayISO(now = new Date()): string {
  return dateInZone(now, tz());
}

/** الوقت الحالي HH:MM في المنطقة الزمنية للتطبيق */
export function nowHM(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

// الدوال الصرفة للأسابيع في weeks.ts (مختبَرة)؛ نعيد تصديرها هنا للتوافق
export { addDays, isoWeekday, mondayOf } from "@/lib/weeks";

export function isValidISO(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parse(value).getTime());
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(parse(iso));
}

/** الوقت الحالي بالميلي ثانية (دالة منفصلة لاستعمالها داخل صفحات الخادم) */
export const nowMs = () => Date.now();

/** عدد الأيام الكاملة منذ لحظة معيّنة */
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
}
