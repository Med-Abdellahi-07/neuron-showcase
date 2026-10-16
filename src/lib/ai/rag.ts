import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiEmbed } from "./gemini";
import type { ContextChunk, SourceRef } from "./prompts";

export interface Retrieved {
  chunks: ContextChunk[];
  sources: SourceRef[];
  mode: "vector" | "text" | "none";
  /** هل وُجد مقطع مرتبط فعلاً بالسؤال؟ */
  relevant: boolean;
}

interface Row {
  id: string;
  lesson_id: string;
  page: number;
  content: string;
  similarity: number;
  lesson_kind: string;
  lesson_number: number;
  lesson_title: string;
  subject_code: string;
}

/** عتبة التشابه الدلالي (cosine) لاعتبار المقطع مرتبطاً. تُضبط بالتجربة على محتوى حقيقي. */
const MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY ?? 0.55);
const K = 5;

const label = (r: Row) => `${r.lesson_kind.toUpperCase()} ${r.lesson_number} — ${r.lesson_title} (p. ${r.page})`;

/**
 * يسترجع مقاطع الدروس المنشورة (RLS يطبّق صلاحيات الطالب). بحث دلالي أولاً، وإن تعذّر التضمين
 * (Gemini غير متاح) يُستعمل بحث نصي فرنسي كاحتياط.
 */
export async function retrieve(
  supabase: SupabaseClient,
  query: string,
  scope: { subjectId?: string | null; lessonId?: string | null }
): Promise<Retrieved> {
  let rows: Row[] = [];
  let mode: Retrieved["mode"] = "none";

  try {
    const [vec] = await geminiEmbed([query.slice(0, 2000)], "RETRIEVAL_QUERY");
    const { data, error } = await supabase.rpc("match_chunks", {
      p_embedding: `[${vec.join(",")}]`,
      p_subject: scope.subjectId ?? null,
      p_lesson: scope.lessonId ?? null,
      p_k: K + 3,
    });
    if (error) throw new Error(error.message);
    rows = ((data ?? []) as Row[]).filter((r) => r.similarity >= MIN_SIMILARITY);
    mode = "vector";
  } catch (e) {
    console.error("retrieve: vector search unavailable, using text search:", e instanceof Error ? e.message : e);
    const { data, error } = await supabase.rpc("search_chunks_text", {
      p_query: query.slice(0, 500),
      p_subject: scope.subjectId ?? null,
      p_lesson: scope.lessonId ?? null,
      p_k: K,
    });
    if (!error) {
      rows = (data ?? []) as Row[];
      mode = "text";
    }
  }

  rows = rows.slice(0, K);
  const chunks: ContextChunk[] = rows.map((r, i) => ({ id: `C${i + 1}`, label: label(r), text: r.content }));
  const sources: SourceRef[] = rows.map((r, i) => ({
    id: `C${i + 1}`,
    kind: "course",
    label: label(r),
    lessonId: r.lesson_id,
    page: r.page,
  }));
  return { chunks, sources, mode: rows.length ? mode : mode === "none" ? "none" : mode, relevant: rows.length > 0 };
}
