import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, Download, Dumbbell, ExternalLink, FileText, NotebookPen } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { StudiedButton } from "@/components/studied-button";
import { getSubjectById } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import type { Lesson, LessonFile } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t, locale } = await getT();
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
  const [{ data: resumeRow }, signed, subject] = await Promise.all([
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
  ]);
  if (!subject) notFound();

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

      <section className="space-y-3" aria-labelledby="pdf-h">
        <h2 id="pdf-h" className="tech flex items-center gap-2 text-sm font-semibold text-muted">
          <FileText size={16} aria-hidden /> {t("lesson.pdf")}
        </h2>
        {pdfs.length === 0 && <p className="card text-sm text-muted">{t("lesson.noPdf")}</p>}
        {pdfs.map((f) => {
          const url = urls.get(f.id);
          return (
            <div key={f.id} className="space-y-2">
              {url && (
                <iframe src={url} title={f.name} className="h-[70vh] w-full rounded-[var(--radius)] border border-border bg-surface-2" />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="tech truncate text-xs text-muted" dir="ltr">{f.name}</span>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {resumeRow && (
          <Link href={`/lessons/${(resumeRow as { id: string }).id}`} className="btn">
            <FileText size={16} aria-hidden /> {t("lesson.resume")}
          </Link>
        )}
        <Link href={`/practice?lesson=${lesson.id}`} className="btn">
          <Dumbbell size={16} aria-hidden /> {t("lesson.practice")}
        </Link>
        <span className="btn cursor-not-allowed opacity-50" aria-disabled="true" title={t("common.soon")}>
          <Bot size={16} aria-hidden /> {t("lesson.ask")}
        </span>
      </div>
    </div>
  );
}
