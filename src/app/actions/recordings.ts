"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { parseVideoUrl } from "@/lib/recordings";
import { isValidISO } from "@/lib/dates";
import { notifyNewRecording } from "@/lib/notify";
import type { FormState } from "./auth";

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** المشرف: ينتظر الموافقة ما لم يملك النشر المباشر (trigger). المدير: ينشر فوراً. */
export async function createRecording(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireStaff();
  const { t } = await getT();
  const cohort_id = text(fd, "cohort_id");
  const subject_id = text(fd, "subject_id");
  const kind = text(fd, "kind");
  const rec_date = text(fd, "rec_date");
  const lessonRaw = text(fd, "lesson_id");
  const title = text(fd, "title").slice(0, 200);
  const video = parseVideoUrl(text(fd, "url"));
  if (!UUID_RE.test(cohort_id) || !UUID_RE.test(subject_id) || !["cm", "td", "tp"].includes(kind) || !isValidISO(rec_date) || !title)
    return { error: t("common.error") };
  if (!video) return { error: t("rec.badUrl") };
  const lesson_id = UUID_RE.test(lessonRaw) ? lessonRaw : null;

  const supabase = await createClient();
  if (lesson_id) {
    const { data: l } = await supabase.from("lessons").select("subject_id").eq("id", lesson_id).maybeSingle();
    if (!l || l.subject_id !== subject_id) return { error: t("rec.lessonMismatch") };
  }
  const { data, error } = await supabase
    .from("recordings")
    .insert({ cohort_id, subject_id, kind, rec_date, lesson_id, title, provider: video.provider, video_id: video.video_id, status: "published" })
    .select("status")
    .single();
  if (error) return { error: t("common.error") };
  if (data.status === "published") await notifyNewRecording({ cohort_id, subject_id, kind, title, lesson_id });
  revalidatePath("/", "layout");
  return { message: data.status === "published" ? t("rec.published") : t("rec.pending") };
}

export async function setRecordingStatus(fd: FormData) {
  await requireAdmin();
  const id = text(fd, "id");
  const status = text(fd, "status");
  if (!UUID_RE.test(id) || !["draft", "pending", "published"].includes(status)) return;
  const supabase = await createClient();
  const { data } = await supabase.from("recordings").update({ status }).eq("id", id).select("cohort_id, subject_id, kind, title, lesson_id, status").maybeSingle();
  if (data?.status === "published")
    await notifyNewRecording({ cohort_id: data.cohort_id, subject_id: data.subject_id, kind: data.kind, title: data.title, lesson_id: data.lesson_id });
  revalidatePath("/", "layout");
}

export async function deleteRecording(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.from("recordings").delete().eq("id", id);
  revalidatePath("/", "layout");
}
