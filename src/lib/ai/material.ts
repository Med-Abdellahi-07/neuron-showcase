import type { SupabaseClient } from "@supabase/supabase-js";

export interface Material {
  /** Lesson text split with [L1 p.3] tags so the model relies on them to cite pages. */
  text: string;
  /** Pages that actually exist for each lesson number (1-based), to validate page numbers the model cites. */
  pages: Map<number, Set<number>>;
  lessons: { index: number; id: string; kind: string; number: number; title: string }[];
}

/**
 * Gathers the indexed lesson text (lesson_chunks) with the student's client: RLS ensures they only see their space's lessons (or remaining subjects).
 * If the text exceeds the limit we take chunks spread evenly across all lessons so no lesson dominates.
 */
export async function loadMaterial(supabase: SupabaseClient, lessonIds: string[], maxChars: number): Promise<Material | null> {
  const { data: ls } = await supabase.from("lessons").select("id, kind, number, title").in("id", lessonIds).eq("status", "published");
  const lessons = (ls ?? []) as { id: string; kind: string; number: number; title: string }[];
  if (lessons.length !== lessonIds.length) return null;
  const ordered = lessonIds.map((id) => lessons.find((l) => l.id === id)!).map((l, i) => ({ ...l, index: i + 1 }));
  const { data: ch } = await supabase
    .from("lesson_chunks")
    .select("lesson_id, page, chunk_index, content")
    .in("lesson_id", lessonIds)
    .order("page")
    .order("chunk_index")
    .limit(1500);
  const rows = (ch ?? []) as { lesson_id: string; page: number; chunk_index: number; content: string }[];
  if (!rows.length) return { text: "", pages: new Map(), lessons: ordered };

  const perLesson = Math.floor(maxChars / ordered.length);
  const pages = new Map<number, Set<number>>();
  const parts: string[] = [];
  for (const l of ordered) {
    const mine = rows.filter((r) => r.lesson_id === l.id);
    const total = mine.reduce((a, r) => a + r.content.length, 0);
    const step = total > perLesson ? total / perLesson : 1; // Keep a 1/step share of the chunks.
    let acc = 0;
    let used = 0;
    const set = new Set<number>();
    parts.push(`### [L${l.index}] ${l.kind.toUpperCase()} ${l.number} — ${l.title}`);
    for (const r of mine) {
      acc += 1;
      if (step > 1 && acc < step) continue;
      acc = 0;
      if (used + r.content.length > perLesson) break;
      used += r.content.length;
      set.add(r.page);
      parts.push(`[L${l.index} p.${r.page}] ${r.content.trim()}`);
    }
    pages.set(l.index, set);
  }
  return { text: parts.join("\n"), pages, lessons: ordered };
}
