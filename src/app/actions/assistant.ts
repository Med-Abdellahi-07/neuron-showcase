"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";
import { getAllSubjects } from "@/lib/data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = ["explain", "review", "solve"];

/** محادثة جديدة، اختيارياً مربوطة بمادة أو بحصة. */
export async function startChat(fd: FormData) {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  const supabase = await createClient();

  const lessonRaw = String(fd.get("lesson") ?? "");
  const lessonId = UUID_RE.test(lessonRaw) ? lessonRaw : null;
  const mode = MODES.includes(String(fd.get("mode"))) ? String(fd.get("mode")) : "explain";

  let subjectId: string | null = null;
  if (lessonId) {
    const { data } = await supabase.from("lessons").select("subject_id").eq("id", lessonId).maybeSingle();
    subjectId = (data?.subject_id as string | undefined) ?? null;
    if (!subjectId) redirect("/assistant");
  } else {
    const code = String(fd.get("subject") ?? "");
    if (code) subjectId = (await getAllSubjects()).find((s) => s.code === code)?.id ?? null;
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert({ subject_id: subjectId, lesson_id: lessonId, mode })
    .select("id")
    .single();
  if (error || !data) {
    console.error("startChat failed:", error?.message);
    redirect("/assistant");
  }
  redirect(`/assistant/${data.id}`);
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
