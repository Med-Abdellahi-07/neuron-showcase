const tz = () => process.env.APP_TIMEZONE || "UTC";

/** تاريخ اليوم بصيغة YYYY-MM-DD في المنطقة الزمنية للتطبيق */
export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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

export function isValidISO(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parse(value).getTime());
}

export function formatDate(iso: string, locale: "ar" | "fr"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "fr-FR", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(parse(iso));
}
