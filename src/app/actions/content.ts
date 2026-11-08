"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { indexFile } from "@/lib/ai/indexing";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager, requireStaff } from "@/lib/auth";
import { getSpace } from "@/lib/spaces";
import { getT } from "@/lib/i18n/server";
import { INDEX_IN_BROWSER_OVER, partPath } from "@/lib/big-file";
import { LESSON_KINDS } from "@/lib/constants";
import { notifyNewLesson, notifyNewQuestions } from "@/lib/notify";
import { parseQuestionInput, type ImportError, type ImportQuestion } from "@/lib/question-import";
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
/** All storage objects of a file: a normal file is one path, a multipart file is part-001...part-N. */
const objectPaths = (path: string, parts: number) => (parts > 1 ? Array.from({ length: parts }, (_, i) => partPath(path, i)) : [path]);
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

/** Admin publishes directly. Moderators: "published" becomes "pending" through a trigger unless they have direct-publish permission. */
export async function setLessonStatus(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  const status = text(fd, "status");
  if (!UUID_RE.test(id) || !["draft", "pending", "published"].includes(status)) return;
  const supabase = await createClient();
  const { data: before } = await supabase.from("lessons").select("status").eq("id", id).maybeSingle();
  const { data } = await supabase.from("lessons").update({ status }).eq("id", id).select("id, subject_id, kind, number, title, status").maybeSingle();
  // "New content" notification on the first real transition to published (the trigger may turn a moderator's request into pending).
  if (data?.status === "published" && before?.status !== "published") await notifyNewLesson(data);
  revalidatePath("/", "layout");
}

export async function deleteLesson(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  const { data: files } = await supabase.from("lesson_files").select("storage_path, part_count").eq("lesson_id", id);
  if (files?.length) await supabase.storage.from("lesson-files").remove(files.flatMap((f) => objectPaths(f.storage_path as string, f.part_count as number)));
  const { error } = await supabase.from("lessons").delete().eq("id", id);
  if (error) return;
  revalidatePath("/", "layout");
  redirect("/admin/content");
}

/** Called from the browser after the file (or all its parts) was uploaded straight to Storage. */
export async function registerFile(input: {
  id?: string;
  lessonId: string;
  kind: "pdf" | "code" | "data";
  name: string;
  path: string;
  size: number;
  partCount?: number;
  sha256?: string;
  partSha256?: string[];
}): Promise<{ ok: boolean; id?: string; indexInBrowser?: boolean }> {
  await requireStaff();
  if (!UUID_RE.test(input.lessonId) || !["pdf", "code", "data"].includes(input.kind)) return { ok: false };
  // The path must sit under the lesson's own folder.
  if (!input.path.startsWith(`${input.lessonId}/`) || input.path.includes("..")) return { ok: false };
  const parts = Math.trunc(input.partCount ?? 1);
  if (parts < 1 || parts > 2000 || (input.id && !UUID_RE.test(input.id))) return { ok: false };
  if (parts > 1 && (!/^[0-9a-f]{64}$/.test(input.sha256 ?? "") || input.partSha256?.length !== parts || !input.partSha256.every((h) => /^[0-9a-f]{64}$/.test(h)))) return { ok: false };
  const supabase = await createClient();

  // Multipart: make sure every part exists and the sum of sizes equals the declared size.
  if (parts > 1) {
    const { data: objs } = await supabase.storage.from("lesson-files").list(input.path, { limit: parts + 5 });
    const sizes = new Map((objs ?? []).map((o) => [o.name, Number((o.metadata as { size?: number } | null)?.size ?? 0)]));
    let total = 0;
    for (let i = 0; i < parts; i++) {
      const n = partPath("", i).slice(1);
      if (!sizes.has(n)) return { ok: false };
      total += sizes.get(n) ?? 0;
    }
    if (total !== input.size) return { ok: false };
  }

  const { data: inserted, error } = await supabase
    .from("lesson_files")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      lesson_id: input.lessonId,
      kind: input.kind,
      name: input.name.slice(0, 200),
      storage_path: input.path,
      size_bytes: input.size,
      part_count: parts,
      sha256: parts > 1 ? input.sha256 : null,
      part_sha256: parts > 1 ? input.partSha256 : null,
    })
    .select("id")
    .single();
  // Indexing is for the AI assistant only: spaces without the feature never call AI.
  const aiOn = (await getSpace())?.features.ai === true;
  const big = parts > 1 || input.size > INDEX_IN_BROWSER_OVER;
  if (!error && inserted && aiOn && input.kind === "pdf" && process.env.SUPABASE_SERVICE_ROLE_KEY && !big) {
    // Indexing (text extraction + embeddings) runs after the response is sent, so the admin does not wait.
    after(async () => {
      try {
        await indexFile(inserted.id as string);
      } catch (e) {
        console.error("indexFile failed:", e);
      }
    });
  }
  if (error) {
    await supabase.storage.from("lesson-files").remove(objectPaths(input.path, parts));
    return { ok: false };
  }
  revalidatePath("/", "layout");
  // Large files: the client extracts text with pdf.js and sends it in batches (no server timeout).
  return { ok: true, id: inserted.id as string, indexInBrowser: aiOn && input.kind === "pdf" && big && !!process.env.SUPABASE_SERVICE_ROLE_KEY };
}

