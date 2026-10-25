"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";
import { getSubjectById } from "@/lib/data";
import type { OfflineQuestion, OfflineSummary, PackManifest } from "@/lib/offline/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * يجهّز حصة للتنزيل: روابط PDF موقّعة (ساعة)، أسئلتها مع الأجوبة عبر qcm_export (تحترم ميزة qcm_pdf وحدّ التنزيلات)،
 * وملخصات الطالب الخاصة بالحصة. الأسئلة اختيارية: إن تعذّرت يُحفظ الباقي.
 */
export async function prepareOfflinePack(lessonId: string, withQuestions: boolean): Promise<{ ok: true; pack: PackManifest; qNote?: string } | { ok: false; error: string }> {
  if (!UUID_RE.test(lessonId)) return { ok: false, error: "bad_id" };
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "auth" };
  const supabase = await createClient();

  const { data: lesson } = await supabase.from("lessons").select("id, title, kind, number, subject_id, status").eq("id", lessonId).maybeSingle();
  if (!lesson) return { ok: false, error: "not_found" };

  const [{ data: files }, subject, { data: sums }] = await Promise.all([
    supabase.from("lesson_files").select("name, storage_path, kind").eq("lesson_id", lessonId).eq("kind", "pdf").order("created_at"),
    getSubjectById(lesson.subject_id as string),
    supabase.from("ai_summaries").select("id, title, kind, content, cards").eq("user_id", userId).contains("lesson_ids", [lessonId]),
  ]);

  const list = files ?? [];
  const signed = list.length ? await supabase.storage.from("lesson-files").createSignedUrls(list.map((f) => f.storage_path as string), 600) : null;
  const pdfs = list.flatMap((f, i) => {
    const url = signed?.data?.[i]?.signedUrl;
    return url ? [{ name: f.name as string, url }] : [];
  });

  let questions: OfflineQuestion[] = [];
  let qNote: string | undefined;
  if (withQuestions) {
    const { data, error } = await supabase.rpc("qcm_export", {
      p_subject: null, p_lesson: lessonId, p_from: null, p_to: null, p_difficulty: null, p_count: 50, p_shuffle: true, p_explain: true,
    });
    if (error || !data) {
      const m = error?.message ?? "";
      qNote = m.includes("download_limit") ? "limit" : m.includes("no_questions") ? "none" : m.includes("feature_disabled") ? "off" : "error";
    } else {
      questions = ((data as { questions?: OfflineQuestion[] }).questions ?? []).filter((q) => Array.isArray(q.options));
    }
  }

  const summaries: OfflineSummary[] = (sums ?? []).map((s) => ({
    id: s.id as string,
    title: s.title as string,
    kind: s.kind as string,
    content: (s.content as string) ?? "",
    cards: (s.cards as OfflineSummary["cards"]) ?? null,
  }));

  return {
    ok: true,
    qNote,
    pack: {
      id: lesson.id as string,
      title: lesson.title as string,
      kind: lesson.kind as string,
      number: lesson.number as number,
      subject: subject?.name ?? "",
      pdfs,
      questions,
      summaries,
    },
  };
}
