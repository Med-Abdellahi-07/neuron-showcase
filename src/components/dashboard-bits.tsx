import { daysSince } from "@/lib/dates";
import type { DictKey } from "@/lib/i18n/dictionaries";

/** Relative "last activity" with translated text (t is passed in by the caller). */
export function relativeSeen(iso: string | null, t: (k: DictKey) => string): string {
  if (!iso) return t("stats.never");
  const d = daysSince(iso);
  return d === 0 ? t("stats.today") : `${d} ${t("stats.daysAgo")}`;
}

export function Tile({ label, value, tone }: { label: string; value: number | string; tone?: "warn" }) {
  return (
    <div className="card">
      <p className={`tech text-3xl font-semibold ${tone === "warn" ? "text-warn" : "text-accent"}`} dir="ltr">{value}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}
