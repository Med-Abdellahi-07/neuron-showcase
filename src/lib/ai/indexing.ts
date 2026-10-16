import { extractText, getDocumentProxy } from "unpdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorInfo } from "./errors";
import { geminiEmbed } from "./gemini";

export interface IndexResult {
  pages: number;
  chunks: number;
  embedded: boolean;
  error?: string;
}

const MAX_CHARS = 1100;
const OVERLAP = 150;
const MIN_PAGE_CHARS = 40;

/** يقسم نص صفحة إلى مقاطع متداخلة قليلاً، مع تفضيل القطع عند نهاية الفقرة أو الجملة. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length < MIN_PAGE_CHARS) return [];
  if (clean.length <= MAX_CHARS) return [clean];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + MAX_CHARS, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
      if (cut > MAX_CHARS * 0.5) end = start + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece.length >= MIN_PAGE_CHARS) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - OVERLAP, start + 1);
  }
  return out;
}

/** يستخرج نص PDF (صفحة بصفحة) ويقسمه ويضمّنه ويخزنه. يعمل بصلاحية service role، فيُستدعى بعد التحقق من الصلاحية. */
export async function indexFile(fileId: string): Promise<IndexResult> {
  const admin = createAdminClient();
  const { data: file } = await admin
    .from("lesson_files")
    .select("id, lesson_id, kind, storage_path, lessons(subject_id)")
    .eq("id", fileId)
    .maybeSingle();
  if (!file || file.kind !== "pdf") return { pages: 0, chunks: 0, embedded: false, error: "ليس ملف PDF" };
  const lessonRel = file.lessons as { subject_id: string } | { subject_id: string }[] | null;
  const subjectId = (Array.isArray(lessonRel) ? lessonRel[0] : lessonRel)?.subject_id;
  if (!subjectId) return { pages: 0, chunks: 0, embedded: false, error: "الحصة غير موجودة" };

  const fail = async (message: string): Promise<IndexResult> => {
    await admin.from("lesson_files").update({ index_error: message.slice(0, 500), indexed_at: null }).eq("id", fileId);
    return { pages: 0, chunks: 0, embedded: false, error: message };
  };

  const dl = await admin.storage.from("lesson-files").download(file.storage_path as string);
  if (dl.error || !dl.data) return fail(`تعذّر تنزيل الملف: ${dl.error?.message ?? ""}`);

  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await dl.data.arrayBuffer()));
    const res = await extractText(pdf, { mergePages: false });
    pages = res.text as string[];
  } catch (e) {
    return fail(`تعذّر قراءة PDF: ${e instanceof Error ? e.message : e}`);
  }

  const items: { page: number; index: number; text: string }[] = [];
  pages.forEach((t, p) => chunkText(t).forEach((c, i) => items.push({ page: p + 1, index: i, text: c })));
  if (items.length === 0) {
    return fail("لا نص قابل للاستخراج في الملف (قد يكون صورة ممسوحة ضوئياً). أعد رفعه بنسخة نصية.");
  }

  // التضمين: إن فشل نحفظ المقاطع بلا متجهات (يعمل البحث النصي) ونسجّل السبب
  let vectors: number[][] | null = null;
  let embedError: string | undefined;
  try {
    vectors = await geminiEmbed(items.map((i) => i.text), "RETRIEVAL_DOCUMENT");
  } catch (e) {
    const info = errorInfo(e, "gemini");
    embedError = `التضمين فشل (${info.status}): ${info.message}`.slice(0, 400);
  }

  await admin.from("lesson_chunks").delete().eq("file_id", fileId);
  for (let i = 0; i < items.length; i += 100) {
    const rows = items.slice(i, i + 100).map((it, k) => ({
      lesson_id: file.lesson_id,
      file_id: fileId,
      subject_id: subjectId,
      page: it.page,
      chunk_index: it.index,
      content: it.text,
      embedding: vectors ? `[${vectors[i + k].join(",")}]` : null,
    }));
    const { error } = await admin.from("lesson_chunks").insert(rows);
    if (error) return fail(`تعذّر حفظ المقاطع: ${error.message}`);
  }
  await admin
    .from("lesson_files")
    .update({ indexed_at: new Date().toISOString(), index_error: embedError ?? null })
    .eq("id", fileId);
  return { pages: pages.length, chunks: items.length, embedded: !!vectors, error: embedError };
}