export async function deleteFile(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  const { data: file } = await supabase.from("lesson_files").select("storage_path, part_count").eq("id", id).maybeSingle();
  if (!file) return;
  await supabase.storage.from("lesson-files").remove(objectPaths(file.storage_path as string, file.part_count as number));
  await supabase.from("lesson_files").delete().eq("id", id);
  revalidatePath("/", "layout");
}

// Questions.

export interface ImportOutcome {
  inserted: number;
  unlinked: number;
  errors: ImportError[];
}

export async function importQuestions(raw: string): Promise<ImportOutcome> {
  await requireStaff();
  const parsed = parseQuestionInput(raw.slice(0, 2_000_000));
  const errors = [...parsed.errors];
  if (!parsed.valid.length) return { inserted: 0, unlinked: 0, errors };

  const writtenOn = (await getSpace())?.features.written === true;
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
    if (q.type === "written" && !writtenOn) {
      errors.push({ row: i + 1, keys: ["imp.err.writtenLocked"] });
      return;
    }
    if (!subject_id) {
      errors.push({ row: i + 1, keys: ["imp.err.unknownSubject"], detail: q.subject });
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
      exam_only: q.exam_only,
      status: "published", // The trigger turns this into pending for users without direct-publish permission.
    });
  });

  let inserted = 0;
  const published = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error, data } = await supabase.from("questions").insert(chunk).select("id, subject_id, status");
    if (error) errors.push({ row: i + 1, keys: [], detail: error.message });
    else {
      inserted += data?.length ?? 0;
      for (const r of data ?? []) if (r.status === "published") published.set(r.subject_id as string, (published.get(r.subject_id as string) ?? 0) + 1);
    }
  }
  for (const [sid, n] of [...published].slice(0, 3)) await notifyNewQuestions(sid, n);
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

/** Manually re-index a PDF file (for example after fixing the keys). */
export async function reindexFile(fd: FormData) {
  await requireStaff();
  if (!(await getSpace())?.features.ai) return;
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  try {
    await indexFile(id);
  } catch (e) {
    console.error("indexFile failed:", e);
  }
  revalidatePath("/", "layout");
}

/** Admin only: assign a question to the ranked quiz (it never shows in free practice or in QCM downloads) or unassign it. */
export async function setQuestionExamOnly(fd: FormData) {
  await requireManager();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.from("questions").update({ exam_only: text(fd, "value") === "1" }).eq("id", id);
  revalidatePath("/admin/questions");
}
