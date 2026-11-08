import { dateInZone } from "@/lib/weeks";
import { INTL_TAG, type Locale } from "@/lib/i18n/dictionaries";

const tz = () => process.env.APP_TIMEZONE || "UTC";

/** The app's time zone (also used for the week boundary in the ranking). */
export const appTimeZone = tz;

/** Today's date as YYYY-MM-DD in the app's time zone. */
export function todayISO(now = new Date()): string {
  return dateInZone(now, tz());
}

/** Current time HH:MM in the app's time zone. */
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

// Pure week functions live in weeks.ts (tested); re-exported here for compatibility.
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

/** Current time in milliseconds (a separate function so server pages can use it). */
export const nowMs = () => Date.now();

/** Number of whole days since a given instant. */
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
}
