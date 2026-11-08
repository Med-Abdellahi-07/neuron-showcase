"use server";

import { partPath } from "@/lib/big-file";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";
import { getSubjectById } from "@/lib/data";
import type { OfflineQuestion, OfflineSummary, PackManifest } from "@/lib/offline/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prepares a lesson for download: signed PDF links (one hour), its questions with answers via qcm_export (honours the qcm_pdf feature and download limit),
 * and the student's own summaries for the lesson. Questions are optional: if they fail, the rest is still saved.
 */
export async function prepareOfflinePack(lessonId: string, withQuestions: boolean): Promise<{ ok: true; pack: PackManifest; qNote?: string } | { ok: false; error: string }> {
  if (!UUID_RE.test(lessonId)) return { ok: false, error: "bad_id" };
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "auth" };
  const supabase = await createClient();

  const { data: lesson } = await supabase.from("lessons").select("id, title, kind, number, subject_id, status").eq("id", lessonId).maybeSingle();
  if (!lesson) return { ok: false, error: "not_found" };

  const [{ data: files }, subject, { data: sums }] = await Promise.all([
    supabase.from("lesson_files").select("name, storage_path, kind, part_count, part_sha256").eq("lesson_id", lessonId).eq("kind", "pdf").order("created_at"),
    getSubjectById(lesson.subject_id as string),
    supabase.from("ai_summaries").select("id, title, kind, content, cards").eq("user_id", userId).contains("lesson_ids", [lessonId]),
  ]);

  const list = files ?? [];
  // Multipart file: sign every part; the browser fetches and joins them into one Blob.
  const paths = list.flatMap((f) => ((f.part_count as number) > 1 ? Array.from({ length: f.part_count as number }, (_, i) => partPath(f.storage_path as string, i)) : [f.storage_path as string]));
  const signed = list.length ? await supabase.storage.from("lesson-files").createSignedUrls(paths, 3600) : null;
  let k = 0;
  const pdfs = list.flatMap((f) => {
    const n = (f.part_count as number) > 1 ? (f.part_count as number) : 1;
    const urls = (signed?.data ?? []).slice(k, k + n).map((s) => s.signedUrl ?? "");
    k += n;
    if (urls.length !== n || !urls.every(Boolean)) return [];
    return n > 1
      ? [{ name: f.name as string, url: urls[0], parts: urls, hashes: (f.part_sha256 as string[] | null) ?? undefined }]
      : [{ name: f.name as string, url: urls[0] }];
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
      subjectCode: subject?.code ?? undefined,
      pdfs,
      questions,
      summaries,
    },
  };
}
