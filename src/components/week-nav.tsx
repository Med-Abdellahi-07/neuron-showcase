import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays } from "@/lib/weeks";
import { formatWeekRange, weekNumber } from "@/lib/weeks";
import type { Locale } from "@/lib/i18n/dictionaries";

/** رأس التنقل بين الأسابيع: «الأسبوع 2 · 19–24 أكتوبر» + السابق/التالي + «هذا الأسبوع» (فقط عند الابتعاد). */
export function WeekNav({
  monday,
  defaultMonday,
  semesterStart,
  locale,
  hrefFor,
  labels,
  compact = false,
}: {
  monday: string;
  /** الأسبوع الافتراضي (الحالي، أو القادم يوم الأحد) */
  defaultMonday: string;
  semesterStart: string | null;
  locale: Locale;
  hrefFor: (monday: string | null) => string;
  labels: { week: string; prev: string; next: string; thisWeek: string };
  /** نسخة صغيرة تحت عنوان الصفحة (رأس الجدول الجديد) */
  compact?: boolean;
}) {
  const n = weekNumber(monday, semesterStart);
  const range = formatWeekRange(monday, locale);
  const arrow = "size-4 rtl:rotate-180";
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <Link href={hrefFor(addDays(monday, -7))} aria-label={labels.prev} className="flex size-6 items-center justify-center rounded-full text-muted">
          <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
        </Link>
        <span className="text-xs text-muted" aria-live="polite">
          {n !== null && <>{labels.week} <span className="tech">{n}</span> · </>}
          <span className="tech">{range}</span>
        </span>
        <Link href={hrefFor(addDays(monday, 7))} aria-label={labels.next} className="flex size-6 items-center justify-center rounded-full text-muted">
          <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
        </Link>
        {monday !== defaultMonday && (
          <Link href={hrefFor(null)} className="ms-1 text-[11px] text-accent hover:underline">{labels.thisWeek}</Link>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <Link href={hrefFor(addDays(monday, -7))} className="btn btn-sm" aria-label={labels.prev}>
        <ChevronLeft className={arrow} aria-hidden />
      </Link>
      <div className="text-center">
        <p className="text-sm font-semibold" aria-live="polite">
          {n !== null && <>{labels.week} <span className="tech">{n}</span> · </>}
          <span className="tech">{range}</span>
        </p>
        {monday !== defaultMonday && (
          <Link href={hrefFor(null)} className="text-xs text-accent hover:underline">{labels.thisWeek}</Link>
        )}
      </div>
      <Link href={hrefFor(addDays(monday, 7))} className="btn btn-sm" aria-label={labels.next}>
        <ChevronRight className={arrow} aria-hidden />
      </Link>
    </div>
  );
}
