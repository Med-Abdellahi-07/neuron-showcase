import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { deleteFile, deleteLesson, setLessonStatus, updateLesson } from "@/app/actions/content";
import { ActionForm } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm-button";
import { FileUploader } from "@/components/file-uploader";
import { StatusBadge } from "@/components/status-badge";
import type { Lesson, LessonFile, Subject } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditLessonPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireStaff();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t } = await getT();
  const supabase = await createClient();

  const { data: row } = await supabase.from("lessons").select("*").eq("id", id).maybeSingle();
  if (!row) notFound();
  const lesson = row as Lesson;
  const [{ data: subjectRow }, { data: fileRows }] = await Promise.all([
    supabase.from("subjects").select("*").eq("id", lesson.subject_id).single(),
    supabase.from("lesson_files").select("*").eq("lesson_id", id).order("created_at"),
  ]);
  const subject = subjectRow as Subject;
  const files = (fileRows ?? []) as LessonFile[];
  const canPublish = profile.role === "admin" || profile.can_publish_direct;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href={`/admin/content?s=${subject.code}`} className="text-sm text-accent hover:underline" dir="auto">{subject.code} — {subject.name}</Link>
        <h2 className="tech flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t(`kind.${lesson.kind}`)} {lesson.number}
          <StatusBadge status={lesson.status} />
        </h2>
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          {lesson.status !== "published" && (
            <form action={setLessonStatus}>
              <input type="hidden" name="id" value={lesson.id} />
              <input type="hidden" name="status" value="published" />
              <button className="btn btn-primary btn-sm">{canPublish ? t("action.publish") : t("action.submit")}</button>
            </form>
          )}
          {lesson.status === "pending" && (
            <form action={setLessonStatus}>
              <input type="hidden" name="id" value={lesson.id} />
              <input type="hidden" name="status" value="draft" />
              <button className="btn btn-sm">{t("action.reject")}</button>
            </form>
          )}
          {lesson.status === "published" && canPublish && (
            <form action={setLessonStatus}>
              <input type="hidden" name="id" value={lesson.id} />
              <input type="hidden" name="status" value="draft" />
              <button className="btn btn-sm">{t("action.unpublish")}</button>
            </form>
          )}
          <Link href={`/lessons/${lesson.id}`} className="btn btn-sm">{t("common.open")}</Link>
        </div>
        {!canPublish && <p className="text-xs text-muted">{t("content.pendingNote")}</p>}
      </section>

      <section className="card">
        <h3 className="tech mb-4 text-sm font-semibold">{t("content.edit")}</h3>
        <ActionForm action={updateLesson} submitLabel={t("common.save")}>
          <input type="hidden" name="id" value={lesson.id} />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="number">{t("common.number")}</label>
              <input id="number" name="number" type="number" min={1} className="input" dir="ltr" defaultValue={lesson.number} required />
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="lesson_date">{t("common.date")}</label>
              <input id="lesson_date" name="lesson_date" type="date" className="input" dir="ltr" defaultValue={lesson.lesson_date ?? ""} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="title">{t("common.title")}</label>
            <input id="title" name="title" className="input" dir="auto" defaultValue={lesson.title} required maxLength={200} />
          </div>
          {lesson.kind === "tp" && (
            <>
              <div>
                <label className="label" htmlFor="colab_url">{t("content.colab")}</label>
                <input id="colab_url" name="colab_url" type="url" className="input" dir="ltr" defaultValue={lesson.colab_url ?? ""} placeholder="https://colab.research.google.com/…" />
              </div>
              <div>
                <label className="label" htmlFor="drive_url">{t("content.drive")}</label>
                <input id="drive_url" name="drive_url" type="url" className="input" dir="ltr" defaultValue={lesson.drive_url ?? ""} placeholder="https://drive.google.com/…" />
              </div>
            </>
          )}
          {lesson.kind !== "tp" && (
            <>
              <input type="hidden" name="colab_url" value={lesson.colab_url ?? ""} />
              <input type="hidden" name="drive_url" value={lesson.drive_url ?? ""} />
            </>
          )}
        </ActionForm>
      </section>

      <section className="card space-y-4">
        <h3 className="tech text-sm font-semibold">{t("lesson.files")}</h3>
        {files.length === 0 ? (
          <p className="text-sm text-muted">{t("content.noFiles")}</p>
        ) : (
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded-[var(--radius)] bg-surface-2 p-2 ps-3">
                <span className="min-w-0 truncate text-sm">
                  <span className="badge me-2">{t(`file.${f.kind}`)}</span>
                  <span className="tech" dir="ltr">{f.name}</span>
                </span>
                <form action={deleteFile}>
                  <input type="hidden" name="id" value={f.id} />
                  <ConfirmButton>{t("common.delete")}</ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
        <FileUploader lessonId={lesson.id} />
      </section>

      <form action={deleteLesson}>
        <input type="hidden" name="id" value={lesson.id} />
        <ConfirmButton className="btn btn-danger">{t("common.delete")}</ConfirmButton>
      </form>
    </div>
  );
}
