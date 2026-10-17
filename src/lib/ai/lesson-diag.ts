import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorInfo } from "./errors";
import { geminiEmbed } from "./gemini";
import { searchBoth, type Row } from "./rag";

export interface LessonSearchReport {
  serviceKey: boolean;
  threshold: number;
  index: {
    pdfFiles: number;
    indexedFiles: number;
    chunks: number;
    withEmbedding: number;
    files: { name: string; lesson: string; published: boolean; chunks: number; withEmbedding: number; indexedAt: string | null; error: string | null }[];
  } | null;
  indexError?: string;
  query: string;
  embedding?: { ok: boolean; dims?: number; error?: string };
  vector: { ok: boolean; error?: string; rows: Hit[] };
  text: { ok: boolean; error?: string; rows: Hit[] };
  verdict: string;
}
interface Hit {
  sim: number;
  where: string;
  snippet: string;
}

const hit = (r: Row): Hit => ({
  sim: Math.round(r.similarity * 1000) / 1000,
  where: `${r.subject_code} · ${r.lesson_kind.toUpperCase()} ${r.lesson_number} — ${r.lesson_title} (p. ${r.page})`,
  snippet: r.content.replace(/\s+/g, " ").slice(0, 200),
});

/** يفحص سلسلة RAG كاملة: الفهرس المخزَّن، التضمين، البحث الدلالي والنصي بصلاحية المستدعي (RLS). */
export async function runLessonSearchTest(
  supabase: SupabaseClient,
  query: string,
  scope: { subjectId?: string | null }
): Promise<LessonSearchReport> {
  const threshold = Number(process.env.RAG_MIN_SIMILARITY ?? 0.45);
  const rep: LessonSearchReport = {
    serviceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    threshold,
    index: null,
    query,
    vector: { ok: false, rows: [] },
    text: { ok: false, rows: [] },
    verdict: "",
  };

  // 1) ما المخزَّن فعلاً (بصلاحية service_role لنرى الحقيقة بغض النظر عن RLS)
  if (rep.serviceKey) {
    try {
      const admin = createAdminClient();
      const { data: files, error: fe } = await admin
        .from("lesson_files")
        .select("id, name, kind, indexed_at, index_error, lessons(kind, number, title, status)")
        .eq("kind", "pdf");
      if (fe) throw new Error(fe.message);
      const list = await Promise.all(
        (files ?? []).map(async (f) => {
          const l = (Array.isArray(f.lessons) ? f.lessons[0] : f.lessons) as { kind: string; number: number; title: string; status: string } | null;
          const [all, emb] = await Promise.all([
            admin.from("lesson_chunks").select("id", { count: "exact", head: true }).eq("file_id", f.id),
            admin.from("lesson_chunks").select("id", { count: "exact", head: true }).eq("file_id", f.id).not("embedding", "is", null),
          ]);
          if (all.error) throw new Error(all.error.message);
          return {
            name: f.name as string,
            lesson: l ? `${l.kind.toUpperCase()} ${l.number} — ${l.title}` : "?",
            published: l?.status === "published",
            chunks: all.count ?? 0,
            withEmbedding: emb.count ?? 0,
            indexedAt: (f.indexed_at as string | null) ?? null,
            error: (f.index_error as string | null) ?? null,
          };
        })
      );
      rep.index = {
        pdfFiles: list.length,
        indexedFiles: list.filter((f) => f.chunks > 0).length,
        chunks: list.reduce((a, f) => a + f.chunks, 0),
        withEmbedding: list.reduce((a, f) => a + f.withEmbedding, 0),
        files: list,
      };
    } catch (e) {
      rep.indexError = e instanceof Error ? e.message : String(e);
    }
  }

  // 2) التضمين ثم البحث بصلاحية المستدعي (كما يفعل الطالب)
  try {
    const [v] = await geminiEmbed([query], "RETRIEVAL_QUERY");
    rep.embedding = { ok: true, dims: v.length };
  } catch (e) {
    rep.embedding = { ok: false, error: `${errorInfo(e).status} ${errorInfo(e).message}`.slice(0, 400) };
  }
  const { vector, text, debug } = await searchBoth(supabase, query, scope, 8);
  rep.vector = { ok: !debug.vectorError, error: debug.vectorError, rows: vector.map(hit) };
  rep.text = { ok: !debug.textError, error: debug.textError, rows: text.map(hit) };

  // 3) الخلاصة
  const ix = rep.index;
  if (!rep.serviceKey) rep.verdict = "SUPABASE_SERVICE_ROLE_KEY غير مضبوط في Vercel: لا فهرسة تلقائية ولا فحص للفهرس.";
  else if (rep.indexError) rep.verdict = `تعذّر قراءة الفهرس: ${rep.indexError}`;
  else if (ix && ix.pdfFiles === 0) rep.verdict = "لا ملفات PDF مسجّلة في أي حصة.";
  else if (ix && ix.chunks === 0) rep.verdict = "الفهرس فارغ (0 مقطع): لم تنجح الفهرسة. اضغط «إعادة فهرسة الكل» وانظر عمود الأخطاء.";
  else if (ix && ix.withEmbedding === 0) rep.verdict = "المقاطع موجودة بلا متجهات: فشل التضمين وقت الفهرسة؛ أعد الفهرسة. البحث النصي يعمل مع ذلك.";
  else if (!debug.vectorError && vector.length === 0 && text.length === 0) rep.verdict = "الفهرس سليم لكن البحث لم يُرجع شيئاً: تحقق أن الحصة «منشورة» وأن المادة/الحصة المحددة صحيحة.";
  else if (debug.vectorError) rep.verdict = `البحث الدلالي فشل (${debug.vectorError}) لكن النصي ${text.length ? "وجد نتائج" : "لم يجد"}.`;
  else if ((debug.topSimilarity ?? 0) < threshold && text.length === 0) rep.verdict = `أعلى تشابه ${debug.topSimilarity?.toFixed(2)} أقل من العتبة ${threshold}: خفّض RAG_MIN_SIMILARITY.`;
  else rep.verdict = "السلسلة تعمل: وُجدت مقاطع مرتبطة بالسؤال.";
  return rep;
}
