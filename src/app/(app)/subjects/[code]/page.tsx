import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Video } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { getSpace } from "@/lib/spaces";
import { createClient } from "@/lib/supabase/server";
import { getSubjectByCode } from "@/lib/data";
import { LESSON_KINDS } from "@/lib/constants";
import { RecordingList, type RecordingRow } from "@/components/recording-list";
import type { Mark } from "@/components/recording-player";
import { ProgressRing } from "@/components/progress-ring";

export default async function SubjectPage({ params }: { params: Promise<{ code: string }> }) {
  const userId = await requireUserId();
  const { code } = await params;
  const { t } = await getT();
  const features = (await getSpace())?.features;
  const subject = await getSubjectByCode(decodeURIComponent(code));
  if (!subject) notFound();

  const supabase = await createClient();
  const [{ data: lessons }, { data: recRows }, { data: prog }] = await Promise.all([
    supabase.from("lessons").select("id, kind").eq("subject_id", subject.id).eq("status", "published"),
    supabase.from("recordings").select("id, title, kind, rec_date, provider, video_id, status").eq("subject_id", subject.id).order("rec_date", { ascending: false }).limit(50),
    supabase.from("lesson_progress").select("lesson_id").eq("user_id", userId),
  ]);
  const studiedSet = new Set((prog ?? []).map((p) => p.lesson_id as string));
  const recordings = (recRows ?? []) as RecordingRow[];
  const marks: Record<string, Mark[]> = {};
  if (recordings.length) {
    const { data: m } = await supabase.from("recording_marks").select("recording_id, at_seconds, label").in("recording_id", recordings.map((r) => r.id)).order("at_seconds");
    for (const x of m ?? []) (marks[x.recording_id as string] ??= []).push({ at_seconds: x.at_seconds as number, label: x.label as string });
  }
  const counts = new Map<string, number>();
  const doneByKind = new Map<string, number>();
  let allDone = 0;
  let allTotal = 0;
  for (const l of lessons ?? []) {
    counts.set(l.kind as string, (counts.get(l.kind as string) ?? 0) + 1);
    if (l.kind === "resume") continue;
    allTotal += 1;
    if (studiedSet.has(l.id as string)) {
      allDone += 1;
      doneByKind.set(l.kind as string, (doneByKind.get(l.kind as string) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-5">
      <div className="card-lg flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <Link href="/subjects" className="text-sm text-accent hover:underline">{t("nav.subjects")}</Link>
          <h1 className="page-title !mb-0 mt-1" dir="auto">{subject.name}</h1>
          <p className="tech text-sm text-muted" dir="ltr">{subject.code}</p>
        </div>
        <ProgressRing done={allDone} total={allTotal} size={72} />
      </div>

      <ul className="grid grid-cols-2 gap-3">
        {LESSON_KINDS.map((k) => (
          <li key={k}>
            <Link href={`/subjects/${subject.code}/${k}`} className="card press flex flex-col items-center gap-2 text-center transition-colors hover:bg-surface-2">
              {k === "resume" ? (
                <span className="icon-box size-[52px]"><FileText size={22} strokeWidth={1.9} aria-hidden /></span>
              ) : (
                <ProgressRing done={doneByKind.get(k) ?? 0} total={counts.get(k) ?? 0} size={52} stroke={6} />
              )}
              <span>
                <span className="tech block text-lg font-semibold">{t(`kind.${k}`)}</span>
                <span className="mt-0.5 block text-xs text-muted">{counts.get(k) ?? 0} {t("common.lessons")}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {features?.recordings && (
      <section className="space-y-3" aria-labelledby="rec-h">
        <h2 id="rec-h" className="tech flex items-center gap-2 text-sm font-semibold text-muted">
          <Video size={16} aria-hidden /> {t("subjects.recordings")}
        </h2>
        {recordings.length === 0 ? <p className="card text-sm text-muted">{t("rec.none")}</p> : <RecordingList items={recordings} marks={marks} />}
      </section>
      )}
    </div>
  );
}
