import { Video } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/dates";
import { RecordingPlayer, type Mark } from "@/components/recording-player";
import type { Provider } from "@/lib/recordings";

export interface RecordingRow {
  id: string;
  title: string;
  kind: string;
  rec_date: string;
  provider: Provider;
  video_id: string;
  status?: string;
}

/** بطاقات تسجيلات مع مشغّل لكل منها (يعمل في صفحة الحصة وصفحة المادة). */
export async function RecordingList({ items, marks = {} }: { items: RecordingRow[]; marks?: Record<string, Mark[]> }) {
  const { t, locale } = await getT();
  if (!items.length) return null;
  return (
    <ul className="space-y-4">
      {items.map((r) => (
        <li key={r.id} className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Video size={16} className="text-accent" aria-hidden />
            <h3 className="min-w-0 flex-1 font-semibold" dir="auto">{r.title}</h3>
            <span className="badge">{t(`kind.${r.kind as "cm" | "td" | "tp"}`)}</span>
            <span className="tech text-xs text-muted">{formatDate(r.rec_date, locale)}</span>
            {r.status && r.status !== "published" && <span className="badge">{t(`status.${r.status as "draft" | "pending"}`)}</span>}
          </div>
          <RecordingPlayer provider={r.provider} videoId={r.video_id} title={r.title} marks={marks[r.id]} />
        </li>
      ))}
    </ul>
  );
}
