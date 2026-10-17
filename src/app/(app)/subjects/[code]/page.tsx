import Link from "next/link";
import { notFound } from "next/navigation";
import { Video } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSubjectByCode } from "@/lib/data";
import { LESSON_KINDS } from "@/lib/constants";
import { RecordingList, type RecordingRow } from "@/components/recording-list";
import type { Mark } from "@/components/recording-player";

export default async function SubjectPage({ params }: { params: Promise<{ code: string }> }) {
  await requireUserId();
  const { code } = await params;
  const { t } = await getT();
  const subject = await getSubjectByCode(decodeURIComponent(code));
  if (!subject) notFound();

  const supabase = await createClient();
  const [{ data: lessons }, { data: recRows }] = await Promise.all([
    supabase.from("lessons").select("kind").eq("subject_id", subject.id).eq("status", "published"),
    supabase.from("recordings").select("id, title, kind, rec_date, provider, video_id, status").eq("subject_id", subject.id).order("rec_date", { ascending: false }).limit(50),
  ]);
  const recordings = (recRows ?? []) as RecordingRow[];
  const marks: Record<string, Mark[]> = {};
  if (recordings.length) {
    const { data: m } = await supabase.from("recording_marks").select("recording_id, at_seconds, label").in("recording_id", recordings.map((r) => r.id)).order("at_seconds");
    for (const x of m ?? []) (marks[x.recording_id as string] ??= []).push({ at_seconds: x.at_seconds as number, label: x.label as string });
  }
  const counts = new Map<string, number>();
  for (const l of lessons ?? []) counts.set(l.kind as string, (counts.get(l.kind as string) ?? 0) + 1);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/subjects" className="text-sm text-accent hover:underline">{t("nav.subjects")}</Link>
        <h1 className="page-title !mb-0 mt-1" dir="auto">{subject.name}</h1>
        <p className="tech text-sm text-muted" dir="ltr">{subject.code}</p>
      </div>

      <ul className="grid grid-cols-2 gap-3">
        {LESSON_KINDS.map((k) => (
          <li key={k}>
            <Link href={`/subjects/${subject.code}/${k}`} className="card block text-center transition-colors hover:bg-surface-2">
              <p className="tech text-lg font-semibold">{t(`kind.${k}`)}</p>
              <p className="mt-1 text-xs text-muted">{counts.get(k) ?? 0} {t("common.lessons")}</p>
            </Link>
          </li>
        ))}
      </ul>

      <section className="space-y-3" aria-labelledby="rec-h">
        <h2 id="rec-h" className="tech flex items-center gap-2 text-sm font-semibold text-muted">
          <Video size={16} aria-hidden /> {t("subjects.recordings")}
        </h2>
        {recordings.length === 0 ? <p className="card text-sm text-muted">{t("rec.none")}</p> : <RecordingList items={recordings} marks={marks} />}
      </section>
    </div>
  );
}
