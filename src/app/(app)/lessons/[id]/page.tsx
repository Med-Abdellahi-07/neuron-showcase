import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, Download, Dumbbell, FileDown, ExternalLink, FileText, NotebookPen, Video } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { StudiedButton } from "@/components/studied-button";
import { OfflineButton } from "@/components/offline-button";
import { RecordingList, type RecordingRow } from "@/components/recording-list";
import type { Mark } from "@/components/recording-player";
import { getSpace } from "@/lib/spaces";
import { getSubjectById } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import type { Lesson, LessonFile } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LessonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  const pageNum = parseInt((await searchParams).page ?? "", 10);
  const pdfHash = pageNum >= 1 && pageNum <= 5000 ? `#page=${pageNum}` : "";
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
  const features = (await getSpace())?.features;
  const supabase = await createClient();

  // الموجة 1: كل ما يكفيه معرّف الحصة من الرابط يُجلب معاً
  const [{ data: lessonRow }, { data: fileRows }, { data: prog }] = await Promise.all([
    supabase.from("lessons").select("*").eq("id", id).maybeSingle(),
    supabase.from("lesson_files").select("*").eq("lesson_id", id).order("created_at"),
    supabase.from("lesson_progress").select("lesson_id").eq("user_id", userId).eq("lesson_id", id).maybeSingle(),
  ]);
  if (!lessonRow) notFound();
  const lesson = lessonRow as Lesson;
  const files = (fileRows ?? []) as LessonFile[];

  // الموجة 2: ما يحتاج بيانات الحصة (الملخص، الروابط الموقّعة، المادة من الكتالوج المخزَّن)
  // التسجيلات: المربوطة بهذه الحصة صراحةً، أو التي تطابق (مادة + نوع + تاريخ الحصة)
  const recFilter = lesson.lesson_date
    ? `lesson_id.eq.${lesson.id},and(subject_id.eq.${lesson.subject_id},kind.eq.${lesson.kind},rec_date.eq.${lesson.lesson_date})`
    : `lesson_id.eq.${lesson.id}`;
  const [{ data: resumeRow }, signed, subject, { data: recRows }] = await Promise.all([
    lesson.kind === "resume"
      ? Promise.resolve({ data: null })
      : supabase
          .from("lessons")
          .select("id")
          .eq("subject_id", lesson.subject_id)
          .eq("kind", "resume")
          .eq("number", lesson.number)
          .eq("status", "published")
          .maybeSingle(),
    files.length
      ? supabase.storage.from("lesson-files").createSignedUrls(files.map((f) => f.storage_path), 3600)
      : Promise.resolve(null),
    getSubjectById(lesson.subject_id),
    lesson.kind === "resume"
      ? Promise.resolve({ data: [] })
      : supabase.from("recordings").select("id, title, kind, rec_date, provider, video_id, status").or(recFilter).order("rec_date", { ascending: false }),
  ]);
  if (!subject) notFound();
  const recordings = (recRows ?? []) as RecordingRow[];
  const marks: Record<string, Mark[]> = {};
  if (recordings.length) {
    const { data: m } = await supabase.from("recording_marks").select("recording_id, at_seconds, label").in("recording_id", recordings.map((r) => r.id)).order("at_seconds");
    for (const x of m ?? []) (marks[x.recording_id as string] ??= []).push({ at_seconds: x.at_seconds as number, label: x.label as string });
  }

  // روابط موقّعة لمدة ساعة
  const urls = new Map<string, string>();
  signed?.data?.forEach((s, i) => {
    if (s.signedUrl) urls.set(files[i].id, s.signedUrl);
  });
  const pdfs = files.filter((f) => f.kind === "pdf");
  const others = files.filter((f) => f.kind !== "pdf");

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/subjects/${subject.code}/${lesson.kind}`} className="text-sm text-accent hover:underline" dir="auto">
          {subject.name} · {t(`kind.${lesson.kind}`)}
        </Link>
        <h1 className="page-title !mb-0 mt-1" dir="auto">
          <span className="tech text-muted" dir="ltr">{lesson.number}.</span> {lesson.title}
        </h1>
        {lesson.lesson_date && <p className="tech text-sm text-muted">{formatDate(lesson.lesson_date, locale)}</p>}
        {lesson.status !== "published" && <span className="badge mt-2">{t(`status.${lesson.status}`)}</span>}
      </div>

      <StudiedButton lessonId={lesson.id} studied={!!prog} />
      <OfflineButton lessonId={lesson.id} withQuestions={!!features?.qcm_pdf} />

      {recordings.length > 0 && (
        <section className="space-y-3" aria-labelledby="rec-h">
          <h2 id="rec-h" className="tech flex items-center gap-2 text-sm font-semibold text-muted">
            <Video size={16} aria-hidden /> {t("rec.section")}
          </h2>
          <RecordingList items={recordings} marks={marks} />
        </section>
      )}

      <section className="space-y-3" aria-labelledby="pdf-h">
        <h2 id="pdf-h" className="tech flex items-center gap-2 text-sm font-semibold text-muted">
          <FileText size={16} aria-hidden /> {t("lesson.pdf")}
        </h2>
        {pdfs.length === 0 && <p className="card text-sm text-muted">{t("lesson.noPdf")}</p>}
        {pdfs.map((f) => {
          const url = urls.get(f.id);
          const viewUrl = url && pdfHash && f.id === pdfs[0].id ? url + pdfHash : url;
          return (
            <div key={f.id} className="space-y-2">
              {url && (
                <iframe key={viewUrl} src={viewUrl} title={f.name} className="h-[70vh] w-full rounded-[var(--radius)] border border-border bg-surface-2" />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="tech truncate text-xs text-muted" dir="ltr">{f.name}</span>
                {url && (
                  <a href={viewUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                    <ExternalLink size={14} aria-hidden /> {t("common.open")}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {(others.length > 0 || lesson.colab_url || lesson.drive_url) && (
        <section className="space-y-2" aria-labelledby="files-h">
          <h2 id="files-h" className="tech text-sm font-semibold text-muted">{t("lesson.files")}</h2>
          <div className="flex flex-wrap gap-2">
            {lesson.colab_url && (
              <a href={lesson.colab_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                <NotebookPen size={16} aria-hidden /> {t("lesson.openColab")}
              </a>
            )}
            {lesson.drive_url && (
              <a href={lesson.drive_url} target="_blank" rel="noopener noreferrer" className="btn">
                <ExternalLink size={16} aria-hidden /> {t("lesson.openDrive")}
              </a>
            )}
          </div>
          <ul className="space-y-2">
            {others.map((f) => (
              <li key={f.id} className="card flex items-center justify-between gap-2 !p-3">
                <span className="tech truncate text-sm" dir="ltr">{f.name}</span>
                {urls.get(f.id) && (
                  <a href={urls.get(f.id)} download={f.name} className="btn btn-sm shrink-0">
                    <Download size={14} aria-hidden /> {t("common.download")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {resumeRow && (
          <Link href={`/lessons/${(resumeRow as { id: string }).id}`} className="btn">
            <FileText size={16} aria-hidden /> {t("lesson.resume")}
          </Link>
        )}
        <Link href={`/practice?lesson=${lesson.id}`} className="btn">
          <Dumbbell size={16} aria-hidden /> {t("lesson.practice")}
        </Link>
        {features?.qcm_pdf && (
          <Link href={`/practice/qcm?lesson=${lesson.id}`} className="btn">
            <FileDown size={16} aria-hidden /> {t("qcm.title")}
          </Link>
        )}
        {features?.ai && (
          <Link href={`/assistant?lesson=${lesson.id}`} className="btn w-full">
            <Bot size={16} aria-hidden /> {t("lesson.ask")}
          </Link>
        )}
      </div>
    </div>
  );
}
