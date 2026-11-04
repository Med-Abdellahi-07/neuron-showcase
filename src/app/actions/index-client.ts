"use server";

import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSpace } from "@/lib/spaces";
import { chunkText, embedAndStore } from "@/lib/ai/indexing";

/**
 * فهرسة PDF الكبير من المتصفح: النص يُستخرج هناك (pdf.js) ويصل إلى هنا دفعات صغيرة،
 * فلا تتجاوز أي استدعاءات مهلة الدالة. كل دالة تتحقق من الصلاحية ومن أن الملف في فضاء المستخدم (RLS).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGES_PER_BATCH = 12;
const MAX_CHARS_PER_PAGE = 60_000;

async function ownFile(fileId: string) {
  await requireStaff();
  if (!UUID_RE.test(fileId) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  if ((await getSpace())?.features.ai !== true) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("lesson_files").select("id, lesson_id, kind, lessons(subject_id)").eq("id", fileId).maybeSingle();
  if (!data || data.kind !== "pdf") return null;
  const rel = data.lessons as { subject_id: string } | { subject_id: string }[] | null;
  const subjectId = (Array.isArray(rel) ? rel[0] : rel)?.subject_id;
  return subjectId ? { id: data.id as string, lessonId: data.lesson_id as string, subjectId } : null;
}

export async function startClientIndex(fileId: string): Promise<{ ok: boolean }> {
  const f = await ownFile(fileId);
  if (!f) return { ok: false };
  const admin = createAdminClient();
  await admin.from("lesson_chunks").delete().eq("file_id", fileId);
  await admin.from("lesson_files").update({ indexed_at: null, index_error: null }).eq("id", fileId);
  return { ok: true };
}

export async function indexPages(
  fileId: string,
  pages: { page: number; text: string }[]
): Promise<{ ok: boolean; chunks: number; embedError?: string }> {
  const f = await ownFile(fileId);
  if (!f || !Array.isArray(pages) || pages.length > MAX_PAGES_PER_BATCH) return { ok: false, chunks: 0 };
  const items: { page: number; index: number; text: string }[] = [];
  for (const p of pages) {
    if (!Number.isInteger(p.page) || p.page < 1 || typeof p.text !== "string") continue;
    chunkText(p.text.slice(0, MAX_CHARS_PER_PAGE)).forEach((c, i) => items.push({ page: p.page, index: i, text: c }));
  }
  if (!items.length) return { ok: true, chunks: 0 };
  const r = await embedAndStore(createAdminClient(), { fileId, lessonId: f.lessonId, subjectId: f.subjectId }, items);
  if ("fatal" in r) return { ok: false, chunks: 0 };
  return { ok: true, chunks: items.length, embedError: r.embedError };
}

export async function finishClientIndex(fileId: string, totalChunks: number, embedError?: string): Promise<{ ok: boolean }> {
  const f = await ownFile(fileId);
  if (!f) return { ok: false };
  const admin = createAdminClient();
  if (totalChunks <= 0) {
    await admin.from("lesson_files").update({ indexed_at: null, index_error: "لا نص قابل للاستخراج في الملف (قد يكون صورة ممسوحة ضوئياً). أعد رفعه بنسخة نصية." }).eq("id", fileId);
    return { ok: true };
  }
  await admin.from("lesson_files").update({ indexed_at: new Date().toISOString(), index_error: embedError?.slice(0, 400) ?? null }).eq("id", fileId);
  return { ok: true };
}
