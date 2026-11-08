import type { SupabaseClient } from "@supabase/supabase-js";
import { geminiEmbed } from "./gemini";
import type { ContextChunk, SourceRef } from "./prompts";

export interface Retrieved {
  chunks: ContextChunk[];
  sources: SourceRef[];
  mode: "vector" | "text" | "none";
  /** Was a chunk actually related to the question found? */
  relevant: boolean;
}

export interface Row {
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

/** Semantic similarity threshold (cosine) for treating a chunk as related. Tuned by experiment on real content. */
const MIN_SIMILARITY = Number(process.env.RAG_MIN_SIMILARITY ?? 0.45);
const K = 5;

export interface RetrieveDebug {
  vectorCount: number;
  textCount: number;
  topSimilarity: number | null;
  vectorError?: string;
  textError?: string;
}

export const rowLabel = (r: Row) => `${r.lesson_kind.toUpperCase()} ${r.lesson_number} — ${r.lesson_title} (p. ${r.page})`;

/** Hybrid search: semantic + text together (not text as a mere fallback), then merge without duplicates. */
export async function searchBoth(
  supabase: SupabaseClient,
  query: string,
  scope: { subjectId?: string | null; lessonId?: string | null },
  k = K + 3
): Promise<{ vector: Row[]; text: Row[]; debug: RetrieveDebug }> {
  const debug: RetrieveDebug = { vectorCount: 0, textCount: 0, topSimilarity: null };
  const args = { p_subject: scope.subjectId ?? null, p_lesson: scope.lessonId ?? null };

  const [v, t] = await Promise.allSettled([
    (async () => {
      const [vec] = await geminiEmbed([query.slice(0, 2000)], "RETRIEVAL_QUERY");
      const { data, error } = await supabase.rpc("match_chunks", { p_embedding: `[${vec.join(",")}]`, ...args, p_k: k });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    })(),
    (async () => {
      const { data, error } = await supabase.rpc("search_chunks_text", { p_query: query.slice(0, 500), ...args, p_k: k });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    })(),
  ]);
  const vector = v.status === "fulfilled" ? v.value : [];
  const text = t.status === "fulfilled" ? t.value : [];
  if (v.status === "rejected") debug.vectorError = v.reason instanceof Error ? v.reason.message : String(v.reason);
  if (t.status === "rejected") debug.textError = t.reason instanceof Error ? t.reason.message : String(t.reason);
  debug.vectorCount = vector.length;
  debug.textCount = text.length;
  debug.topSimilarity = vector.length ? Math.max(...vector.map((r) => r.similarity)) : null;
  return { vector, text, debug };
}

/**
 * Retrieves published lesson chunks (RLS applies the student's permissions).
 * A chunk is accepted if its semantic similarity reaches the threshold, or it matches the question's distinctive words textually.
 */
export async function retrieve(
  supabase: SupabaseClient,
  query: string,
  scope: { subjectId?: string | null; lessonId?: string | null; lessonIds?: string[] },
  opts: { k?: number } = {}
): Promise<Retrieved & { debug: RetrieveDebug }> {
  const multi = (scope.lessonIds?.length ?? 0) > 1;
  const found = await searchBoth(supabase, query, scope, multi ? 20 : (opts.k ?? K) + 3);
  const debug = found.debug;
  let { vector, text } = found;
  if (multi) {
    // Multi-lesson scope: filter the subject's results by the chosen lessons (if nothing remains, keep the subject's results).
    const inScope = new Set(scope.lessonIds);
    const fv = vector.filter((r) => inScope.has(r.lesson_id));
    const ft = text.filter((r) => inScope.has(r.lesson_id));
    if (fv.length || ft.length) {
      vector = fv;
      text = ft;
    }
  }
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const r of [...vector.filter((r) => r.similarity >= MIN_SIMILARITY), ...text]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push(r);
  }
  const top = rows.slice(0, opts.k ?? K);
  console.log(`retrieve: vec=${debug.vectorCount} top=${debug.topSimilarity?.toFixed(2) ?? "-"} text=${debug.textCount} used=${top.length}${debug.vectorError ? " vecErr=" + debug.vectorError : ""}`);
  const chunks: ContextChunk[] = top.map((r, i) => ({ id: `C${i + 1}`, label: rowLabel(r), text: r.content }));
  const sources: SourceRef[] = top.map((r, i) => ({ id: `C${i + 1}`, kind: "course", label: rowLabel(r), lessonId: r.lesson_id, page: r.page }));
  const mode: Retrieved["mode"] = !top.length ? "none" : vector.some((r) => r.similarity >= MIN_SIMILARITY) ? "vector" : "text";
  return { chunks, sources, mode, relevant: top.length > 0, debug };
}
