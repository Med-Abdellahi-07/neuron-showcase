"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/lib/i18n/server";
import type { FormState } from "@/app/actions/auth";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllSubjects } from "@/lib/data";
import { indexFile } from "@/lib/ai/indexing";
import { runDiagnostics, type DiagReport } from "@/lib/ai/diagnostics";
import { runLessonSearchTest, type LessonSearchReport } from "@/lib/ai/lesson-diag";

/** اختبار المزوّدين: للمدير فقط. لا يُرجع قيم المفاتيح أبداً. */
export async function runAiDiagnostics(): Promise<DiagReport> {
  await requireAdmin();
  return runDiagnostics();
}

/** اختبار «بحث في الدروس»: عدد المقاطع ونتائج سؤال تجريبي مع درجات التشابه. */
export async function runLessonSearch(query: string, subjectCode: string): Promise<LessonSearchReport> {
  await requireAdmin();
  const q = query.trim().slice(0, 300) || "apprentissage supervisé";
  const subject = subjectCode ? (await getAllSubjects()).find((s) => s.code === subjectCode) : undefined;
  return runLessonSearchTest(await createClient(), q, { subjectId: subject?.id ?? null });
}

export interface ReindexResult {
  name: string;
  ok: boolean;
  chunks: number;
  embedded: boolean;
  error?: string;
}

/** إعادة فهرسة كل ملفات PDF بالتتابع ضمن حد الدالة (نحو 50 ثانية)، مع تقرير لكل ملف. */
export async function reindexAll(): Promise<{ results: ReindexResult[]; remaining: number }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin.from("lesson_files").select("id, name").eq("kind", "pdf").order("created_at");
  const files = (data ?? []) as { id: string; name: string }[];
  const t0 = Date.now();
  const results: ReindexResult[] = [];
  let i = 0;
  for (; i < files.length && Date.now() - t0 < 40_000; i++) {
    try {
      const r = await indexFile(files[i].id);
      results.push({ name: files[i].name, ok: !r.error, chunks: r.chunks, embedded: r.embedded, error: r.error });
    } catch (e) {
      results.push({ name: files[i].name, ok: false, chunks: 0, embedded: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  revalidatePath("/", "layout");
  return { results, remaining: files.length - i };
}

const FLAG_KEYS = ["ai_chat", "ai_summary", "ai_qcm", "ai_duel", "ai_tools", "ai_exam"] as const;

/** المشرف العام: تفعيل/تعطيل كل ميزة ذكاء اصطناعي لفضاء (التحقق الفعلي في set_space_ai). لا نقاط ولا حصص للطلاب. */
export async function setSpaceAi(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const { t } = await getT();
  const id = String(fd.get("cohort") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: t("common.error") };
  const flags = Object.fromEntries(FLAG_KEYS.map((k) => [k, fd.get(k) === "on"]));
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_space_ai", { p_cohort: id, p_flags: flags });
  if (error) {
    console.error("setSpaceAi failed:", error.code, error.message);
    return { error: t("common.error") };
  }
  revalidatePath("/admin", "layout");
  return { message: t("common.saved") };
}

/** سقف الإساءة الخفي (طلبات/يوم و/دقيقة لكل طالب) */
export async function setAiLimits(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const { t } = await getT();
  const daily = Number(fd.get("daily"));
  const minute = Number(fd.get("minute"));
  if (!Number.isInteger(daily) || !Number.isInteger(minute) || daily < 10 || daily > 5000 || minute < 1 || minute > 120) return { error: t("aiadm.limits.bad") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("ai_set_limits", { p_daily: daily, p_minute: minute });
  if (error) {
    console.error("setAiLimits failed:", error.code, error.message);
    return { error: t("common.error") };
  }
  revalidatePath("/admin", "layout");
  return { message: t("common.saved") };
}
