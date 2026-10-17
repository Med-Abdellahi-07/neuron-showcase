"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";
import { getAllSubjects } from "@/lib/data";
import { asSessionLang } from "@/lib/ai/lang";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = ["explain", "review", "solve"];

export interface Exercise {
  id: string;
  type: "mcq" | "written";
  difficulty: string;
  statement: string;
}

export type CreateChatResult = { ok: true; id: string } | { ok: false; error: "invalid" | "failed" };

/**
 * محادثة موجَّهة جديدة: مادة ثم حصة واحدة أو عدة حصص أو كل حصص المادة.
 * lessonIds فارغة = كل حصص المادة. لا يبدأ المساعد هنا؛ الواجهة تطلب "start" بعد الانتقال.
 */
export async function createChat(input: {
  mode: string;
  subjectCode: string;
  lessonIds: string[];
  questionId?: string | null;
  lang?: string;
}): Promise<CreateChatResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "failed" };
  if (!MODES.includes(input.mode)) return { ok: false, error: "invalid" };
  const lessonIds = [...new Set((input.lessonIds ?? []).filter((x) => UUID_RE.test(x)))].slice(0, 30);
  const supabase = await createClient();

  let subjectId: string | null = null;
  let title = "";
  if (lessonIds.length) {
    const { data: ls } = await supabase.from("lessons").select("id, subject_id, kind, number, title").in("id", lessonIds);
    const rows = ls ?? [];
    if (rows.length !== lessonIds.length) return { ok: false, error: "invalid" };
    const subjects = new Set(rows.map((r) => r.subject_id as string));
    if (subjects.size !== 1) return { ok: false, error: "invalid" };
    subjectId = rows[0].subject_id as string;
    title =
      rows.length === 1
        ? `${String(rows[0].kind).toUpperCase()} ${rows[0].number} — ${rows[0].title}`
        : rows.map((r) => `${String(r.kind).toUpperCase()} ${r.number}`).join(", ");
  } else {
    const subject = (await getAllSubjects()).find((s) => s.code === input.subjectCode);
    if (!subject) return { ok: false, error: "invalid" };
    subjectId = subject.id;
    title = `${subject.code} — ${subject.name}`;
  }

  let questionId: string | null = null;
  if (input.mode === "solve" && input.questionId && UUID_RE.test(input.questionId)) {
    const { data: q } = await supabase.from("questions").select("id, subject_id").eq("id", input.questionId).maybeSingle();
    if (!q || q.subject_id !== subjectId) return { ok: false, error: "invalid" };
    questionId = q.id as string;
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({
      subject_id: subjectId,
      lesson_id: lessonIds.length === 1 ? lessonIds[0] : null,
      lesson_ids: lessonIds,
      question_id: questionId,
      mode: input.mode,
      guided: true,
      lang: asSessionLang(input.lang),
      title: title.slice(0, 120),
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createChat failed:", error?.message);
    return { ok: false, error: "failed" };
  }
  revalidatePath("/assistant");
  return { ok: true, id: data.id as string };
}

/** تمارين بنك الأسئلة المنشورة ضمن النطاق (الحصص المختارة أو كل المادة). لا تُرجع الإجابات. */
export async function listExercises(subjectCode: string, lessonIds: string[]): Promise<Exercise[]> {
  const userId = await getUserId();
  if (!userId) return [];
  const supabase = await createClient();
  const ids = lessonIds.filter((x) => UUID_RE.test(x)).slice(0, 30);
  let qb = supabase
    .from("questions")
    .select("id, type, difficulty, statement")
    .eq("status", "published")
    .order("created_at")
    .limit(40);
  if (ids.length) qb = qb.in("lesson_id", ids);
  else {
    const subject = (await getAllSubjects()).find((s) => s.code === subjectCode);
    if (!subject) return [];
    qb = qb.eq("subject_id", subject.id);
  }
  const { data } = await qb;
  return (data ?? []).map((q) => ({
    id: q.id as string,
    type: q.type as "mcq" | "written",
    difficulty: q.difficulty as string,
    statement: (q.statement as string).slice(0, 160),
  }));
}

export async function deleteConversation(fd: FormData) {
  const userId = await getUserId();
  if (!userId) return;
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.from("conversations").delete().eq("id", id);
  revalidatePath("/assistant");
}
