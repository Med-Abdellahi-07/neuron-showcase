"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { LESSON_KINDS } from "@/lib/constants";
import { parseQuestionInput, type ImportQuestion } from "@/lib/question-import";
import type { FormState } from "./auth";
import type { LessonKind } from "@/lib/types";

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optional = (fd: FormData, k: string) => text(fd, k) || null;
const isUrl = (v: string | null) => {
  if (!v) return true;
  try {
    return ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lessonFields(fd: FormData) {
  return {
    title: text(fd, "title"),
    lesson_date: optional(fd, "lesson_date"),
    colab_url: optional(fd, "colab_url"),
    drive_url: optional(fd, "drive_url"),
  };
}

export async function createLesson(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireStaff();
  const { t } = await getT();
  const kind = text(fd, "kind") as LessonKind;
  const number = parseInt(text(fd, "number"), 10);
  const subject_id = text(fd, "subject_id");
  const f = lessonFields(fd);
  if (!UUID_RE.test(subject_id) || !LESSON_KINDS.includes(kind) || !(number > 0) || !f.title)
    return { error: t("common.error") };
  if (!isUrl(f.colab_url) || !isUrl(f.drive_url)) return { error: t("common.error") };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lessons")
    .insert({ subject_id, kind, number, ...f, status: "draft" })
    .select("id")
    .single();
  if (error) return { error: error.code === "23505" ? t("content.exists") : t("common.error") };
  revalidatePath("/admin/content");
  redirect(`/admin/content/${data.id}`);
}

export async function updateLesson(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireStaff();
  const { t } = await getT();
  const id = text(fd, "id");
  const number = parseInt(text(fd, "number"), 10);
  const f = lessonFields(fd);
  if (!UUID_RE.test(id) || !(number > 0) || !f.title || !isUrl(f.colab_url) || !isUrl(f.drive_url))
    return { error: t("common.error") };

  const supabase = await createClient();
  const { data, error } = await supabase.from("lessons").update({ number, ...f }).eq("id", id).select("id");
  if (error) return { error: error.code === "23505" ? t("content.exists") : t("common.error") };
  if (!data?.length) return { error: t("common.error") };
  revalidatePath("/", "layout");
  return { message: t("content.saved") };
}

/** المدير: ينشر مباشرة. المشرف: تتحول "published" إلى "pending" عبر trigger ما لم يملك صلاحية النشر المباشر. */
export async function setLessonStatus(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  const status = text(fd, "status");
  if (!UUID_RE.test(id) || !["draft", "pending", "published"].includes(status)) return;
  const supabase = await createClient();
  await supabase.from("lessons").update({ status }).eq("id", id);
  revalidatePath("/", "layout");
}

export async function deleteLesson(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  const { data: files } = await supabase.from("lesson_files").select("storage_path").eq("lesson_id", id);
  if (files?.length) await supabase.storage.from("lesson-files").remove(files.map((f) => f.storage_path as string));
  const { error } = await supabase.from("lessons").delete().eq("id", id);
  if (error) return;
  revalidatePath("/", "layout");
  redirect("/admin/content");
}

/** تُستدعى من المتصفح بعد رفع الملف مباشرة إلى Storage. */
export async function registerFile(input: {
  lessonId: string;
  kind: "pdf" | "code" | "data";
  name: string;
  path: string;
  size: number;
}): Promise<{ ok: boolean }> {
  await requireStaff();
  if (!UUID_RE.test(input.lessonId) || !["pdf", "code", "data"].includes(input.kind)) return { ok: false };
  // المسار يجب أن يقع تحت مجلد الحصة نفسها
  if (!input.path.startsWith(`${input.lessonId}/`) || input.path.includes("..")) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("lesson_files").insert({
    lesson_id: input.lessonId,
    kind: input.kind,
    name: input.name.slice(0, 200),
    storage_path: input.path,
    size_bytes: input.size,
  });
  if (error) {
    await supabase.storage.from("lesson-files").remove([input.path]);
    return { ok: false };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteFile(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  const { data: file } = await supabase.from("lesson_files").select("storage_path").eq("id", id).maybeSingle();
  if (!file) return;
  await supabase.storage.from("lesson-files").remove([file.storage_path as string]);
  await supabase.from("lesson_files").delete().eq("id", id);
  revalidatePath("/", "layout");
}

// ───────────── الأسئلة ─────────────

export interface ImportOutcome {
  inserted: number;
  unlinked: number;
  errors: { row: number; message: string }[];
}

export async function importQuestions(raw: string): Promise<ImportOutcome> {
  await requireStaff();
  const parsed = parseQuestionInput(raw.slice(0, 2_000_000));
  const errors = [...parsed.errors];
  if (!parsed.valid.length) return { inserted: 0, unlinked: 0, errors };

  const supabase = await createClient();
  const { data: subjects } = await supabase.from("subjects").select("id, code");
  const subjectByCode = new Map((subjects ?? []).map((s) => [(s.code as string).toUpperCase(), s.id as string]));
  const { data: lessons } = await supabase.from("lessons").select("id, subject_id, kind, number");
  const lessonKey = (sid: string, kind: string, n: number) => `${sid}:${kind}:${n}`;
  const lessonByKey = new Map((lessons ?? []).map((l) => [lessonKey(l.subject_id as string, l.kind as string, l.number as number), l.id as string]));

  let unlinked = 0;
  const rows: Record<string, unknown>[] = [];
  parsed.valid.forEach((q: ImportQuestion, i) => {
    const subject_id = subjectByCode.get(q.subject);
    if (!subject_id) {
      errors.push({ row: i + 1, message: `مادة غير معروفة: ${q.subject}` });
      return;
    }
    let lesson_id: string | null = null;
    if (q.lesson_kind && q.lesson_number) {
      lesson_id = lessonByKey.get(lessonKey(subject_id, q.lesson_kind, q.lesson_number)) ?? null;
      if (!lesson_id) unlinked += 1;
    }
    rows.push({
      subject_id,
      lesson_id,
      type: q.type,
      difficulty: q.difficulty,
      statement: q.statement,
      options: q.type === "mcq" ? q.options : null,
      correct_index: q.type === "mcq" ? q.correct_index : null,
      model_answer: q.type === "written" ? q.model_answer : (q.model_answer ?? null),
      explanation: q.explanation ?? null,
      status: "published", // trigger يحوّلها إلى pending لمن لا يملك النشر المباشر
    });
  });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error, data } = await supabase.from("questions").insert(chunk).select("id");
    if (error) errors.push({ row: i + 1, message: error.message });
    else inserted += data?.length ?? 0;
  }
  revalidatePath("/", "layout");
  return { inserted, unlinked, errors };
}

export async function setQuestionStatus(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  const status = text(fd, "status");
  if (!UUID_RE.test(id) || !["draft", "pending", "published"].includes(status)) return;
  const supabase = await createClient();
  await supabase.from("questions").update({ status }).eq("id", id);
  revalidatePath("/", "layout");
}

export async function deleteQuestion(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.from("questions").delete().eq("id", id);
  revalidatePath("/", "layout");
}
